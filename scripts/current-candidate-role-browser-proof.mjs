import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const origin = new URL(process.env.VECTOR_PROOF_URL).origin;
const expectedSha = process.env.WFM_EXPECTED_CANDIDATE_SHA;
const password = process.env.WFM_STAGING_PASSWORD;
const requireActionAffordanceCoverage = process.env.WFM_REQUIRE_ACTION_AFFORDANCE_COVERAGE === 'true';
export let browserProofEvidence = { leaveJourney: null, attendanceJourney: null };

assert.match(expectedSha || '', /^[0-9a-f]{40}$/);
assert.ok(password && password.length >= 20, 'Staging password unavailable.');

const specs = [
  { slug: 'manager', email: 'manager@northstar.example', role: 'manager', tenant: 'northstar-demo', payroll: 403, surface: '/api/time-review', nav: 'Time & Attendance' },
  { slug: 'employee', email: 'maya@northstar.example', role: 'employee', tenant: 'northstar-demo', payroll: 403, surface: '/api/personal', nav: null },
  { slug: 'payroll', email: 'payroll@northstar.example', role: 'payroll_admin', tenant: 'northstar-demo', payroll: 200, surface: '/api/payroll-run', nav: 'Reports' },
  { slug: 'company-admin', email: 'superuser@northstar.example', role: 'director', tenant: 'northstar-demo', payroll: 200, surface: '/api/onboarding', nav: 'Integrations' },
  { slug: 'isolation-manager', email: 'other@isolation.example', role: 'manager', tenant: 'isolation-test', payroll: 403, surface: '/api/bootstrap', nav: 'Time & Attendance' }
];

const healthResponse = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(15000) });
assert.equal(healthResponse.status, 200);
const health = await healthResponse.json();
assert.equal(health.fixtureOnly, true);
assert.equal(health.productionApproved, false);

const browser = await chromium.launch({ headless: true });
const receipts = [];
let navigationClicks = 0;
let timeReviewActionJourneys = 0;
let timeReviewEmptyStateJourneys = 0;
let managerAlignmentEvidence = null;

async function loginRole(page, email) {
  const first = await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
  assert.ok(first && first.status() < 500, `${email} initial page failed.`);
  const loginStatus = await page.evaluate(async ({ email, password }) => {
    const response = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
    });
    return response.status;
  }, { email, password });
  assert.equal(loginStatus, 200, `${email} login failed.`);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('.vector-shell,.vector-sidebar,[class*=vector-]').length > 0, { timeout: 30000 });
}

async function openLeaveRoute(page, expectedRole) {
  const route = page.locator('[data-vector-route="leave"]').first();
  await route.waitFor({ state: 'visible', timeout: 10000 });
  await route.click({ timeout: 5000 });
  await page.locator(`[data-vector-leave-route="${expectedRole}"]`).waitFor({ state: 'visible', timeout: 10000 });
}

async function openWeeklyRoute(page, teamId) {
  const timeAttendance = page.getByText('Time & Attendance', { exact: true }).first();
  await timeAttendance.waitFor({ state: 'visible', timeout: 10000 });
  await timeAttendance.click({ timeout: 5000 });
  const weekly = page.locator('button[data-vector-workflow="weekly"]').first();
  await weekly.waitFor({ state: 'visible', timeout: 10000 });
  await weekly.click({ timeout: 5000 });
  const team = page.locator('#vw-team');
  await team.waitFor({ state: 'visible', timeout: 10000 });
  await team.selectOption(teamId);
}

try {
  for (const spec of specs) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error?.stack || error)));

    const first = await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
    assert.ok(first && first.status() < 500, `${spec.slug} initial page failed.`);

    const unauthenticatedBootstrap = await page.evaluate(async () => (await fetch('/api/bootstrap')).status);
    assert.equal(unauthenticatedBootstrap, 401, `${spec.slug} bootstrap did not fail closed.`);

    const loginStatus = await page.evaluate(async ({ email, password }) => {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      return response.status;
    }, { email: spec.email, password });
    assert.equal(loginStatus, 200, `${spec.slug} login failed.`);

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(
      () => document.querySelectorAll('.vector-shell,.vector-sidebar,[class*=vector-]').length > 0,
      { timeout: 30000 }
    );
    await page.waitForTimeout(400);

    const identity = await page.evaluate(async () => {
      const response = await fetch('/api/bootstrap');
      return { status: response.status, json: await response.json() };
    });
    assert.equal(identity.status, 200);
    assert.equal(identity.json.actor?.role, spec.role, `${spec.slug} role mismatch.`);
    assert.equal(identity.json.actor?.tenant, spec.tenant, `${spec.slug} tenant mismatch.`);

    const boundary = await page.evaluate(async ({ surface }) => {
      const payroll = await fetch('/api/payroll-run');
      const required = await fetch(surface);
      return { payroll: payroll.status, surface: required.status };
    }, { surface: spec.surface });
    assert.equal(boundary.payroll, spec.payroll, `${spec.slug} payroll boundary mismatch.`);
    assert.equal(boundary.surface, 200, `${spec.slug} required surface failed.`);

    const ui = await page.evaluate(async () => {
      const [scriptAsset, styleAsset, workflowAsset] = await Promise.all([
        fetch('/vector-ui.js', { cache: 'no-store' }),
        fetch('/vector-ui.css', { cache: 'no-store' }),
        fetch('/vector-workflows.js', { cache: 'no-store' })
      ]);
      const [scriptText, styleText, workflowText] = await Promise.all([scriptAsset.text(), styleAsset.text(), workflowAsset.text()]);
      const resources = performance.getEntriesByType('resource').map(entry => {
        try { return new URL(entry.name, location.href).pathname; } catch { return String(entry.name || ''); }
      });
      const retiredAssets = [
        'vector-shell.js',
        'review-ui.js',
        'review-ui.css',
        'factory-control-ui.css',
        'value-cockpit-ui.js',
        'value-cockpit-ui.css',
        'ui-evolution.css'
      ];
      const nodes = document.querySelectorAll('.vector-shell,.vector-sidebar,[class*=vector-]').length;
      const labels = [...new Set([...document.querySelectorAll('nav a,nav button,.vector-sidebar a,.vector-sidebar button')]
        .filter(node => node.getClientRects().length > 0)
        .map(node => (node.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean))];
      return {
        scriptAssetStatus: scriptAsset.status,
        styleAssetStatus: styleAsset.status,
        workflowAssetStatus: workflowAsset.status,
        approvedScript: scriptText.includes('VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1'),
        approvedStyle: styleText.includes('VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1'),
        approvedWorkflow: workflowText.includes('VECTOR_AUTHENTICATED_WORKFLOWS_V1'),
        retiredMarkers: ['WFM_UX_RESET_CYCLE11_BEGIN', 'WFM_UX_RESET_CYCLE12_BEGIN', 'VECTOR_PRIORITY_BRIDGE_V1']
          .filter(marker => scriptText.includes(marker) || styleText.includes(marker)),
        scriptExecuted: resources.includes('/vector-ui.js'),
        styleExecuted: resources.includes('/vector-ui.css'),
        workflowExecuted: resources.includes('/vector-workflows.js'),
        retiredExecuted: retiredAssets.filter(name => resources.some(path => path.endsWith(`/${name}`))),
        nodes,
        labels,
        bodyText: (document.body?.innerText || '').length,
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth
      };
    });
    assert.equal(ui.scriptAssetStatus, 200, `${spec.slug} canonical Vector script unavailable.`);
    assert.equal(ui.styleAssetStatus, 200, `${spec.slug} canonical Vector stylesheet unavailable.`);
    assert.equal(ui.workflowAssetStatus, 200, `${spec.slug} authenticated Vector workflow controller unavailable.`);
    assert.equal(ui.approvedScript, true, `${spec.slug} canonical Vector script marker missing.`);
    assert.equal(ui.approvedStyle, true, `${spec.slug} canonical Vector stylesheet marker missing.`);
    assert.equal(ui.approvedWorkflow, true, `${spec.slug} authenticated Vector workflow marker missing.`);
    assert.deepEqual(ui.retiredMarkers, [], `${spec.slug} retired presentation marker executed in canonical Vector assets.`);
    assert.equal(ui.scriptExecuted, true, `${spec.slug} canonical /vector-ui.js entrypoint was not loaded.`);
    assert.equal(ui.styleExecuted, true, `${spec.slug} canonical /vector-ui.css entrypoint was not loaded.`);
    assert.equal(ui.workflowExecuted, true, `${spec.slug} authenticated /vector-workflows.js entrypoint was not loaded.`);
    assert.deepEqual(ui.retiredExecuted, [], `${spec.slug} retired presentation asset executed: ${ui.retiredExecuted.join(', ')}`);
    assert.ok(ui.nodes > 0, `${spec.slug} Vector DOM missing.`);
    assert.ok(ui.bodyText > 200, `${spec.slug} rendered body too small.`);
    assert.ok(ui.scrollWidth <= ui.width + 1, `${spec.slug} desktop horizontal overflow.`);

    if (spec.slug === 'manager') {
      const previous = page.viewportSize();
      await page.setViewportSize({ width: 420, height: 294 });
      await page.waitForTimeout(150);
      const compact = await page.screenshot({
        type: 'jpeg',
        quality: 6,
        clip: { x: 0, y: 0, width: 420, height: 294 }
      });
      managerAlignmentEvidence = {
        base64: compact.toString('base64'),
        bytes: compact.length,
        sha256: crypto.createHash('sha256').update(compact).digest('hex')
      };
      await page.setViewportSize(previous || { width: 1440, height: 1000 });
    }

    const actionJourney = {
      evidenceStatus: null,
      activeItems: 0,
      mode: null,
      exercised: false,
      sourceId: null,
      renderedStatus: null,
      tabletStatusVisible: false,
      mobileStatusVisible: false,
      postOpenStillPresent: false,
      returnFocused: false,
      inventedActionCount: null,
      queueProof: null
    };

    if (spec.slug === 'employee') {
      actionJourney.evidenceStatus = await page.evaluate(async () => (await fetch('/api/workforce/lifecycle/action-evidence/time-review', { cache: 'no-store' })).status);
      assert.equal(actionJourney.evidenceStatus, 403, 'Employee unexpectedly received manager action evidence.');
    }

    if (spec.slug === 'manager') {
      const evidence = await page.evaluate(async () => {
        const response = await fetch('/api/workforce/lifecycle/action-evidence/time-review', { cache: 'no-store' });
        let json = null;
        try { json = await response.json(); } catch {}
        return { status: response.status, json };
      });
      actionJourney.evidenceStatus = evidence.status;
      assert.equal(evidence.status, 200, 'Manager action-evidence bridge unavailable.');
      assert.equal(evidence.json?.contractVersion, 'WFM_WORKFLOW_ACTION_EVIDENCE_V1');
      assert.equal(evidence.json?.workflow, 'time-review');

      const active = (Array.isArray(evidence.json?.items) ? evidence.json.items : [])
        .filter(item => String(item?.confirmation?.state || '').toLowerCase() !== 'resolved');
      actionJourney.activeItems = active.length;

      const awaitingStates = new Set(['decision_sent', 'confirming_source']);
      const expectedNeedsIds = active
        .filter(item => !awaitingStates.has(String(item?.confirmation?.state || '').toLowerCase()))
        .map(item => String(item?.sourceId || '').trim())
        .filter(Boolean);
      const expectedAwaitingIds = active
        .filter(item => awaitingStates.has(String(item?.confirmation?.state || '').toLowerCase()))
        .map(item => String(item?.sourceId || '').trim())
        .filter(Boolean);
      const expectedVisibleNeedsIds = expectedNeedsIds.slice(0, 4);
      const expectedVisibleAwaitingIds = expectedAwaitingIds.slice(0, 3);
      const affordanceCoverage = expectedNeedsIds.length > 0 && expectedAwaitingIds.length > 0 ? 'EXERCISED' : 'UNEXERCISED';

      if (requireActionAffordanceCoverage) {
        assert.ok(expectedNeedsIds.length > 0, 'Strict lifecycle-affordance proof requires at least one authoritative Needs my action row.');
        assert.ok(expectedAwaitingIds.length > 0, 'Strict lifecycle-affordance proof requires at least one authoritative Awaiting source confirmation row.');
      }

      if (active.length) {
        await page.waitForFunction(({ needsIds, awaitingIds }) => {
          const rendered = [...document.querySelectorAll('button[data-vector-source-id][data-vector-workflow="time-review"]')]
            .map(node => node.getAttribute('data-vector-source-id'))
            .filter(Boolean);
          return [...needsIds, ...awaitingIds].slice(0, 7).every(id => rendered.includes(id));
        }, { needsIds: expectedVisibleNeedsIds, awaitingIds: expectedVisibleAwaitingIds }, { timeout: 10000 });
      }

      const queueStates = [];
      for (const viewport of [
        { label: 'desktop', width: 1440, height: 1000 },
        { label: 'tablet', width: 760, height: 900 },
        { label: 'mobile', width: 390, height: 844 }
      ]) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.waitForTimeout(120);
        const queue = await page.evaluate(() => {
          const card = document.querySelector('.vector-alerts');
          const needsList = card?.querySelector(':scope > .vector-alert-list');
          const details = card?.querySelector('details[data-vector-awaiting-confirmation]');
          const summary = details?.querySelector('summary');
          const badge = document.querySelector('.vector-notification-count');
          const headerCount = Number(card?.querySelector('#vector-review-title em')?.textContent || '0');
          const summaryText = (summary?.textContent || '').replace(/\s+/g, ' ').trim();
          const awaitingMatch = summaryText.match(/(\d+)\s*$/);
          const actions = root => [...(root?.querySelectorAll('button[data-vector-source-id][data-vector-workflow="time-review"]') || [])]
            .map(node => ({
              sourceId: node.getAttribute('data-vector-source-id'),
              text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
              ariaLabel: node.getAttribute('aria-label') || ''
            }))
            .filter(action => action.sourceId);
          const sourceIds = root => actions(root).map(action => action.sourceId);
          const visible = node => !!node && node.getClientRects().length > 0;
          return {
            width: innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            headerCount,
            badgeHidden: !badge || badge.hidden,
            badgeCount: badge && !badge.hidden ? Number(badge.textContent || '0') : 0,
            needsSourceIds: sourceIds(needsList),
            needsActions: actions(needsList),
            needsRowsVisible: [...(needsList?.querySelectorAll('.vector-alert-row') || [])].every(visible),
            detailsPresent: !!details,
            detailsOpen: details?.open === true,
            summaryText,
            summaryVisible: visible(summary),
            awaitingCount: awaitingMatch ? Number(awaitingMatch[1]) : 0,
            awaitingSourceIds: sourceIds(details),
            awaitingActions: actions(details)
          };
        });

        assert.equal(queue.width, viewport.width, `${viewport.label} queue viewport mismatch.`);
        assert.ok(queue.scrollWidth <= viewport.width + 1, `${viewport.label} queue introduced horizontal overflow.`);
        assert.deepEqual(queue.needsSourceIds, expectedVisibleNeedsIds, `${viewport.label} Needs my action contains the wrong source-bound Time Review rows.`);
        assert.deepEqual(queue.needsActions.map(action => action.text), expectedVisibleNeedsIds.map(() => 'Review'), `${viewport.label} Needs my action did not retain the active Review affordance.`);
        assert.equal(queue.needsActions.every(action => action.ariaLabel.startsWith('Review ')), true, `${viewport.label} actionable accessible labels diverged from Review.`);
        assert.equal(queue.needsRowsVisible, true, `${viewport.label} actionable queue rows are not visible.`);
        assert.equal(queue.headerCount >= expectedNeedsIds.length, true, `${viewport.label} Needs my action count dropped source-bound actionable work.`);
        assert.equal(queue.badgeCount, queue.headerCount, `${viewport.label} notification badge diverged from Needs my action count.`);
        assert.equal(queue.badgeHidden, queue.headerCount === 0, `${viewport.label} notification badge visibility diverged from actionable work.`);
        assert.equal(queue.awaitingCount, expectedAwaitingIds.length, `${viewport.label} awaiting-source summary count diverged from authoritative state.`);
        assert.deepEqual(queue.awaitingSourceIds, expectedVisibleAwaitingIds, `${viewport.label} Awaiting source confirmation contains the wrong source-bound Time Review rows.`);
        assert.deepEqual(queue.awaitingActions.map(action => action.text), expectedVisibleAwaitingIds.map(() => 'View status'), `${viewport.label} awaiting-source work did not retain the passive View status affordance.`);
        assert.equal(queue.awaitingActions.every(action => action.ariaLabel.startsWith('View status ')), true, `${viewport.label} awaiting-source accessible labels diverged from View status.`);
        assert.equal(queue.detailsPresent, expectedAwaitingIds.length > 0, `${viewport.label} awaiting-source disclosure presence diverged from authoritative state.`);
        assert.equal(queue.detailsOpen, false, `${viewport.label} awaiting-source disclosure was not calm-by-default.`);
        if (expectedAwaitingIds.length > 0) {
          assert.equal(queue.summaryVisible, true, `${viewport.label} awaiting-source summary is not visible.`);
          assert.notEqual(queue.badgeCount, queue.headerCount + queue.awaitingCount, `${viewport.label} awaiting-source work inflated the action-needed badge.`);
          const summary = page.locator('[data-vector-awaiting-confirmation] > summary').first();
          await summary.focus();
          await page.keyboard.press('Enter');
          const opened = await page.locator('[data-vector-awaiting-confirmation]').first().evaluate(node => ({
            open: node.open === true,
            buttons: [...node.querySelectorAll('button[data-vector-source-id][data-vector-workflow="time-review"]')]
              .map(button => ({
                visible: button.getClientRects().length > 0,
                text: (button.textContent || '').replace(/\s+/g, ' ').trim(),
                ariaLabel: button.getAttribute('aria-label') || ''
              })),
            scrollWidth: document.documentElement.scrollWidth,
            width: innerWidth
          }));
          assert.equal(opened.open, true, `${viewport.label} awaiting-source disclosure did not open from keyboard.`);
          assert.equal(opened.buttons.every(button => button.visible), true, `${viewport.label} awaiting-source rows are not visible after disclosure.`);
          assert.equal(opened.buttons.every(button => button.text === 'View status'), true, `${viewport.label} visible awaiting-source buttons did not read View status.`);
          assert.equal(opened.buttons.every(button => button.ariaLabel.startsWith('View status ')), true, `${viewport.label} visible awaiting-source accessible labels diverged from View status.`);
          assert.ok(opened.scrollWidth <= opened.width + 1, `${viewport.label} opened awaiting-source disclosure introduced horizontal overflow.`);
          await page.keyboard.press('Enter');
          assert.equal(await page.locator('[data-vector-awaiting-confirmation]').first().evaluate(node => node.open === true), false, `${viewport.label} awaiting-source disclosure did not close from keyboard.`);
        }
        queueStates.push({ label: viewport.label, ...queue });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      actionJourney.queueProof = {
        expectedNeeds: expectedNeedsIds.length,
        expectedAwaiting: expectedAwaitingIds.length,
        affordanceCoverage,
        viewports: queueStates.map(({ label, headerCount, badgeCount, awaitingCount, detailsPresent, detailsOpen }) => ({ label, headerCount, badgeCount, awaitingCount, detailsPresent, detailsOpen }))
      };
      console.log(`CURRENT_ACTION_QUEUE_GROUPING=PASS|needsSource=${expectedNeedsIds.length}|awaitingSource=${expectedAwaitingIds.length}|viewports=3|affordanceCoverage=${affordanceCoverage}|reviewVerified=${expectedNeedsIds.length > 0}|viewStatusVerified=${expectedAwaitingIds.length > 0}`);

      if (active.length === 0) {
        const renderedActions = page.locator('.vector-alert-row button[data-vector-source-id][data-vector-workflow="time-review"]');
        actionJourney.inventedActionCount = await renderedActions.count();
        assert.equal(actionJourney.inventedActionCount, 0, 'Vector invented a Time Review action while the authoritative source had none.');
        actionJourney.mode = 'authoritative-empty-state';
        timeReviewEmptyStateJourneys += 1;
        console.log('CURRENT_TIME_REVIEW_EMPTY_STATE=PASS|active=0|invented=0');
      } else {
        let actionButton = page.locator('.vector-alerts > .vector-alert-list .vector-alert-row button[data-vector-source-id][data-vector-workflow="time-review"]').first();
        if (await actionButton.count() === 0) {
          const awaiting = page.locator('[data-vector-awaiting-confirmation]').first();
          await awaiting.locator('summary').click({ timeout: 5000 });
          actionButton = awaiting.locator('.vector-alert-row button[data-vector-source-id][data-vector-workflow="time-review"]').first();
        }
        await actionButton.waitFor({ state: 'visible', timeout: 10000 });
        const sourceId = await actionButton.getAttribute('data-vector-source-id');
        const sourceItem = active.find(item => String(item?.sourceId || '') === sourceId);
        assert.ok(sourceId && sourceItem, 'Rendered action is not bound to active source evidence.');
        actionJourney.sourceId = sourceId;

        const expectedStatus = ({
          action_required: 'Action required',
          decision_sent: 'Decision sent',
          confirming_source: 'Confirming source',
          needs_verification: 'Needs verification',
          resolved: 'Resolved'
        })[String(sourceItem?.confirmation?.state || '').toLowerCase()] || 'Needs review';
        const readRenderedStatus = () => actionButton.evaluate(button => {
          const node = button.closest('.vector-alert-row')?.querySelector('[data-vector-action-status]');
          return node ? {
            value: node.getAttribute('data-vector-action-status'),
            text: (node.textContent || '').replace(/^\s*·\s*/, '').trim(),
            visible: node.getClientRects().length > 0
          } : null;
        });
        const desktopStatus = await readRenderedStatus();
        assert.equal(desktopStatus?.value, expectedStatus, 'Visible lifecycle data attribute diverged from authoritative source state.');
        assert.equal(desktopStatus?.text, expectedStatus, 'Visible lifecycle text diverged from authoritative source state.');
        assert.equal(desktopStatus?.visible, true, 'Authoritative lifecycle is not visibly rendered on desktop.');
        actionJourney.renderedStatus = expectedStatus;

        await page.setViewportSize({ width: 760, height: 900 });
        actionJourney.tabletStatusVisible = (await readRenderedStatus())?.visible === true;
        assert.equal(actionJourney.tabletStatusVisible, true, 'Authoritative lifecycle is hidden on tablet.');
        await page.setViewportSize({ width: 390, height: 844 });
        actionJourney.mobileStatusVisible = (await readRenderedStatus())?.visible === true;
        assert.equal(actionJourney.mobileStatusVisible, true, 'Authoritative lifecycle is hidden on mobile.');
        await page.setViewportSize({ width: 1440, height: 1000 });
        const stableStatus = await readRenderedStatus();
        assert.equal(stableStatus?.value, expectedStatus, 'Responsive presentation mutated the authoritative lifecycle state.');

        await actionButton.click({ timeout: 5000 });
        const returnButton = page.locator('[data-vector-return-context]').first();
        await returnButton.waitFor({ state: 'visible', timeout: 10000 });
        const contextSourceId = await page.locator('[data-vector-action-context]').first().getAttribute('data-vector-source-id');
        assert.equal(contextSourceId, sourceId, 'Time Review lost the originating source action context.');

        const postOpen = await page.evaluate(async () => {
          const response = await fetch('/api/workforce/lifecycle/action-evidence/time-review', { cache: 'no-store' });
          return { status: response.status, json: await response.json() };
        });
        assert.equal(postOpen.status, 200);
        actionJourney.postOpenStillPresent = (Array.isArray(postOpen.json?.items) ? postOpen.json.items : [])
          .some(item => String(item?.sourceId || '') === sourceId && String(item?.confirmation?.state || '').toLowerCase() !== 'resolved');
        assert.equal(actionJourney.postOpenStillPresent, true, 'Opening Time Review optimistically cleared the source action.');

        await returnButton.click({ timeout: 5000 });
        await page.locator('.vector-alerts').first().waitFor({ state: 'visible', timeout: 10000 });
        await page.waitForFunction(() => document.activeElement?.classList?.contains('vector-alerts'));
        actionJourney.returnFocused = await page.evaluate(() => document.activeElement?.classList?.contains('vector-alerts') === true);
        assert.equal(actionJourney.returnFocused, true, 'Return-to-context did not restore focus to Items to review.');
        const storedContext = await page.evaluate(() => sessionStorage.getItem('VECTOR_ACTION_RETURN_CONTEXT_V1'));
        assert.equal(storedContext, null, 'Action return context persisted after returning Home.');
        actionJourney.mode = 'active-source-action';
        actionJourney.exercised = true;
        timeReviewActionJourneys += 1;
        console.log(`CURRENT_TIME_REVIEW_ACTION_JOURNEY=PASS|source=${sourceId}|status=${expectedStatus}|active=${active.length}`);
      }
    }

    let navigationClicked = null;
    if (spec.nav) {
      const locator = page.getByText(spec.nav, { exact: true }).first();
      if (await locator.count()) {
        await locator.click({ timeout: 5000 });
        await page.waitForTimeout(300);
        navigationClicked = spec.nav;
        navigationClicks += 1;
      }
    }

    const screenshot = await page.screenshot({ fullPage: true });
    assert.ok(screenshot.length > 10000, `${spec.slug} screenshot too small.`);
    const screenshotSha256 = crypto.createHash('sha256').update(screenshot).digest('hex');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    const mobile = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(mobile.scrollWidth <= mobile.width + 1, `${spec.slug} mobile horizontal overflow.`);

    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => ({ tag: document.activeElement?.tagName || '', body: document.activeElement === document.body }));
    assert.equal(focus.body, false, `${spec.slug} keyboard focus remained on body.`);
    assert.deepEqual(pageErrors, [], `${spec.slug} uncaught page errors: ${pageErrors.join(' | ')}`);

    receipts.push({
      slug: spec.slug,
      role: spec.role,
      tenant: spec.tenant,
      unauthenticatedBootstrap,
      loginStatus,
      payrollStatus: boundary.payroll,
      requiredSurface: spec.surface,
      requiredSurfaceStatus: boundary.surface,
      vectorApproved: ui.approvedScript && ui.approvedStyle && ui.approvedWorkflow,
      vectorExecuted: ui.scriptExecuted && ui.styleExecuted && ui.workflowExecuted,
      retiredPresentationExecuted: ui.retiredExecuted,
      vectorNodes: ui.nodes,
      visibleNavigation: ui.labels,
      navigationClicked,
      desktopOverflow: ui.scrollWidth - ui.width,
      mobileOverflow: mobile.scrollWidth - mobile.width,
      keyboardFocusTag: focus.tag,
      screenshotSha256,
      actionJourney,
      pageErrors
    });
    console.log(`CURRENT_ROLE_BROWSER_PASS=${spec.slug}|role=${spec.role}|tenant=${spec.tenant}|nav=${navigationClicked || 'not-applicable'}|shot=${screenshotSha256.slice(0, 16)}`);
    await context.close();
  }

  const leaveJourney = {
    employeeUiSubmitted: false,
    pendingStateReadBack: false,
    overlapRefusedInUi: false,
    refreshedUiRetainedPending: false,
    managerUiDecided: false,
    managerStateReadBack: false,
    requestAuditLinked: false,
    freshEmployeeLoginSawDecision: false,
    freshBalanceReconciled: false,
    balanceTransition: null,
    requestId: null,
    decision: null
  };
  const employeeContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const employeePage = await employeeContext.newPage();
  await loginRole(employeePage, 'maya@northstar.example');
  await openLeaveRoute(employeePage, 'employee');
  const beforeLeave = await employeePage.evaluate(async () => {
    const [bootstrapResponse, personalResponse] = await Promise.all([fetch('/api/bootstrap'), fetch('/api/personal')]);
    return { bootstrap: await bootstrapResponse.json(), personal: await personalResponse.json() };
  });
  const existingDates = new Set((beforeLeave.bootstrap?.state?.requests || []).filter(item => item.status !== 'declined').map(item => item.date || item.start));
  const shift = (beforeLeave.personal?.shifts || []).find(item => item?.start && !existingDates.has(item.start.slice(0, 10)));
  assert.ok(shift, 'No unrequested synthetic shift is available for the leave browser journey.');
  const requestedDate = shift.start.slice(0, 10);
  await employeePage.locator('button[data-vector-workflow="leave-request"]').click({ timeout: 5000 });
  await employeePage.locator('#modalform input[name="date"]').fill(requestedDate);
  await employeePage.locator('#modalform input[name="hours"]').fill('7.5');
  await employeePage.locator('#modalform button[type="submit"]').click({ timeout: 5000 });
  await employeePage.locator('.vw-receipt').waitFor({ state: 'visible', timeout: 10000 });
  const afterRequest = await employeePage.evaluate(async () => {
    const [bootstrapResponse, personalResponse] = await Promise.all([fetch('/api/bootstrap'), fetch('/api/personal')]);
    return { bootstrap: await bootstrapResponse.json(), personal: await personalResponse.json() };
  });
  const beforeIds = new Set((beforeLeave.bootstrap?.state?.requests || []).map(item => item.id));
  const created = (afterRequest.bootstrap?.state?.requests || []).find(item => !beforeIds.has(item.id));
  assert.ok(created?.id && created.status === 'pending', 'Employee UI did not create a source-saved pending leave request.');
  assert.equal(afterRequest.personal.leave.pendingMinutes, beforeLeave.personal.leave.pendingMinutes + 450, 'Employee UI did not add the requested minutes to the pending leave balance.');
  assert.equal(afterRequest.personal.leave.bookedMinutes, beforeLeave.personal.leave.bookedMinutes, 'A pending leave request changed the approved booked balance.');
  assert.equal(afterRequest.personal.leave.remainingMinutes, beforeLeave.personal.leave.remainingMinutes, 'A pending leave request changed the remaining-after-bookings balance.');
  assert.equal(afterRequest.personal.leave.availableMinutes, beforeLeave.personal.leave.availableMinutes - 450, 'Employee UI did not read back the reserved leave balance.');
  leaveJourney.employeeUiSubmitted = true;
  leaveJourney.pendingStateReadBack = true;
  leaveJourney.requestId = created.id;

  await employeePage.locator('button[data-vector-workflow="leave-request"]').click({ timeout: 5000 });
  await employeePage.locator('#modalform input[name="date"]').fill(requestedDate);
  await employeePage.locator('#modalform input[name="hours"]').fill('7.5');
  await employeePage.locator('#modalform button[type="submit"]').click({ timeout: 5000 });
  const overlapError = employeePage.locator('#formerror');
  // The empty error box can already be visible while the refusal is still rendering.
  // Wait for matching content as well; keep the final visible-text assertion below.
  await overlapError.filter({ hasText: /overlap|already|request/i }).waitFor({ state: 'visible', timeout: 10000 });
  assert.match(await overlapError.innerText(), /overlap|already|request/i, 'Employee UI did not surface the authoritative overlap refusal.');
  leaveJourney.overlapRefusedInUi = true;
  await employeePage.locator('#modalform [data-act="close"]').click({ timeout: 5000 });

  await employeePage.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await employeePage.waitForFunction(() => document.querySelectorAll('.vector-shell,.vector-sidebar,[class*=vector-]').length > 0, { timeout: 30000 });
  await openLeaveRoute(employeePage, 'employee');
  const pendingRow = employeePage.locator(`[data-vector-leave-id="${created.id}"] [data-vector-leave-status]`);
  await pendingRow.waitFor({ state: 'visible', timeout: 10000 });
  assert.equal((await pendingRow.innerText()).trim().toLowerCase(), 'pending');
  leaveJourney.refreshedUiRetainedPending = true;
  await employeeContext.close();

  const managerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const managerPage = await managerContext.newPage();
  await loginRole(managerPage, 'manager@northstar.example');
  await openLeaveRoute(managerPage, 'manager');
  const managerRow = managerPage.locator(`[data-vector-leave-id="${created.id}"]`);
  await managerRow.waitFor({ state: 'visible', timeout: 10000 });
  await managerRow.locator('button[data-vector-workflow="leave-approve"]').click({ timeout: 5000 });
  await managerPage.locator('#modalform input[name="reviewed"]').check();
  await managerPage.locator('#modalform button[type="submit"]').click({ timeout: 5000 });
  await managerPage.locator('.vw-receipt').waitFor({ state: 'visible', timeout: 10000 });
  leaveJourney.managerUiDecided = true;
  const managerReadBack = await managerPage.evaluate(async id => {
    const response = await fetch('/api/bootstrap');
    const bootstrap = await response.json();
    const request = bootstrap.state.requests.find(item => item.id === id) || null;
    const audit = bootstrap.state.audit.find(item =>
      item.type === 'leave-decision'
      && item.employee === request?.employee
      && item.note === `${id}; approved`
    ) || null;
    return { request, audit };
  }, created.id);
  assert.equal(managerReadBack.request?.status, 'approved', 'Manager UI decision was not read back from stored state.');
  assert.equal(managerReadBack.audit?.note, `${created.id}; approved`, 'Manager UI decision audit was not linked to the exact request.');
  leaveJourney.managerStateReadBack = true;
  leaveJourney.requestAuditLinked = true;
  leaveJourney.decision = 'approved';
  await managerContext.close();

  const freshEmployeeContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const freshEmployeePage = await freshEmployeeContext.newPage();
  await loginRole(freshEmployeePage, 'maya@northstar.example');
  await openLeaveRoute(freshEmployeePage, 'employee');
  const approvedRow = freshEmployeePage.locator(`[data-vector-leave-id="${created.id}"] [data-vector-leave-status]`);
  await approvedRow.waitFor({ state: 'visible', timeout: 10000 });
  assert.equal((await approvedRow.innerText()).trim().toLowerCase(), 'approved');
  const freshEmployeeReadBack = await freshEmployeePage.evaluate(async id => {
    const response = await fetch('/api/personal', { cache: 'no-store' });
    const personal = await response.json();
    return {
      request: personal.requests.find(item => item.id === id) || null,
      leave: personal.leave
    };
  }, created.id);
  assert.equal(freshEmployeeReadBack.request?.status, 'approved', 'Fresh employee API state did not retain the approved request.');
  assert.equal(freshEmployeeReadBack.leave.pendingMinutes, afterRequest.personal.leave.pendingMinutes - 450, 'Approval did not release the request from the pending leave balance.');
  assert.equal(freshEmployeeReadBack.leave.bookedMinutes, afterRequest.personal.leave.bookedMinutes + 450, 'Approval did not transfer the request into the booked leave balance.');
  assert.equal(freshEmployeeReadBack.leave.remainingMinutes, afterRequest.personal.leave.remainingMinutes - 450, 'Approval did not deduct the booking exactly once from remaining leave.');
  assert.equal(freshEmployeeReadBack.leave.availableMinutes, afterRequest.personal.leave.availableMinutes, 'Approval debited available leave a second time or released its reservation.');
  leaveJourney.freshEmployeeLoginSawDecision = true;
  leaveJourney.freshBalanceReconciled = true;
  leaveJourney.balanceTransition = {
    before: {
      bookedMinutes: beforeLeave.personal.leave.bookedMinutes,
      pendingMinutes: beforeLeave.personal.leave.pendingMinutes,
      remainingMinutes: beforeLeave.personal.leave.remainingMinutes,
      availableMinutes: beforeLeave.personal.leave.availableMinutes
    },
    pending: {
      bookedMinutes: afterRequest.personal.leave.bookedMinutes,
      pendingMinutes: afterRequest.personal.leave.pendingMinutes,
      remainingMinutes: afterRequest.personal.leave.remainingMinutes,
      availableMinutes: afterRequest.personal.leave.availableMinutes
    },
    approved: {
      bookedMinutes: freshEmployeeReadBack.leave.bookedMinutes,
      pendingMinutes: freshEmployeeReadBack.leave.pendingMinutes,
      remainingMinutes: freshEmployeeReadBack.leave.remainingMinutes,
      availableMinutes: freshEmployeeReadBack.leave.availableMinutes
    }
  };
  await freshEmployeeContext.close();
  console.log(`CURRENT_LEAVE_BROWSER_JOURNEY=PASS|request=${created.id}|decision=approved|overlapRefused=true|requestAuditLinked=true|balanceReconciled=true|refreshReadback=true|freshLoginReadback=true`);

  const attendanceJourney = {
    managerUiApproved: false,
    exactCorrectionReadBack: false,
    rawPunchesPreserved: false,
    domainAuditReadBack: false,
    refreshedUiRetainedCorrection: false,
    weeklySignStillBlocked: false,
    weeklySignOffCompleted: false,
    payrollReleaseStillBlocked: false,
    issueId: null,
    recordId: null
  };
  const period = '2026-09-07';
  const teamId = 's1';
  const issueId = 'issue-5';
  const recordId = 'wr-e2-2026-09-09';
  const correctionReason = 'Fictional employee correction request: production handover continued until 14:30.';

  const attendancePayrollContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const attendancePayrollPage = await attendancePayrollContext.newPage();
  const payrollPageErrors = [];
  attendancePayrollPage.on('pageerror', error => payrollPageErrors.push(String(error?.stack || error)));
  await loginRole(attendancePayrollPage, 'payroll@northstar.example');
  const beforePayroll = await attendancePayrollPage.evaluate(async period => {
    const response = await fetch('/api/payroll-run?period=' + encodeURIComponent(period));
    return { status: response.status, json: await response.json() };
  }, period);
  assert.equal(beforePayroll.status, 200, 'Payroll baseline could not be read by payroll authority.');
  assert.equal(beforePayroll.json.canRelease, false, 'Synthetic attendance baseline unexpectedly allowed payroll release.');
  const beforePayrollTeam = beforePayroll.json.teams.find(item => item.id === teamId);
  assert.ok(beforePayrollTeam, 'Synthetic payroll baseline is missing team s1.');

  const attendanceManagerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const attendanceManagerPage = await attendanceManagerContext.newPage();
  const attendancePageErrors = [];
  attendanceManagerPage.on('pageerror', error => attendancePageErrors.push(String(error?.stack || error)));
  await loginRole(attendanceManagerPage, 'manager@northstar.example');
  const beforeAttendance = await attendanceManagerPage.evaluate(async period => {
    const response = await fetch('/api/weekly-review?period=' + encodeURIComponent(period));
    return { status: response.status, json: await response.json() };
  }, period);
  assert.equal(beforeAttendance.status, 200, 'Manager could not read the synthetic weekly review.');
  const beforeAttendanceTeam = beforeAttendance.json.teams.find(item => item.id === teamId);
  const beforeAttendanceIssue = beforeAttendanceTeam?.issues.find(item => item.id === issueId);
  const beforeAttendanceRow = beforeAttendanceTeam?.records.find(item => item.id === recordId);
  assert.equal(beforeAttendanceIssue?.status, 'open', 'The explicitly evidenced synthetic attendance issue is not fresh.');
  assert.equal(beforeAttendanceIssue?.row, recordId);
  assert.equal(beforeAttendanceIssue?.employee, 'e2');
  assert.equal(beforeAttendanceIssue?.proposed?.clockOut, '2026-09-09T13:30:00.000Z');
  assert.equal(beforeAttendanceIssue?.evidence, correctionReason);
  assert.equal(beforeAttendanceRow?.raw?.clockOut, '2026-09-09T13:00:00.000Z');
  assert.equal(beforeAttendanceRow?.workedMinutes, 450);

  await openWeeklyRoute(attendanceManagerPage, teamId);
  const issueButton = attendanceManagerPage.locator(`button[data-vector-workflow="issue"][data-id="${issueId}"]`);
  await issueButton.waitFor({ state: 'visible', timeout: 10000 });
  await issueButton.click({ timeout: 5000 });
  await attendanceManagerPage.locator('#modalform select[name="decision"]').selectOption('accept');
  await attendanceManagerPage.locator('#modalform textarea[name="reason"]').fill(correctionReason);
  await attendanceManagerPage.locator('#modalform input[name="checked"]').check();
  const correctionResponsePromise = attendanceManagerPage.waitForResponse(response => {
    if (!response.url().endsWith('/api/command') || response.request().method() !== 'POST') return false;
    try { return response.request().postDataJSON()?.command === 'review-resolve'; } catch { return false; }
  }, { timeout: 10000 });
  await attendanceManagerPage.locator('#modalform button[type="submit"]').click({ timeout: 5000 });
  const correctionResponse = await correctionResponsePromise;
  assert.equal(correctionResponse.status(), 200, 'Manager UI attendance decision was rejected.');
  const correctionResult = await correctionResponse.json();
  assert.equal(correctionResult.ok, true);
  assert.equal(correctionResult.result?.id, issueId);
  assert.equal(correctionResult.result?.status, 'resolved');
  await attendanceManagerPage.waitForFunction(id => {
    const receipt = document.querySelector('.vw-receipt');
    return receipt?.textContent?.includes('review-resolve') && receipt.textContent.includes(id);
  }, issueId, { timeout: 10000 });
  attendanceJourney.managerUiApproved = true;

  const afterAttendance = await attendanceManagerPage.evaluate(async period => {
    const response = await fetch('/api/weekly-review?period=' + encodeURIComponent(period));
    return { status: response.status, json: await response.json() };
  }, period);
  assert.equal(afterAttendance.status, 200);
  const savedAttendanceTeam = afterAttendance.json.teams.find(item => item.id === teamId);
  const savedAttendanceIssue = savedAttendanceTeam?.issues.find(item => item.id === issueId);
  const savedAttendanceRow = savedAttendanceTeam?.records.find(item => item.id === recordId);
  assert.equal(savedAttendanceIssue?.status, 'resolved');
  assert.equal(savedAttendanceIssue?.resolution?.by, 'm1');
  assert.equal(savedAttendanceIssue?.resolution?.decision, 'accept');
  assert.equal(savedAttendanceIssue?.resolution?.reason, correctionReason);
  assert.deepEqual(savedAttendanceRow?.raw, beforeAttendanceRow.raw, 'Attendance correction overwrote original punches.');
  assert.equal(savedAttendanceRow?.effective?.clockOut, '2026-09-09T13:30:00.000Z');
  assert.equal(savedAttendanceRow?.workedMinutes, 480);
  assert.equal(savedAttendanceRow?.reviewedBy, 'm1');
  assert.equal(savedAttendanceTeam?.revision, beforeAttendanceTeam.revision + 1);
  assert.equal(savedAttendanceTeam?.blockers?.length, beforeAttendanceTeam.blockers.length - 1);
  assert.equal(correctionResult.result?.revision, savedAttendanceTeam.revision);
  attendanceJourney.exactCorrectionReadBack = true;
  attendanceJourney.rawPunchesPreserved = true;
  attendanceJourney.issueId = issueId;
  attendanceJourney.recordId = recordId;

  await attendanceManagerPage.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await attendanceManagerPage.waitForFunction(() => document.querySelectorAll('.vector-shell,.vector-sidebar,[class*=vector-]').length > 0, { timeout: 30000 });
  await openWeeklyRoute(attendanceManagerPage, teamId);
  assert.equal(await attendanceManagerPage.locator(`button[data-vector-workflow="issue"][data-id="${issueId}"]`).count(), 0, 'Resolved attendance issue returned after refresh.');
  const adjustmentButton = attendanceManagerPage.locator('button[data-vector-workflow="category"][data-id="adjustments"]');
  await adjustmentButton.waitFor({ state: 'visible', timeout: 10000 });
  await adjustmentButton.click({ timeout: 5000 });
  const adjustmentModalText = await attendanceManagerPage.locator('#modalform').innerText();
  assert.match(adjustmentModalText, /wr-e2-2026-09-09/);
  assert.match(adjustmentModalText, /Correction recorded; original retained/);
  assert.match(adjustmentModalText, /8 h/);
  await attendanceManagerPage.locator('#modalform input[name="checked"]').check();
  const categoryResponsePromise = attendanceManagerPage.waitForResponse(response => {
    if (!response.url().endsWith('/api/command') || response.request().method() !== 'POST') return false;
    try {
      const submitted = response.request().postDataJSON();
      return submitted?.command === 'review-check' && submitted?.payload?.category === 'adjustments' && submitted?.payload?.team === teamId;
    } catch { return false; }
  }, { timeout: 10000 });
  await attendanceManagerPage.locator('#modalform button[type="submit"]').click({ timeout: 5000 });
  const categoryResponse = await categoryResponsePromise;
  assert.equal(categoryResponse.status(), 200, 'Saved Adjustments verification was rejected.');
  await attendanceManagerPage.waitForFunction(team => {
    const receipt = document.querySelector('.vw-receipt');
    return receipt?.textContent?.includes('review-check') && receipt.textContent.includes(team);
  }, teamId, { timeout: 10000 });
  const afterCategory = await attendanceManagerPage.evaluate(async period => {
    const response = await fetch('/api/weekly-review?period=' + encodeURIComponent(period));
    return await response.json();
  }, period);
  const verifiedAttendanceTeam = afterCategory.teams.find(item => item.id === teamId);
  assert.equal(verifiedAttendanceTeam?.categories.find(item => item.id === 'adjustments')?.confirmed, true);
  attendanceJourney.refreshedUiRetainedCorrection = true;
  const signButton = attendanceManagerPage.locator('button[data-vector-workflow="sign"]');
  assert.equal(await signButton.isDisabled(), true, 'Weekly sign-off became available while source blockers remained.');
  attendanceJourney.weeklySignStillBlocked = true;

  const weeklyTeamState = async () => attendanceManagerPage.evaluate(async ({ period, teamId }) => {
    const response = await fetch('/api/weekly-review?period=' + encodeURIComponent(period), { cache: 'no-store' });
    const review = await response.json();
    return review.teams.find(item => item.id === teamId) || null;
  }, { period, teamId });
  const reviewReason = 'Synthetic exact-candidate weekly review evidence for the signed fixture team.';

  let completionTeam = await weeklyTeamState();
  for (const issue of completionTeam.issues.filter(item => item.status === 'open')) {
    const row = completionTeam.records.find(item => item.id === issue.row);
    assert.ok(row, `Source row missing for weekly issue ${issue.id}.`);
    const issueAction = attendanceManagerPage.locator(`button[data-vector-workflow="issue"][data-id="${issue.id}"]`);
    await issueAction.waitFor({ state: 'visible', timeout: 10000 });
    await issueAction.click({ timeout: 5000 });
    if (['missing', 'sync'].includes(issue.type)) {
      await attendanceManagerPage.locator('#modalform select[name="outcome"]').selectOption('worked');
      await attendanceManagerPage.locator('#modalform input[name="clockIn"]').fill(`${row.date}T06:00`);
      await attendanceManagerPage.locator('#modalform input[name="clockOut"]').fill(`${row.date}T14:00`);
      await attendanceManagerPage.locator('#modalform input[name="breakStart"]').fill(`${row.date}T10:00`);
      await attendanceManagerPage.locator('#modalform input[name="breakEnd"]').fill(`${row.date}T10:30`);
      await attendanceManagerPage.locator('#modalform input[name="breaksConfirmed"]').check();
    } else if (issue.type === 'adjustment') {
      await attendanceManagerPage.locator('#modalform select[name="decision"]').selectOption('accept');
    }
    await attendanceManagerPage.locator('#modalform textarea[name="reason"]').fill(issue.evidence || reviewReason);
    await attendanceManagerPage.locator('#modalform input[name="checked"]').check();
    const issueResponsePromise = attendanceManagerPage.waitForResponse(response => {
      if (!response.url().endsWith('/api/command') || response.request().method() !== 'POST') return false;
      try {
        const submitted = response.request().postDataJSON();
        return submitted?.command === 'review-resolve' && submitted?.payload?.issue === issue.id;
      } catch { return false; }
    }, { timeout: 10000 });
    await attendanceManagerPage.locator('#modalform button[type="submit"]').click({ timeout: 5000 });
    const issueResponse = await issueResponsePromise;
    assert.equal(issueResponse.status(), 200, `Weekly issue ${issue.id} was rejected.`);
    const issueResult = await issueResponse.json();
    assert.equal(issueResult.result?.id, issue.id);
    assert.equal(issueResult.result?.status, 'resolved');
    completionTeam = await weeklyTeamState();
    assert.equal(completionTeam.issues.find(item => item.id === issue.id)?.status, 'resolved');
  }

  for (const category of completionTeam.categories.filter(item => !item.confirmed)) {
    const categoryAction = attendanceManagerPage.locator(`button[data-vector-workflow="category"][data-id="${category.id}"]`);
    await categoryAction.waitFor({ state: 'visible', timeout: 10000 });
    await categoryAction.click({ timeout: 5000 });
    await attendanceManagerPage.locator('#modalform input[name="checked"]').check();
    const checkResponsePromise = attendanceManagerPage.waitForResponse(response => {
      if (!response.url().endsWith('/api/command') || response.request().method() !== 'POST') return false;
      try {
        const submitted = response.request().postDataJSON();
        return submitted?.command === 'review-check' && submitted?.payload?.category === category.id;
      } catch { return false; }
    }, { timeout: 10000 });
    await attendanceManagerPage.locator('#modalform button[type="submit"]').click({ timeout: 5000 });
    assert.equal((await checkResponsePromise).status(), 200, `Weekly category ${category.id} was rejected.`);
    completionTeam = await weeklyTeamState();
    assert.equal(completionTeam.categories.find(item => item.id === category.id)?.confirmed, true);
  }

  for (const employee of completionTeam.employees.filter(item => !item.checked)) {
    const employeeAction = attendanceManagerPage.locator(`button[data-vector-workflow="employee"][data-id="${employee.id}"]`);
    await employeeAction.evaluate(button => { const details = button.closest('details'); if (details) details.open = true; });
    await employeeAction.waitFor({ state: 'visible', timeout: 10000 });
    await employeeAction.click({ timeout: 5000 });
    await attendanceManagerPage.locator('#modalform input[name="checked"]').check();
    const checkResponsePromise = attendanceManagerPage.waitForResponse(response => {
      if (!response.url().endsWith('/api/command') || response.request().method() !== 'POST') return false;
      try {
        const submitted = response.request().postDataJSON();
        return submitted?.command === 'review-check' && submitted?.payload?.employee === employee.id;
      } catch { return false; }
    }, { timeout: 10000 });
    await attendanceManagerPage.locator('#modalform button[type="submit"]').click({ timeout: 5000 });
    assert.equal((await checkResponsePromise).status(), 200, `Weekly employee check ${employee.id} was rejected.`);
    completionTeam = await weeklyTeamState();
    assert.equal(completionTeam.employees.find(item => item.id === employee.id)?.checked, true);
  }

  const readySignButton = attendanceManagerPage.locator('button[data-vector-workflow="sign"]');
  await readySignButton.waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await readySignButton.isDisabled(), false, 'Weekly sign-off did not unlock after every required review.');
  await readySignButton.click({ timeout: 5000 });
  await attendanceManagerPage.locator('#modalform input[name="checked"]').check();
  const signResponsePromise = attendanceManagerPage.waitForResponse(response => {
    if (!response.url().endsWith('/api/command') || response.request().method() !== 'POST') return false;
    try {
      const submitted = response.request().postDataJSON();
      return submitted?.command === 'review-sign' && submitted?.payload?.team === teamId;
    } catch { return false; }
  }, { timeout: 10000 });
  await attendanceManagerPage.locator('#modalform button[type="submit"]').click({ timeout: 5000 });
  const signResponse = await signResponsePromise;
  assert.equal(signResponse.status(), 200, 'Weekly sign-off business action was rejected.');
  const signResult = await signResponse.json();
  assert.deepEqual({ id: signResult.result?.id, status: signResult.result?.status }, { id: teamId, status: 'signed' });

  await attendanceManagerPage.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await attendanceManagerPage.waitForFunction(() => document.querySelectorAll('.vector-shell,.vector-sidebar,[class*=vector-]').length > 0, { timeout: 30000 });
  await openWeeklyRoute(attendanceManagerPage, teamId);
  const signedTeam = await weeklyTeamState();
  assert.equal(signedTeam?.status, 'signed', 'Signed weekly state did not survive screen refresh.');
  assert.equal(signedTeam?.signature?.by, 'm1');
  assert.equal(signedTeam?.issues.every(item => item.status === 'resolved'), true);
  assert.equal(signedTeam?.categories.every(item => item.confirmed), true);
  assert.equal(signedTeam?.employees.every(item => item.checked), true);
  assert.match(await attendanceManagerPage.locator('.vw-panel').innerText(), /signed · revision/i, 'Refreshed weekly UI did not show the signed state.');
  attendanceJourney.weeklySignOffCompleted = true;
  assert.deepEqual(attendancePageErrors, [], `Attendance journey uncaught page errors: ${attendancePageErrors.join(' | ')}`);
  await attendanceManagerContext.close();

  const afterPayroll = await attendancePayrollPage.evaluate(async period => {
    const response = await fetch('/api/payroll-run?period=' + encodeURIComponent(period));
    return { status: response.status, json: await response.json() };
  }, period);
  assert.equal(afterPayroll.status, 200);
  const afterPayrollTeam = afterPayroll.json.teams.find(item => item.id === teamId);
  assert.equal(afterPayroll.json.totals.workedMinutes, beforePayroll.json.totals.workedMinutes + 30);
  assert.equal(afterPayrollTeam?.workedMinutes, beforePayrollTeam.workedMinutes + 30);
  assert.equal(afterPayrollTeam?.status, 'signed');
  assert.equal(afterPayroll.json.canRelease, false);
  assert.equal(afterPayroll.json.lines.length, 0);
  assert.equal(afterPayroll.json.reconciliation.ok, false);
  const correctionAudit = afterPayroll.json.audit.find(item => item.type === 'exception-evidence-confirmed' && item.team === teamId && item.record === recordId && item.actor === 'm1');
  const categoryAudit = afterPayroll.json.audit.find(item => item.type === 'category-checked' && item.team === teamId && item.category === 'adjustments' && item.actor === 'm1');
  const signAudit = afterPayroll.json.audit.find(item => item.type === 'team-signed' && item.team === teamId && item.actor === 'm1');
  assert.equal(correctionAudit?.before?.clockOut, '2026-09-09T13:00:00.000Z');
  assert.equal(correctionAudit?.after?.clockOut, '2026-09-09T13:30:00.000Z');
  assert.equal(correctionAudit?.reason, correctionReason);
  assert.ok(categoryAudit, 'Saved Adjustments verification was not present in domain audit state.');
  assert.ok(signAudit, 'Signed weekly state was not present in domain audit state.');
  attendanceJourney.domainAuditReadBack = true;
  await attendancePayrollPage.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await attendancePayrollPage.waitForFunction(() => document.querySelector('button[data-vector-workflow="release"]'), { timeout: 30000 });
  assert.equal(await attendancePayrollPage.locator('button[data-vector-workflow="release"]').isDisabled(), true, 'Payroll release became available while review holds remained.');
  attendanceJourney.payrollReleaseStillBlocked = true;
  assert.deepEqual(payrollPageErrors, [], `Payroll readback uncaught page errors: ${payrollPageErrors.join(' | ')}`);
  await attendancePayrollContext.close();

  browserProofEvidence = { leaveJourney, attendanceJourney };
  console.log(`CURRENT_ATTENDANCE_BROWSER_JOURNEY=PASS|issue=${issueId}|record=${recordId}|workedMinutes=450->480|weeklyInitiallyBlocked=true|weeklySigned=true|payrollBlocked=true|domainAudit=true`);

  assert.ok(navigationClicks >= 3, 'Insufficient role-first navigation clicks.');
  assert.equal(timeReviewActionJourneys + timeReviewEmptyStateJourneys, 1, 'Manager Time Review source state was not proven exactly once.');
  assert.ok(managerAlignmentEvidence?.base64, 'Manager alignment screenshot unavailable.');
  console.log(`CURRENT_MANAGER_SCREENSHOT_META|bytes=${managerAlignmentEvidence.bytes}|sha=${managerAlignmentEvidence.sha256}`);
  console.log(`CURRENT_MANAGER_SCREENSHOT_B64|${managerAlignmentEvidence.base64}`);
  console.log(`CURRENT_CANDIDATE_ROLE_BROWSER_MATRIX=PASS|roles=${receipts.length}|navClicks=${navigationClicks}|sourceActionOpenJourneys=${timeReviewActionJourneys}|leaveBusinessActionJourneys=1|attendanceBusinessActionJourneys=1|emptyStateJourneys=${timeReviewEmptyStateJourneys}|sha=${expectedSha}`);
} finally {
  await browser.close();
  delete process.env.WFM_STAGING_PASSWORD;
}

// CHAT_CAPTURE_REFRESH_20260920_A
