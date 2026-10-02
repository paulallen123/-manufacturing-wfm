'use strict';

const { randomBytes } = require('node:crypto');

// The provider arrives without VECTOR's SameSite=Strict session cookie. Once this
// document is loaded, its same-origin POST can use the existing browser session.
// No callback values are interpolated into HTML or persisted in browser storage.
const SCRIPT = String.raw`(async function () {
  'use strict';
  const status = document.getElementById('gusto-oauth-status');
  const query = location.search;
  const failure = 'Gusto connection could not be completed. Return to Integrations and try again.';
  try {
    history.replaceState(null, '', '/api/integrations/autonomous/oauth/callback/gusto');
  } catch {
    status.textContent = failure;
    return;
  }
  try {
    const parameters = new URLSearchParams(query);
    const state = parameters.get('state');
    const code = parameters.get('code');
    const providerError = parameters.get('error');
    const clean = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);
    if (query.length > 8192 || !/^[A-Za-z0-9_-]{43}$/.test(state || '') ||
        ['state', 'code', 'error'].some(key => parameters.getAll(key).length > 1) ||
        parameters.has('code') === parameters.has('error') ||
        (parameters.has('code') && !clean(code, 4096)) ||
        (parameters.has('error') && !clean(providerError, 512))) {
      status.textContent = 'This Gusto authorization response is invalid or expired. Return to Integrations and try again.';
      return;
    }
    const response = await fetch('/api/integrations/autonomous/gusto/complete', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, code, providerError })
    });
    const result = await response.json();
    if (response.ok && result && result.verified === true) {
      location.replace('/#vector/integrations');
      return;
    }
    status.textContent = result && typeof result.error === 'string' && result.error.trim()
      ? result.error.slice(0, 500) : failure;
  } catch {
    status.textContent = failure;
  }
})();`;

function serveGustoOAuthLanding(_req, res) {
  const nonce = randomBytes(18).toString('base64');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'nonce-" + nonce + "'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connecting Gusto · VECTOR</title></head>' +
    '<body><main><h1>Connecting Gusto</h1><p id="gusto-oauth-status" role="status" aria-live="polite">Finishing your Gusto connection…</p>' +
    '<p><a href="/#vector/integrations">Back to Integrations</a></p><noscript>Enable JavaScript to finish this connection, then return to Integrations and try again.</noscript></main>' +
    '<script nonce="' + nonce + '">' + SCRIPT + '</script></body></html>');
  return true;
}

module.exports = { serveGustoOAuthLanding };
