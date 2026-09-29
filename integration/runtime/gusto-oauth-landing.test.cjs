'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { serveGustoOAuthLanding } = require('./gusto-oauth-landing.cjs');

const CALLBACK = '/api/integrations/autonomous/oauth/callback/gusto';
const COMPLETE = '/api/integrations/autonomous/gusto/complete';
const STATE = Buffer.alloc(32, 9).toString('base64url');

function landing(url = CALLBACK) {
  const response = {
    headers: {}, body: '', statusCode: 0,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body) { this.body = String(body); }
  };
  assert.equal(serveGustoOAuthLanding({ method: 'GET', url, headers: {} }, response), true);
  const script = response.body.match(/<script nonce="([A-Za-z0-9+/=]+)">([\s\S]*?)<\/script>/);
  assert.ok(script, 'the landing page must carry its nonce-bound script');
  return { ...response, nonce: script[1], script: script[2] };
}

async function runPage(query, options = {}) {
  const page = landing(CALLBACK + query);
  const events = [];
  const status = { textContent: 'Finishing your connection.' };
  const location = {
    href: 'https://vector.example.test' + CALLBACK + query,
    search: query,
    replace(target) { events.push({ type: 'navigate', target }); }
  };
  const context = {
    URLSearchParams,
    location,
    history: {
      replaceState(_state, _unused, target) {
        const next = new URL(target, location.href);
        location.href = next.href;
        location.search = next.search;
        events.push({ type: 'scrub', target });
      }
    },
    document: {
      getElementById(id) { assert.equal(id, 'gusto-oauth-status'); return status; }
    },
    fetch: async (target, init) => {
      events.push({ type: 'fetch', target, init, currentURL: location.href });
      if (options.networkError) throw new Error('private-network-detail');
      return { ok: options.ok !== false, json: async () => options.body || { verified: true } };
    }
  };
  await vm.runInNewContext(page.script, context);
  return { page, events, status, location };
}

test('callback landing contains no reflected query values and uses a fresh restrictive CSP nonce', () => {
  const first = landing(CALLBACK + '?state=private-state&code=private-code&error_description=private-description');
  const second = landing();
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(first.headers['cache-control'], 'no-store');
  assert.equal(first.headers['referrer-policy'], 'no-referrer');
  assert.equal(first.headers['x-content-type-options'], 'nosniff');
  assert.equal(first.headers['content-security-policy'], "default-src 'none'; script-src 'nonce-" + first.nonce + "'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  assert.notEqual(first.nonce, second.nonce);
  assert.doesNotMatch(first.body, /private-state|private-code|private-description/);
});

test('landing clears the callback query before completing through an authenticated same-origin POST', async () => {
  const result = await runPage('?state=' + STATE + '&code=private-code');
  assert.equal(result.events[0].type, 'scrub');
  assert.equal(result.events[0].target, CALLBACK);
  const request = result.events[1];
  assert.equal(request.type, 'fetch');
  assert.equal(request.target, COMPLETE);
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.credentials, 'same-origin');
  assert.equal(request.init.cache, 'no-store');
  assert.equal(request.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(request.init.body), { state: STATE, code: 'private-code', providerError: null });
  assert.doesNotMatch(request.currentURL, /[?]|private-code|state=/);
  assert.equal(result.events[2].type, 'navigate');
  assert.equal(result.events[2].target, '/#vector/integrations');
  assert.doesNotMatch(result.status.textContent, /private-code|private-state/);
});

test('invalid or ambiguous callback parameters are scrubbed without any network request', async () => {
  for (const query of [
    '?state=' + STATE + '&code=one&code=two',
    '?state=' + STATE + '&state=' + STATE + '&code=one',
    '?state=' + STATE + '&error=denied&error=other',
    '?state=' + STATE + '&code=one&error=denied',
    '?state=' + STATE,
    '?code=one',
    '?state=short&code=one',
    '?state=' + STATE + '&code=',
    '?state=' + STATE + '&code=bad%0Acode',
    '?state=' + STATE + '&code=' + 'x'.repeat(4097),
    '?state=' + STATE + '&code=one&description=' + 'x'.repeat(8192)
  ]) {
    const result = await runPage(query);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].type, 'scrub');
    assert.equal(result.location.search, '');
    assert.match(result.status.textContent, /invalid|expired/i);
  }
});

test('provider denial passes only its error code and renders the sanitized application error as text', async () => {
  const result = await runPage('?state=' + STATE + '&error=access_denied&error_description=private-provider-description', {
    ok: false, body: { error: 'Gusto authorization was declined.' }
  });
  const request = result.events.find(event => event.type === 'fetch');
  assert.deepEqual(JSON.parse(request.init.body), { state: STATE, code: null, providerError: 'access_denied' });
  assert.equal(result.events.filter(event => event.type === 'navigate').length, 0);
  assert.equal(result.status.textContent, 'Gusto authorization was declined.');
  assert.doesNotMatch(result.status.textContent, /private-provider-description|access_denied/);
});

test('network failures and unverified responses keep the user on a safe failure page', async () => {
  for (const options of [{ networkError: true }, { body: { verified: false } }, { ok: false, body: {} }]) {
    const result = await runPage('?state=' + STATE + '&code=private-code', options);
    assert.equal(result.events.filter(event => event.type === 'navigate').length, 0);
    assert.match(result.status.textContent, /could not|unable/i);
    assert.doesNotMatch(result.status.textContent, /private-network-detail|private-code/);
  }
  const inertMarkup = '<img src=x onerror=alert(1)>';
  const result = await runPage('?state=' + STATE + '&code=private-code', { ok: false, body: { error: inertMarkup } });
  assert.equal(result.status.textContent, inertMarkup);
});
