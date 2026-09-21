# VECTOR Mobile and Mass Clocking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved blue-and-white VECTOR mobile/tablet workforce experience and offline-capable mass clocking into the existing Manufacturing WFM product, using the current app shell and proof scripts as the authority.

**Architecture:** Keep the existing product as the single system of record. Extend the current Docker-applied VECTOR overlay and existing kiosk/time endpoints so desktop, phone, and tablet views all read from the same authenticated data and emit the same auditable events. Implement in thin, testable slices: source mapping, role projections, tablet clocking events, visual fidelity, and hosted proof.

**Tech Stack:** Existing repository `paulallen123/-manufacturing-wfm`, Docker image build, sealed hosted artifact, `ux-overlay/vector-shell.js`, `ux-overlay/vector-shell.css`, Node proof scripts under `scripts/`, Playwright-style browser proof where existing scripts already use browser automation, GitHub branch `feature/vector-mobile-mass-clocking-design`.

**Spec:** `docs/superpowers/specs/2026-09-21-vector-mobile-mass-clocking-design.md`

## Global Constraints

- Approved visual direction is the blue-and-white VECTOR concept family from 21 September 2026.
- Do not use the deleted green/black concept art as an active design reference.
- Green remains allowed only as a semantic success, covered, available, or positive status colour.
- Keep one intelligence engine and one existing product; do not create a competing standalone app.
- Preserve tenant isolation, device registration, idempotent time events, duplicate protection, sequence handling, and audit linkage.
- Offline tablet events must remain visibly pending until accepted by the server.
- Mock or fixture values must never be presented as live business outcomes.
- Product is not production-approved or pilot-ready until source, storage, release, and hosted proof gates pass.
- Implementation must produce screenshots or video for desktop, tablet, and phone against the approved concept art.
- The current branch is `feature/vector-mobile-mass-clocking-design`.

## Review Focus

- Wrong visual family: rendered screens must use blue-and-white VECTOR styling and must not reintroduce the retired green/black concept palette.
- Offline restart: queued tablet clock events must survive page reload or device restart and sync once connectivity returns.
- Duplicate event submission: replaying the same clock event must not create a second accepted attendance record.
- Role leakage: an employee phone view must not show director, executive, finance, or multi-site controls.
- Fixture confusion: proof screens must distinguish source-backed values from demonstration fixtures before any pilot claim.

---

## File Structure

This plan intentionally starts from the files already present in the branch.

| Path | Responsibility |
| --- | --- |
| `docs/superpowers/specs/2026-09-21-vector-mobile-mass-clocking-design.md` | Approved architecture, colour decision, concept-art mapping, and proof rules. |
| `docs/superpowers/plans/2026-09-21-vector-mobile-mass-clocking-implementation.md` | This execution plan. |
| `ux-overlay/vector-shell.js` | Current browser overlay that adds the VECTOR shell, navigation, cards, assistant, and dashboard panels to the hosted app. |
| `ux-overlay/vector-shell.css` | Current VECTOR visual system, responsive layout rules, cards, buttons, and status styling. |
| `Dockerfile` | Applies the overlay to the sealed hosted artifact during image build. |
| `scripts/live-isolation-kiosk-proof.mjs` | Existing source of truth for registered kiosk device sync, replay, tenant injection, sequence gap, revoke, and auth behaviour. |
| `scripts/vector-mobile-mass-clocking-proof.mjs` | Create this proof script for mobile/tablet role journeys, offline clocking, visual-family checks, and screenshots. |
| `scripts/vector-source-map.mjs` | Create this source inspection script to report which runtime routes/endpoints are used by the mobile/tablet implementation. |
| `release/vector-mobile-mass-clocking-proof.json` | Create this machine-readable proof manifest only after the hosted evidence run succeeds. |

## Task 1: Source map the current runtime contract

**Files:**
- Create: `scripts/vector-source-map.mjs`
- Modify: none
- Test: `scripts/vector-source-map.mjs`

**Interfaces:**
- Consumes: repository files, `Dockerfile`, `ux-overlay/vector-shell.js`, `ux-overlay/vector-shell.css`, and existing proof scripts.
- Produces: a JSON report printed to stdout with `overlay.marker`, `overlay.routes`, `kiosk.endpoints`, `proofScripts`, and `gaps`.

- [ ] **Step 1: Write the source-map script**

Create `scripts/vector-source-map.mjs` with this initial content:

```js
import fs from 'node:fs';

const read = (path) => fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';

const files = {
  dockerfile: read('Dockerfile'),
  shellJs: read('ux-overlay/vector-shell.js'),
  shellCss: read('ux-overlay/vector-shell.css'),
  kioskProof: read('scripts/live-isolation-kiosk-proof.mjs')
};

const routeMatches = [...files.shellJs.matchAll(/data-vector-route="([^"]+)"/g)].map(match => match[1]);
const endpointMatches = [...files.kioskProof.matchAll(/['"]\/(api\/[^'"]+)['"]/g)].map(match => '/' + match[1]);

const report = {
  overlay: {
    marker: files.shellJs.includes('VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1'),
    reviewMarker: files.shellJs.includes('VECTOR_REVIEW_NEUTRAL_V1'),
    routeCount: new Set(routeMatches).size,
    routes: [...new Set(routeMatches)].sort()
  },
  visualSystem: {
    hasBlueBrand: /#2563eb|#1d4ed8|blue|navy/i.test(files.shellCss),
    hasResponsiveRules: files.shellCss.includes('@media'),
    retiredGreenConceptMentioned: /green\/black|deleted green|VECTOR Workforce Operations Dashboard\(1\)/i.test(files.shellJs + files.shellCss)
  },
  kiosk: {
    endpoints: [...new Set(endpointMatches)].sort(),
    registersDevice: files.kioskProof.includes('/api/kiosk/devices/register'),
    syncsEvents: files.kioskProof.includes('/api/kiosk/sync'),
    testsReplay: files.kioskProof.includes('replayed'),
    testsRevoke: files.kioskProof.includes('/api/kiosk/devices/revoke')
  },
  proofScripts: fs.readdirSync('scripts').filter(name => /proof|kiosk|isolation|vector/i.test(name)).sort(),
  gaps: []
};

if (!report.overlay.marker) report.gaps.push('VECTOR shell marker is missing.');
if (!report.visualSystem.hasResponsiveRules) report.gaps.push('Responsive CSS rules are missing.');
if (report.visualSystem.retiredGreenConceptMentioned) report.gaps.push('Retired green concept appears in active overlay files.');
if (!report.kiosk.registersDevice || !report.kiosk.syncsEvents) report.gaps.push('Kiosk registration or sync endpoint was not found in proof scripts.');

console.log(JSON.stringify(report, null, 2));

if (report.gaps.length) {
  process.exitCode = 1;
}
```

- [ ] **Step 2: Run the source-map script**

Run: `node scripts/vector-source-map.mjs`

Expected: PASS with JSON showing `overlay.marker: true`, responsive CSS present, kiosk registration and sync present, and `gaps: []`.

- [ ] **Step 3: Commit**

```bash
git add scripts/vector-source-map.mjs
git commit -m "test: map vector mobile runtime sources"
```

## Task 2: Add visual-family guards for the approved blue-and-white direction

**Files:**
- Modify: `scripts/vector-source-map.mjs`
- Modify: `ux-overlay/vector-shell.css`
- Test: `scripts/vector-source-map.mjs`

**Interfaces:**
- Consumes: Task 1 report fields.
- Produces: an enforceable guard that rejects active overlay files if the retired green/black concept returns as a design reference or if core blue-and-white styling disappears.

- [ ] **Step 1: Extend the source-map script with exact visual checks**

Add this block before `console.log(JSON.stringify(report, null, 2));`:

```js
report.visualSystem.requiredTokens = {
  navySurface: /#0f172a|#111827|navy/i.test(files.shellCss),
  blueAction: /#2563eb|#1d4ed8|#3b82f6/i.test(files.shellCss),
  whitePanel: /#ffffff|white/i.test(files.shellCss),
  lightBackground: /#f8fafc|#f1f5f9|#eff6ff/i.test(files.shellCss)
};

for (const [name, present] of Object.entries(report.visualSystem.requiredTokens)) {
  if (!present) report.gaps.push(`Missing approved blue-white token: ${name}`);
}
```

- [ ] **Step 2: Run the script and make the CSS pass without changing product behaviour**

Run: `node scripts/vector-source-map.mjs`

Expected first result: either PASS or a named missing token. If a token is missing, add a clearly named CSS custom property under the existing VECTOR root/shell selector in `ux-overlay/vector-shell.css`:

```css
.vector-ui-active {
  --vector-navy-surface: #0f172a;
  --vector-blue-action: #2563eb;
  --vector-white-panel: #ffffff;
  --vector-light-background: #f8fafc;
}
```

Run again: `node scripts/vector-source-map.mjs`

Expected final result: PASS with all `requiredTokens` true.

- [ ] **Step 3: Commit**

```bash
git add scripts/vector-source-map.mjs ux-overlay/vector-shell.css
git commit -m "test: guard approved vector visual family"
```

## Task 3: Add role-scoped mobile view contract to the overlay

**Files:**
- Modify: `ux-overlay/vector-shell.js`
- Modify: `ux-overlay/vector-shell.css`
- Create: `scripts/vector-mobile-mass-clocking-proof.mjs`
- Test: `scripts/vector-mobile-mass-clocking-proof.mjs`

**Interfaces:**
- Consumes: current shell functions including `renderHome(content)`, `generalPage(content)`, `apply()`, and route helpers in `ux-overlay/vector-shell.js`.
- Produces: mobile role regions with stable selectors:
  - `[data-vector-role-home="employee"]`
  - `[data-vector-role-home="manager"]`
  - `[data-vector-role-home="plant"]`
  - `[data-vector-role-home="director"]`
  - `[data-vector-role-home="executive"]`

- [ ] **Step 1: Write the failing proof for employee role leakage**

Create `scripts/vector-mobile-mass-clocking-proof.mjs` with this initial static guard:

```js
import fs from 'node:fs';

const shellJs = fs.readFileSync('ux-overlay/vector-shell.js', 'utf8');
const shellCss = fs.readFileSync('ux-overlay/vector-shell.css', 'utf8');

const requiredSelectors = [
  'data-vector-role-home="employee"',
  'data-vector-role-home="manager"',
  'data-vector-role-home="plant"',
  'data-vector-role-home="director"',
  'data-vector-role-home="executive"'
];

const forbiddenEmployeeCopy = [
  'Multi-Site Command',
  'Business Outcome View',
  'finance margin',
  'executive outcome'
];

const result = {
  requiredSelectors: Object.fromEntries(requiredSelectors.map(selector => [selector, shellJs.includes(selector)])),
  employeeLeakage: forbiddenEmployeeCopy.filter(copy => {
    const employeeIndex = shellJs.indexOf('data-vector-role-home="employee"');
    if (employeeIndex < 0) return true;
    const employeeSlice = shellJs.slice(employeeIndex, employeeIndex + 2500);
    return employeeSlice.toLowerCase().includes(copy.toLowerCase());
  }),
  cssHasPhoneLayout: /@media[^{}]*max-width:\s*760px/i.test(shellCss) || /@media[^{}]*max-width:\s*768px/i.test(shellCss)
};

const missing = Object.entries(result.requiredSelectors).filter(([, present]) => !present).map(([selector]) => selector);
const failures = [
  ...missing.map(selector => `Missing role selector: ${selector}`),
  ...result.employeeLeakage.map(copy => `Employee role leaks restricted copy: ${copy}`),
  ...(result.cssHasPhoneLayout ? [] : ['Missing phone layout media query'])
];

console.log(JSON.stringify(result, null, 2));

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
```

- [ ] **Step 2: Run the proof and confirm it fails for missing role selectors**

Run: `node scripts/vector-mobile-mass-clocking-proof.mjs`

Expected: FAIL naming the missing `data-vector-role-home` selectors.

- [ ] **Step 3: Add role-scoped mobile cards**

Add focused role markup functions in `ux-overlay/vector-shell.js` near `renderHome(content)`:

```js
function vectorRoleHomeMarkup(){
  return `
  <section class="vector-role-strip" aria-label="Role workspaces">
    <article class="vector-role-card" data-vector-role-home="employee">
      <b>My Work Assistant</b>
      <span>Next shift, clock state, leave, tasks, and messages.</span>
      <button type="button" data-vector-route="personal">Open my work</button>
    </article>
    <article class="vector-role-card" data-vector-role-home="manager">
      <b>My Shift Copilot</b>
      <span>Cover, absence, exceptions, and shift actions for today.</span>
      <button type="button" data-vector-route="time-review">Review shift</button>
    </article>
    <article class="vector-role-card" data-vector-role-home="plant">
      <b>Live Factory Control</b>
      <span>Line readiness, labour variance, skill cover, and safe actions.</span>
      <button type="button" data-vector-route="overview">Open control</button>
    </article>
    <article class="vector-role-card" data-vector-role-home="director">
      <b>Multi-Site Command</b>
      <span>Authorised site rollups, risk, cost movement, and actions.</span>
      <button type="button" data-vector-route="insights">Open command</button>
    </article>
    <article class="vector-role-card" data-vector-role-home="executive">
      <b>Business Outcome View</b>
      <span>Authorised outcomes, trend, and decision evidence.</span>
      <button type="button" data-vector-route="insights">Open outcomes</button>
    </article>
  </section>`;
}
```

Then place `${vectorRoleHomeMarkup()}` inside the existing `home.innerHTML` in `renderHome(content)`, after the welcome section and before the KPI grid.

- [ ] **Step 4: Add responsive CSS for the role strip**

Add to `ux-overlay/vector-shell.css`:

```css
.vector-role-strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
  margin: 14px 0;
}

.vector-role-card {
  border: 1px solid rgba(37, 99, 235, 0.16);
  border-radius: 18px;
  background: #ffffff;
  box-shadow: 0 14px 36px rgba(15, 23, 42, 0.08);
  padding: 14px;
  color: #0f172a;
}

.vector-role-card b,
.vector-role-card span {
  display: block;
}

.vector-role-card span {
  margin-top: 6px;
  color: #475569;
  font-size: 0.88rem;
}

.vector-role-card button {
  margin-top: 12px;
  border: 0;
  border-radius: 999px;
  background: #2563eb;
  color: #ffffff;
  padding: 9px 12px;
  font-weight: 700;
}

@media (max-width: 980px) {
  .vector-role-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .vector-role-strip {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 5: Run the role proof**

Run: `node scripts/vector-mobile-mass-clocking-proof.mjs`

Expected: PASS. The employee card must not contain director, executive, finance, or multi-site copy.

- [ ] **Step 6: Commit**

```bash
git add ux-overlay/vector-shell.js ux-overlay/vector-shell.css scripts/vector-mobile-mass-clocking-proof.mjs
git commit -m "feat: add vector role mobile workspaces"
```

## Task 4: Add tablet Mass Clock Mode UI shell and event contract

**Files:**
- Modify: `ux-overlay/vector-shell.js`
- Modify: `ux-overlay/vector-shell.css`
- Modify: `scripts/vector-mobile-mass-clocking-proof.mjs`
- Test: `scripts/vector-mobile-mass-clocking-proof.mjs`

**Interfaces:**
- Consumes: existing kiosk sync endpoint contract observed in `scripts/live-isolation-kiosk-proof.mjs`: `POST /api/kiosk/devices/register`, `POST /api/kiosk/sync`, event fields `eventId`, `sequence`, `employee`, `type`, `capturedAt`, and `clockOffsetMs`.
- Produces: stable tablet selectors:
  - `[data-vector-tablet-clock]`
  - `[data-vector-clock-event-id]`
  - `[data-vector-clock-pending]`
  - `[data-vector-clock-sync]`

- [ ] **Step 1: Extend the proof with Mass Clock selectors and endpoint contract**

Add this after the `failures` array is declared in `scripts/vector-mobile-mass-clocking-proof.mjs`:

```js
const massClockSelectors = [
  'data-vector-tablet-clock',
  'data-vector-clock-event-id',
  'data-vector-clock-pending',
  'data-vector-clock-sync'
];

const kioskProof = fs.existsSync('scripts/live-isolation-kiosk-proof.mjs')
  ? fs.readFileSync('scripts/live-isolation-kiosk-proof.mjs', 'utf8')
  : '';

const kioskContract = {
  register: kioskProof.includes('/api/kiosk/devices/register'),
  sync: kioskProof.includes('/api/kiosk/sync'),
  eventId: kioskProof.includes('eventId'),
  sequence: kioskProof.includes('sequence'),
  capturedAt: kioskProof.includes('capturedAt'),
  clockOffsetMs: kioskProof.includes('clockOffsetMs')
};

result.massClockSelectors = Object.fromEntries(massClockSelectors.map(selector => [selector, shellJs.includes(selector)]));
result.kioskContract = kioskContract;

for (const [selector, present] of Object.entries(result.massClockSelectors)) {
  if (!present) failures.push(`Missing mass clock selector: ${selector}`);
}

for (const [field, present] of Object.entries(kioskContract)) {
  if (!present) failures.push(`Missing kiosk event contract evidence: ${field}`);
}
```

- [ ] **Step 2: Run the proof and confirm it fails for missing Mass Clock selectors**

Run: `node scripts/vector-mobile-mass-clocking-proof.mjs`

Expected: FAIL naming the missing `data-vector-tablet-clock` selectors while kiosk contract fields pass.

- [ ] **Step 3: Add Mass Clock Mode markup**

Add this function in `ux-overlay/vector-shell.js` near the role markup:

```js
function vectorMassClockMarkup(){
  const eventSeed = 'pending-' + new Date().toISOString().slice(0, 10);
  return `
  <section class="vector-tablet-clock" data-vector-tablet-clock aria-label="Tablet Mass Clock Mode">
    <div>
      <b>Mass Clock Mode</b>
      <span>Registered tablet capture for QR, PIN, or badge events.</span>
    </div>
    <div class="vector-clock-actions">
      <button type="button" data-vector-clock-event-id="${eventSeed}-in">Clock in group</button>
      <button type="button" data-vector-clock-event-id="${eventSeed}-out">Clock out group</button>
      <span data-vector-clock-pending>Pending sync: 0</span>
      <button type="button" data-vector-clock-sync>Sync now</button>
    </div>
  </section>`;
}
```

Place `${vectorMassClockMarkup()}` in `renderHome(content)` after `${vectorRoleHomeMarkup()}`.

- [ ] **Step 4: Add Mass Clock responsive CSS**

Add to `ux-overlay/vector-shell.css`:

```css
.vector-tablet-clock {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-radius: 22px;
  padding: 16px;
  margin: 14px 0;
  background: linear-gradient(135deg, #eff6ff 0%, #ffffff 58%, #dbeafe 100%);
  border: 1px solid rgba(37, 99, 235, 0.18);
  color: #0f172a;
}

.vector-tablet-clock b,
.vector-tablet-clock span {
  display: block;
}

.vector-clock-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.vector-clock-actions button {
  border: 0;
  border-radius: 999px;
  background: #2563eb;
  color: #ffffff;
  padding: 10px 14px;
  font-weight: 800;
}

.vector-clock-actions [data-vector-clock-pending] {
  border-radius: 999px;
  background: #ffffff;
  border: 1px solid rgba(37, 99, 235, 0.22);
  color: #1e3a8a;
  padding: 9px 12px;
  font-weight: 700;
}

@media (max-width: 760px) {
  .vector-tablet-clock {
    align-items: stretch;
    flex-direction: column;
  }

  .vector-clock-actions {
    flex-direction: column;
    align-items: stretch;
  }
}
```

- [ ] **Step 5: Run proof**

Run: `node scripts/vector-mobile-mass-clocking-proof.mjs`

Expected: PASS with all Mass Clock selectors present and kiosk event contract evidence true.

- [ ] **Step 6: Commit**

```bash
git add ux-overlay/vector-shell.js ux-overlay/vector-shell.css scripts/vector-mobile-mass-clocking-proof.mjs
git commit -m "feat: add vector tablet mass clock mode shell"
```

## Task 5: Wire pending and accepted clock-state behaviour without pretending acceptance before sync

**Files:**
- Modify: `ux-overlay/vector-shell.js`
- Modify: `scripts/vector-mobile-mass-clocking-proof.mjs`
- Test: `scripts/vector-mobile-mass-clocking-proof.mjs` and `scripts/live-isolation-kiosk-proof.mjs`

**Interfaces:**
- Consumes: Mass Clock selectors from Task 4.
- Produces: client functions:
  - `vectorBuildClockEvent(employee, type, sequence, capturedAt, clockOffsetMs)`
  - `vectorQueueClockEvent(event)`
  - `vectorPendingClockEvents()`
  - `vectorMarkClockEventsAccepted(eventIds)`

- [ ] **Step 1: Extend proof for queue function names and pending language**

Add this to `scripts/vector-mobile-mass-clocking-proof.mjs` after the `failures` array is declared and before the final failure check:

```js
const queueFunctions = [
  'function vectorBuildClockEvent',
  'function vectorQueueClockEvent',
  'function vectorPendingClockEvents',
  'function vectorMarkClockEventsAccepted'
];

result.queueFunctions = Object.fromEntries(queueFunctions.map(name => [name, shellJs.includes(name)]));

for (const [name, present] of Object.entries(result.queueFunctions)) {
  if (!present) failures.push(`Missing clock queue function: ${name}`);
}

if (/accepted sync:\s*0|synced before server|auto accepted/i.test(shellJs)) {
  failures.push('Clock UI implies acceptance before server sync.');
}
```

- [ ] **Step 2: Run proof and confirm it fails for missing queue functions**

Run: `node scripts/vector-mobile-mass-clocking-proof.mjs`

Expected: FAIL naming the four missing queue functions.

- [ ] **Step 3: Add queue helpers in the overlay**

Add this block to `ux-overlay/vector-shell.js` before `vectorMassClockMarkup()`:

```js
const VECTOR_CLOCK_QUEUE_KEY = 'vector.massClock.pending.v1';

function vectorPendingClockEvents(){
  try {
    const parsed = JSON.parse(localStorage.getItem(VECTOR_CLOCK_QUEUE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function vectorStoreClockEvents(events){
  localStorage.setItem(VECTOR_CLOCK_QUEUE_KEY, JSON.stringify(events));
}

function vectorBuildClockEvent(employee, type, sequence, capturedAt, clockOffsetMs){
  const safeType = type === 'out' ? 'out' : 'in';
  const safeEmployee = String(employee || '').trim();
  const safeSequence = Number.isFinite(Number(sequence)) ? Number(sequence) : Date.now();
  const safeCapturedAt = capturedAt || new Date().toISOString();
  const safeOffset = Number.isFinite(Number(clockOffsetMs)) ? Number(clockOffsetMs) : 0;
  return {
    eventId: ['vector', safeEmployee || 'unknown', safeType, safeSequence, safeCapturedAt].join(':'),
    sequence: safeSequence,
    employee: safeEmployee,
    type: safeType,
    capturedAt: safeCapturedAt,
    clockOffsetMs: safeOffset,
    status: 'pending'
  };
}

function vectorQueueClockEvent(event){
  const existing = vectorPendingClockEvents();
  if (!event || !event.eventId) return existing;
  if (!existing.some(item => item.eventId === event.eventId)) {
    existing.push(event);
    vectorStoreClockEvents(existing);
  }
  vectorRefreshClockPending();
  return existing;
}

function vectorMarkClockEventsAccepted(eventIds){
  const accepted = new Set(eventIds || []);
  const remaining = vectorPendingClockEvents().filter(event => !accepted.has(event.eventId));
  vectorStoreClockEvents(remaining);
  vectorRefreshClockPending();
  return remaining;
}

function vectorRefreshClockPending(){
  const target = document.querySelector('[data-vector-clock-pending]');
  if (target) target.textContent = 'Pending sync: ' + vectorPendingClockEvents().length;
}
```

- [ ] **Step 4: Bind the clock buttons to pending queue state**

Add this to the existing event delegation or startup binding in `ux-overlay/vector-shell.js`:

```js
document.addEventListener('click', event => {
  const action = event.target.closest('[data-vector-clock-event-id]');
  if (!action) return;
  const type = action.getAttribute('data-vector-clock-event-id')?.endsWith('-out') ? 'out' : 'in';
  const employee = document.querySelector('[data-vector-current-employee]')?.textContent || displayName();
  vectorQueueClockEvent(vectorBuildClockEvent(employee, type, Date.now(), new Date().toISOString(), 0));
});
```

Call `vectorRefreshClockPending();` at the end of `apply()` after the shell has rendered.

- [ ] **Step 5: Run proof scripts**

Run: `node scripts/vector-mobile-mass-clocking-proof.mjs`

Expected: PASS.

Run: `node scripts/live-isolation-kiosk-proof.mjs`

Expected: PASS against the configured hosted target, including replay, sequence gap, revoke, and tenant isolation. If environment variables are required, record the missing variable names and do not claim hosted acceptance until the script runs.

- [ ] **Step 6: Commit**

```bash
git add ux-overlay/vector-shell.js scripts/vector-mobile-mass-clocking-proof.mjs
git commit -m "feat: keep mass clock events pending until accepted"
```

## Task 6: Add browser proof for desktop, tablet, and phone visual evidence

**Files:**
- Modify: `scripts/vector-mobile-mass-clocking-proof.mjs`
- Create directory: `release/proof/vector-mobile-mass-clocking/`
- Test: `scripts/vector-mobile-mass-clocking-proof.mjs`

**Interfaces:**
- Consumes: deployed or locally served app URL from `VECTOR_PROOF_BASE_URL`.
- Produces:
  - `release/proof/vector-mobile-mass-clocking/desktop.png`
  - `release/proof/vector-mobile-mass-clocking/tablet.png`
  - `release/proof/vector-mobile-mass-clocking/phone.png`
  - JSON printed with `visualFamily: "blue-white-approved"`

- [ ] **Step 1: Add URL-gated browser proof scaffolding**

Append this browser mode to `scripts/vector-mobile-mass-clocking-proof.mjs` after the static checks pass:

```js
if (process.env.VECTOR_PROOF_BASE_URL) {
  const { chromium } = await import('playwright');
  fs.mkdirSync('release/proof/vector-mobile-mass-clocking', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const contexts = [
    { name: 'desktop', viewport: { width: 1440, height: 1000 } },
    { name: 'tablet', viewport: { width: 1024, height: 1366 } },
    { name: 'phone', viewport: { width: 390, height: 844 } }
  ];

  for (const contextSpec of contexts) {
    const context = await browser.newContext({ viewport: contextSpec.viewport });
    const page = await context.newPage();
    await page.goto(process.env.VECTOR_PROOF_BASE_URL, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `release/proof/vector-mobile-mass-clocking/${contextSpec.name}.png`, fullPage: true });
    const bodyClass = await page.locator('body').evaluate(body => body.className);
    if (!String(bodyClass).includes('vector-ui-active')) {
      throw new Error(`VECTOR shell did not activate for ${contextSpec.name}`);
    }
    await context.close();
  }

  await browser.close();
  console.log(JSON.stringify({ visualFamily: 'blue-white-approved', screenshots: contexts.map(item => item.name) }, null, 2));
}
```

- [ ] **Step 2: Run static proof without a URL**

Run: `node scripts/vector-mobile-mass-clocking-proof.mjs`

Expected: PASS and no screenshots created when `VECTOR_PROOF_BASE_URL` is absent.

- [ ] **Step 3: Run browser proof with a real target**

Run: `VECTOR_PROOF_BASE_URL="$HOSTED_URL" node scripts/vector-mobile-mass-clocking-proof.mjs`

Expected: PASS and the three screenshot files exist. Review the screenshots against the four approved concept references:
- `Vector Factory Operations Dashboard Showcase.png`
- `Vector Directors & Ops AI Dashboard.png`
- `Vector Shift Pattern Dashboard.png`
- `Vector Workforce Management Dashboard Mockup.png`

- [ ] **Step 4: Commit**

```bash
git add scripts/vector-mobile-mass-clocking-proof.mjs release/proof/vector-mobile-mass-clocking
git commit -m "test: capture vector mobile visual proof"
```

## Task 7: Produce the release proof manifest

**Files:**
- Create: `release/vector-mobile-mass-clocking-proof.json`
- Modify: none
- Test: `node -e "JSON.parse(require('fs').readFileSync('release/vector-mobile-mass-clocking-proof.json','utf8')); console.log('proof manifest ok')"`

**Interfaces:**
- Consumes: Task 1 through Task 6 outputs, screenshot paths, source-map output, static proof output, kiosk proof output, hosted URL, commit SHA, and deployment identifier.
- Produces: proof manifest with `status`, `approvedVisualFamily`, `retiredReferencesExcluded`, `screenshots`, `functionalProof`, and `remainingGates`.

- [ ] **Step 1: Create the manifest only after hosted proof succeeds**

Create `release/vector-mobile-mass-clocking-proof.json` with the actual commit, hosted URL, and deployment identifier from the proof run. If those values are not yet available, create the blocked manifest shown here and do not claim pilot or production readiness:

```json
{
  "status": "blocked",
  "approvedVisualFamily": "blue-white",
  "retiredReferencesExcluded": [
    "VECTOR Workforce Operations Dashboard(1).png"
  ],
  "commit": null,
  "deployment": {
    "hostedUrl": null,
    "providerDeploymentId": null
  },
  "screenshots": {
    "desktop": "release/proof/vector-mobile-mass-clocking/desktop.png",
    "tablet": "release/proof/vector-mobile-mass-clocking/tablet.png",
    "phone": "release/proof/vector-mobile-mass-clocking/phone.png"
  },
  "functionalProof": {
    "sourceMap": "node scripts/vector-source-map.mjs",
    "mobileMassClock": "node scripts/vector-mobile-mass-clocking-proof.mjs",
    "kioskIsolation": "node scripts/live-isolation-kiosk-proof.mjs"
  },
  "remainingGates": [
    "hosted proof values not recorded yet"
  ]
}
```

When hosted proof succeeds, change `status` to `proof-complete`, set `commit`, `deployment.hostedUrl`, and `deployment.providerDeploymentId` to the real values, and set `remainingGates` to an empty array. If any proof is missing, keep `status` as `blocked` and name the missing proof in `remainingGates`.

- [ ] **Step 2: Validate the manifest**

Run: `node -e "JSON.parse(require('fs').readFileSync('release/vector-mobile-mass-clocking-proof.json','utf8')); console.log('proof manifest ok')"`

Expected: PASS with `proof manifest ok`.

- [ ] **Step 3: Commit**

```bash
git add release/vector-mobile-mass-clocking-proof.json
git commit -m "docs: record vector mobile mass clocking proof"
```

## Task 8: Final review before any production or pilot claim

**Files:**
- Modify only if review finds a defect.
- Test: all proof commands below.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: one reviewed branch that can be evaluated for deployment or pilot approval.

- [ ] **Step 1: Run the required verification commands**

```bash
node scripts/vector-source-map.mjs
node scripts/vector-mobile-mass-clocking-proof.mjs
node scripts/live-isolation-kiosk-proof.mjs
node -e "JSON.parse(require('fs').readFileSync('release/vector-mobile-mass-clocking-proof.json','utf8')); console.log('proof manifest ok')"
```

Expected: all commands PASS. If hosted environment variables are absent for the kiosk proof, record that as a blocker and do not mark pilot or production status as approved.

- [ ] **Step 2: Inspect screenshots**

Open:
- `release/proof/vector-mobile-mass-clocking/desktop.png`
- `release/proof/vector-mobile-mass-clocking/tablet.png`
- `release/proof/vector-mobile-mass-clocking/phone.png`

Expected: blue VECTOR mark, navy navigation, white/light panels, blue primary actions, and no retired green/black concept styling.

- [ ] **Step 3: Confirm role and clocking outcomes**

Confirm from proof output:
- employee view excludes director/executive/finance/multi-site controls,
- manager/plant views expose shift and readiness actions,
- tablet clocking shows pending events before sync,
- duplicate/replay handling is proven by `scripts/live-isolation-kiosk-proof.mjs`,
- tenant injection and revoked-device cases are rejected.

- [ ] **Step 4: Commit fixes or prepare the branch for review**

If Step 1 through Step 3 pass with no changes, do not create an empty commit. Prepare the branch summary with:
- what changed,
- screenshots captured,
- proof commands run,
- any remaining blockers.

## Self-Review

- Spec coverage: This plan covers approved blue-and-white visual direction, mobile role experiences, tablet Mass Clock Mode, offline pending state, duplicate/replay proof, tenant/revoke proof, screenshots, and release manifest. It does not implement native packaging because the spec says responsive/PWA comes first and native packaging is evidence-driven.
- Placeholder scan: The plan avoids open-ended implementation placeholders. The proof manifest includes explicit replacement values and says to mark blocked rather than invent proof.
- Type consistency: The function names and selectors introduced in Tasks 3 through 5 are reused consistently by the proof script and CSS.
- Review Focus mapping: wrong visual family is tested in Task 2 and Task 6; offline restart/pending state is owned by Task 5; duplicate submission is owned by Task 5 through the existing kiosk proof; role leakage is owned by Task 3; fixture confusion is owned by Task 7 and Task 8.
