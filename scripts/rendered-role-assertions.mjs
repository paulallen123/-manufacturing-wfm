import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

// App-owned markers and bounded read-only destinations, not authentication UI.
const contracts = {
  manager: { home: '.vector-home', heading: '^What needs your attention right now$', route: 'leave', name: 'time off|leave', outcome: '^Absence & Leave$', api: '/api/bootstrap' },
  employee: { home: '[data-vector-employee-home="1"]', heading: '\\S', route: 'personal', name: 'Personal|Attendance', outcome: '^Your work, in one place\\.$', api: '/api/personal' },
  payroll_admin: { home: '.vw-panel', heading: '^Payroll preparation$', route: 'personal', name: 'Personal', outcome: '^Your work, in one place\\.$', api: '/api/personal', via: '[data-vector-nav="1"]' },
  director: { home: '.vector-home', heading: '^What needs your attention right now$', route: 'onboarding', name: 'onboarding', outcome: '^Employee onboarding$', api: '/api/onboarding', via: '[data-vector-settings]' },
};

// Scope responses to requests STARTED after the navigation checkpoint. Merely
// clearing a response array allows a late response from an old document to pass.
export function createNavigationEvidence(origin) {
  let sequence = 0;
  const requests = new Map(), responses = [], bodies = new WeakMap();
  return {
    responses,
    checkpoint: () => sequence,
    since: mark => responses.filter(r => r.sequence > mark),
    async readResponse(response, send) {
      const source = bodies.get(response);
      assert.ok(source, 'Response has no completed request identity.');
      if (!source.value) source.value = (async () => {
        assert.match(source.mimeType, /^application\/(?:[\w.-]+\+)?json(?:;|$)/i, 'Fresh API response is not JSON.');
        try {
          const result = await send('Network.getResponseBody', { requestId: source.requestId });
          const text = result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf8') : result.body;
          return JSON.parse(text);
        } catch { throw Error('Fresh API response body could not be decoded.'); }
      })();
      return source.value;
    },
    onEvent(msg) {
      if (msg.method === 'Network.requestWillBeSent') {
        const p = msg.params;
        const prior = requests.get(p.requestId);
        // CDP reuses requestId for redirects. Never refresh a chain's start
        // when only its final hop began after the navigation checkpoint.
        const started = p.redirectResponse ? prior?.sequence ?? -Infinity : ++sequence;
        requests.set(p.requestId, { sequence: started, method: p.request.method, url: p.request.url });
      }
      if (msg.method === 'Network.responseReceived') {
        const p = msg.params, request = requests.get(p.requestId);
        if (!request) return;
        const u = new URL(p.response.url);
        if (u.origin === origin && u.pathname.startsWith('/api/') && request.method === 'GET') {
          request.response = { sequence: request.sequence, path: u.pathname, status: p.response.status };
          request.mimeType = p.response.mimeType || '';
        }
      }
      if (msg.method === 'Network.loadingFinished') {
        const request = requests.get(msg.params.requestId);
        if (request?.response) {
          bodies.set(request.response, { requestId: msg.params.requestId, mimeType: request.mimeType });
          responses.push(request.response);
        }
        requests.delete(msg.params.requestId);
      }
      if (msg.method === 'Network.loadingFailed') requests.delete(msg.params.requestId);
    },
  };
}

// Serialized into the browser by CDP. Visibility includes ancestors, opacity,
// and hit testing for controls; hidden source navigation must never be clicked.
function inspect(contract, phase, selector) {
  const visible = element => {
    if (!element || !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    for (let e = element; e; e = e.parentElement) {
      if (e.hidden || e.inert || e.getAttribute('aria-hidden') === 'true') return false;
    }
    const r = element.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const painted = element => {
    if (!visible(element)) return false;
    element.scrollIntoView({ block: 'center', inline: 'center' });
    const r = element.getBoundingClientRect();
    const x = Math.max(0, r.left) + (Math.min(innerWidth, r.right) - Math.max(0, r.left)) / 2;
    const y = Math.max(0, r.top) + (Math.min(innerHeight, r.bottom) - Math.max(0, r.top)) / 2;
    return x >= 0 && y >= 0 && x < innerWidth && y < innerHeight && element.contains(document.elementFromPoint(x, y));
  };
  const app = document.querySelector('.app[data-vector-shell]');
  const content = app?.querySelector('.content');
  const container = phase === 'home' ? content?.querySelector(contract.home) : content;
  const heading = [...(container?.querySelectorAll('h1') || [])].find(e => painted(e) && new RegExp(phase === 'home' ? contract.heading : contract.outcome, 'i').test(e.innerText.trim()));
  const candidates = [...(app?.querySelectorAll(selector || `[data-vector-route="${contract.route}"]`) || [])];
  let control = null, point = null;
  for (const candidate of candidates) {
    if (!visible(candidate) || candidate.disabled || candidate.getAttribute('aria-disabled') === 'true') continue;
    // Priority workflow/source actions can carry a route attribute but open a
    // review dialog instead. Only route navigation belongs in this proof.
    if (!selector && (candidate.hasAttribute('data-vector-workflow') || candidate.hasAttribute('data-vector-source-id') || !new RegExp(contract.name, 'i').test(candidate.getAttribute('aria-label') || candidate.innerText))) continue;
    let moving = false;
    for (let e = candidate; e; e = e.parentElement) {
      if (e.getAnimations().some(animation => animation.playState === 'running' || animation.pending)) { moving = true; break; }
    }
    if (moving) continue;
    candidate.scrollIntoView({ block: 'center', inline: 'center' });
    const r = candidate.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    if (x >= 0 && y >= 0 && x < innerWidth && y < innerHeight && candidate.contains(document.elementFromPoint(x, y))) {
      control = candidate; point = { x, y }; break;
    }
  }
  const route = location.hash.startsWith('#vector/') ? decodeURIComponent(location.hash.slice(8)) : '';
  return { app: visible(app) && visible(content) && visible(container), heading: heading?.innerText.trim() || '', point,
    control: control?.getAttribute('aria-label') || control?.innerText || '', route, title: document.title, text: document.body?.innerText || '' };
}
async function snapshot(send, contract, phase, selector) {
  const result = await send('Runtime.evaluate', {
    expression: `(${inspect.toString()})(${JSON.stringify(contract)},${JSON.stringify(phase)},${JSON.stringify(selector || null)})`, returnByValue: true,
  });
  assert.ok(!result.exceptionDetails, 'App visibility inspection failed.');
  return result.result?.value || {};
}
async function until(read, check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let error;
  do {
    try { const view = await read(); await check(view); return view; } catch (e) { error = e; }
    await delay(50);
  } while (Date.now() < deadline);
  throw error;
}
async function click(send, view) {
  assert.ok(view.point, 'Named navigation control is not visible and actionable.');
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...view.point, button: 'left', clickCount: 1 });
}

const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
function validateResponse(value, path, expectedActor, personalId) {
  assert.ok(record(value) && !value.error, 'Fresh API response has no valid result.');
  if (path === '/api/bootstrap') {
    assert.ok(record(value.actor) && record(value.state), 'Fresh bootstrap lacks actor or state.');
    for (const field of ['tenant', 'role', 'email']) assert.ok(value.actor[field] === expectedActor[field], `Fresh bootstrap ${field} binding mismatch.`);
    assert.ok(Number.isFinite(value.state.version) && ['staff', 'org', 'requests'].every(k => Array.isArray(value.state[k])), 'Fresh bootstrap state contract is incomplete.');
  } else if (path === '/api/personal') {
    assert.ok(record(value.identity) && typeof value.identity.name === 'string' && value.identity.name.trim(), 'Fresh personal identity is incomplete.');
    assert.ok(personalId != null && String(value.identity.id) === String(personalId), 'Fresh personal identity binding mismatch.');
    assert.ok(['requests', 'shifts'].every(k => Array.isArray(value[k])), 'Fresh personal record is incomplete.');
  } else if (path === '/api/onboarding') {
    assert.ok(['people', 'batches', 'limitations', 'invites'].every(k => Array.isArray(value[k])), 'Fresh onboarding contract is incomplete.');
  }
}

export async function proveRoleView({ send, evidence, role, expectedActor, navigate, timeoutMs = 20_000, presentation = () => {} }) {
  const contract = contracts[role];
  assert.ok(contract, `No rendered app contract for role ${role}.`);
  assert.ok(expectedActor?.role === role && expectedActor.tenant && expectedActor.email, 'Expected authenticated actor binding is required.');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  const start = evidence.checkpoint();
  await navigate();
  let personalId;
  const requireResponse = async (mark, path) => {
    const candidates = evidence.since(mark).filter(r => r.path === path && r.status === 200);
    assert.ok(candidates.length, `Missing fresh ${path} response for this navigation.`);
    const value = await evidence.readResponse(candidates[candidates.length - 1], send);
    validateResponse(value, path, expectedActor, personalId);
    return value;
  };
  const home = await until(() => snapshot(send, contract, 'home'), async view => {
    const bootstrap = await requireResponse(start, '/api/bootstrap');
    personalId = bootstrap.actor.personnelId || bootstrap.actor.personId;
    assert.ok(view.app && view.heading, `${role} visible role app home/heading is missing.`);
    presentation(view, `${role} home`);
  }, timeoutMs);
  const homeResponses = evidence.since(start);
  const routeStart = evidence.checkpoint();
  const readyControl = selector => until(() => snapshot(send, contract, 'home', selector),
    view => assert.ok(view.point, 'Named navigation control is not visible and actionable.'), timeoutMs);
  let control = await snapshot(send, contract, 'home');
  if (!control.point && contract.via) {
    let via = await snapshot(send, contract, 'home', contract.via);
    if (!via.point) {
      const menu = await readyControl('[data-vector-menu]');
      await click(send, menu);
      via = await readyControl(contract.via);
    }
    await click(send, via);
    control = await readyControl();
  }
  if (!control.point) control = await readyControl();
  await click(send, control);
  const destination = await until(() => snapshot(send, contract, 'destination'), async view => {
    await requireResponse(routeStart, contract.api);
    assert.equal(view.route, contract.route, 'Named navigation did not reach the required route.');
    assert.ok(view.app && view.heading && view.heading !== home.heading, 'Named navigation has no visible destination heading.');
    presentation(view, `${role} ${contract.route}`);
  }, timeoutMs);
  // Persist only proof observations, not full rendered customer text.
  return { home: { heading: home.heading, title: home.title, responses: homeResponses },
    navigation: { control: control.control.trim(), route: contract.route, heading: destination.heading, title: destination.title, responses: evidence.since(routeStart) },
    claimBoundary: 'Visible role home and read-only route transition only; zero business journeys.' };
}
