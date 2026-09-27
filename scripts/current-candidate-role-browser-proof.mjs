import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const origin = new URL(process.env.VECTOR_PROOF_URL).origin;
const expectedSha = process.env.WFM_EXPECTED_CANDIDATE_SHA;
const timeReviewPeriod = '2026-09-07';
const password = process.env.WFM_STAGING_PASSWORD;
const requireActionAffordanceCoverage = process.env.WFM_REQUIRE_ACTION_AFFORDANCE_COVERAGE === 'true';
export let browserProofEvidence = { leaveJourney: null, attendanceJourney: null, payrollJourney: null };

assert.match(expectedSha || '', /^[0-9a-f]{40}$/);
assert.ok(password && password.length >= 20, 'Staging password unavailable.');

// Assert the approved Vector role-first primary navigation, not retired legacy labels.
// Workflow-specific proof still opens the underlying attendance/payroll/onboarding surfaces below.
const specs = [
  { slug: 'manager', email: 'manager@northstar.example', role: 'manager', tenant: 'northstar-demo', payroll: 403, surface: '/api/time-review', preferredNav: 'People' },
  { slug: 'employee', email: 'maya@northstar.example', role: 'employee', tenant: 'northstar-demo', payroll: 403, surface: '/api/personal', preferredNav: null },
  { slug: 'payroll', email: 'payroll@northstar.example', role: 'payroll_admin', tenant: 'northstar-demo', payroll: 200, surface: '/api/payroll-run', preferredNav: null },
  { slug: 'company-admin', email: 'superuser@northstar.example', role: 'director', tenant: 'northstar-demo', payroll: 200, surface: '/api/onboarding', preferredNav: null },
  { slug: 'isolation-manager', email: 'other@isolation.example', role: 'manager', tenant: 'isolation-test', payroll: 403, surface: '/api/bootstrap', preferredNav: 'People' }
];

const healthResponse = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(15000) });
assert.equal(healthResponse.status, 200);
const health = await healthResponse.json();
assert.equal(health.fixtureOnly, true);
assert.equal(health.productionApproved, false);
assert.equal(healthResponse.headers.get('x-wfm-source-sha'), expectedSha, 'Health response source SHA is not the exact candidate.');
assert.equal(healthResponse.headers.get('x-wfm-source-binding'), 'build-file-matched', 'Health response is not build-file matched.');

const identityResponse = await fetch(`${origin}/api/runtime-identity`, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
assert.equal(identityResponse.status, 200, 'Runtime identity endpoint unavailable.');
const runtimeIdentity = await identityResponse.json();
assert.equal(runtimeIdentity.candidateSha, expectedSha, 'Running source identity does not match the expected candidate SHA.');
assert.equal(runtimeIdentity.sourceBinding, 'build-file-matched', 'Running source identity is not build-file matched.');
assert.equal(runtimeIdentity.fixtureOnly, true);
assert.equal(runtimeIdentity.productionApproved, false);
assert.equal(identityResponse.headers.get('x-wfm-source-sha'), expectedSha, 'Identity response source SHA header mismatch.');

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
  // Enter through the approved People section rather than a Home action-queue
  // leave button, which intentionally opens the review drawer instead of routing.
  const primary = page.locator('.vector-sidebar [data-vector-nav]').filter({ hasText: /^People$/ }).first();
  await primary.waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await primary.isEnabled(), true, `${expectedRole} People section is unavailable.`);
  await primary.click({ timeout: 5000 });
  const route = page.locator('.vector-section-tabs [data-vector-route="leave"]:visible').first();
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
      actionJourney.evidenceStatus = await page.evaluate(async period => (await fetch('/api/workforce/lifecycle/action-evidence/time-review?period=' + encodeURIComponent(period), { cache: 'no-store' })).status, timeReviewPeriod);
      assert.equal(actionJourney.evidenceStatus, 403, 'Employee unexpectedly received manager action evidence.');
    }

    if (spec.slug === 'manager') {
      const weeklyShape = await page.evaluate(async period => {
        const response = await fetch('/api/weekly-review?period=' + encodeURIComponent(period), { cache: 'no-store' });
        const json = await response.json();
        return {
          status: response.status,
          generatedAt: json?.generatedAt || json?.observedAt || null,
          authorityRequired: json?.authorityRequired || null,
          open: (Array.isArray(json?.teams) ? json.teams : []).flatMap(team =>
            (Array.isArray(team?.issues) ? team.issues : [])
              .filter(issue => String(issue?.status || '').toLowerCase() === 'open')
              .map(issue => ({
                id: String(issue?.sourceId || issue?.id || '').slice(0, 120),
                type: String(issue?.type || '').slice(0, 80),
                row: String(issue?.row || '').slice(0, 120),
                reasonCode: String(issue?.reasonCode || '').slice(0, 80),
                sourceFingerprint: Boolean(String(issue?.sourceFingerprint || '').trim()),
                proposed: Boolean(issue?.proposed && typeof issue.proposed === 'object'),
                confirmationState: String(issue?.confirmation?.state || '').slice(0, 80)
              }))
          )
        };
      }, timeReviewPeriod);
      console.log('CURRENT_TIME_REVIEW_WEEKLY_SOURCE=' + JSON.stringify(weeklyShape));
      const evidence = await page.evaluate(async period => {
        const response = await fetch('/api/workforce/lifecycle/action-evidence/time-review?period=' + encodeURIComponent(period), { cache: 'no-store' });
        let json = null;
        try { json = await response.json(); } catch {}
        return { status: response.status, json };
      }, timeReviewPeriod);
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
      // The approved Today priority card intentionally shows five actionable rows; the general queue surface uses four.
      const expectedVisibleNeedsIds = expectedNeedsIds.slice(0, 5);
      const expectedVisibleAwaitingIds = expectedAwaitingIds.slice(0, 3);
      const affordanceCoverage = expectedNeedsIds.length > 0 && expectedAwaitingIds.length > 0 ? 'EXERCISED' : 'UNEXERCISED';
      console.log('CURRENT_TIME_REVIEW_SOURCE_STATE=' + JSON.stringify({
        active: active.map(item => ({
          sourceId: String(item?.sourceId || '').slice(0, 120),
          confirmationState: String(item?.confirmation?.state || '').slice(0, 80)
        })),
        needsCount: expectedNeedsIds.length,
        awaitingCount: expectedAwaitingIds.length
      }));

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

        const postOpen = await page.evaluate(async ({ period }) => {
          const response = await fetch('/api/workforce/lifecycle/action-evidence/time-review?period=' + encodeURIComponent(period), { cache: 'no-store' });
          return { status: response.status, json: await response.json() };
        }, { period: timeReviewPeriod });
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
    if (!spec.slug.includes('employee')) {
      const canonicalLabels = ['Today', 'People', 'Plan', 'Factory', 'Improve'];
      const controls = page.locator('.vector-sidebar [data-vector-nav]');
      assert.equal(await controls.count(), canonicalLabels.length, `${spec.slug} primary navigation section count drifted.`);
      const navState = [];
      for (let index = 0; index < canonicalLabels.length; index += 1) {
        const control = controls.nth(index);
        const label = String(await control.textContent() || '').replace(/\\s+/g, ' ').trim();
        navState.push({
          label,
          visible: await control.isVisible(),
          enabled: await control.isEnabled()
        });
      }
      assert.deepEqual(navState.map(item => item.label), canonicalLabels, `${spec.slug} primary navigation labels drifted from the approved five-section shell.`);
      assert.equal(navState.every(item => item.visible), true, `${spec.slug} primary navigation must remain visible even when permissions disable a section.`);

      let chosenIndex = spec.preferredNav ? navState.findIndex(item => item.label === spec.preferredNav && item.enabled) : -1;
      if (chosenIndex < 0) chosenIndex = navState.findIndex(item => item.label !== 'Today' && item.enabled);
      if (chosenIndex < 0) chosenIndex = navState.findIndex(item => item.enabled);
      assert.ok(chosenIndex >= 0, `${spec.slug} has no enabled approved primary navigation section.`);
      const chosen = controls.nth(chosenIndex);
      await chosen.click({ timeout: 5000 });
      await page.waitForTimeout(300);
      navigationClicked = navState[chosenIndex].label;
      navigationClicks += 1;
      console.log(`CURRENT_ROLE_NAVIGATION=PASS|role=${spec.role}|clicked=${navigationClicked}|enabled=${navState.filter(item => item.enabled).map(item => item.label).join(',')}`);
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
  await employeePage.locator('#modalform button.close[data-act="close"][aria-label="Close dialog"]').click({ timeout: 5000 });

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
  console.log('CURRENT_LEAVE_AUDIT_DIAG=' + JSON.stringify({ requestId: created.id, request: managerReadBack.request, audit: managerReadBack.audit }));
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
    weeklySignOffEvidence: null,
    payrollReleaseStillBlocked: false,
    issueId: null,
    recordId: null
  };
  const period = timeReviewPeriod;
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
  const payrollJourney = {
    expectedTeamIds: beforeAttendance.json.teams.map(item => item.id),
    teamSignOffs: [],
    release: null
  };
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

  const weeklyTeamState = async targetTeamId => attendanceManagerPage.evaluate(async ({ period, teamId }) => {
    const response = await fetch('/api/weekly-review?period=' + encodeURIComponent(period), { cache: 'no-store' });
    const review = await response.json();
    return review.teams.find(item => item.id === teamId) || null;
  }, { period, teamId: targetTeamId });
  const reviewReason = 'Synthetic exact-candidate weekly review evidence for the signed fixture team.';

  let completionTeam = await weeklyTeamState(teamId);
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
    completionTeam = await weeklyTeamState(teamId);
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
    completionTeam = await weeklyTeamState(teamId);
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
    completionTeam = await weeklyTeamState(teamId);
    assert.equal(completionTeam.employees.find(item => item.id === employee.id)?.checked, true);
  }

  const readySignButton = attendanceManagerPage.locator('button[data-vector-workflow="sign"]');
  await readySignButton.waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await readySignButton.isDisabled(), false, 'Weekly sign-off did not unlock after every required review.');
  const submittedSignRevision = completionTeam.revision;
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
  const submittedSign = signResponse.request().postDataJSON();
  assert.equal(submittedSign?.payload?.revision, submittedSignRevision, 'Weekly sign-off did not submit the exact reviewed revision.');
  const signResult = await signResponse.json();
  assert.deepEqual({ id: signResult.result?.id, status: signResult.result?.status }, { id: teamId, status: 'signed' });

  await attendanceManagerPage.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await attendanceManagerPage.waitForFunction(() => document.querySelectorAll('.vector-shell,.vector-sidebar,[class*=vector-]').length > 0, { timeout: 30000 });
  await openWeeklyRoute(attendanceManagerPage, teamId);
  const signedTeam = await weeklyTeamState(teamId);
  assert.equal(signedTeam?.status, 'signed', 'Signed weekly state did not survive screen refresh.');
  assert.equal(signedTeam?.signature?.by, 'm1');
  assert.equal(signedTeam?.signature?.revision, submittedSignRevision, 'Persisted signature is not bound to the submitted review revision.');
  assert.equal(signedTeam?.issues.every(item => item.status === 'resolved'), true);
  assert.equal(signedTeam?.categories.every(item => item.confirmed), true);
  assert.equal(signedTeam?.employees.every(item => item.checked), true);
  assert.match(await attendanceManagerPage.locator('.vw-panel').innerText(), /signed · revision/i, 'Refreshed weekly UI did not show the signed state.');
  attendanceJourney.weeklySignOffCompleted = true;
  payrollJourney.teamSignOffs.push({
    teamId,
    submittedRevision: submittedSignRevision,
    signatureRevision: signedTeam.signature.revision,
    auditRevision: null,
    refreshedStatus: signedTeam.status
  });

  const partialPayroll = await attendancePayrollPage.evaluate(async period => {
    const response = await fetch('/api/payroll-run?period=' + encodeURIComponent(period));
    return { status: response.status, json: await response.json() };
  }, period);
  assert.equal(partialPayroll.status, 200);
  const afterPayrollTeam = partialPayroll.json.teams.find(item => item.id === teamId);
  assert.equal(partialPayroll.json.totals.workedMinutes, beforePayroll.json.totals.workedMinutes + 30);
  assert.equal(afterPayrollTeam?.workedMinutes, beforePayrollTeam.workedMinutes + 30);
  assert.equal(afterPayrollTeam?.status, 'signed');
  assert.equal(partialPayroll.json.canRelease, false);
  assert.equal(partialPayroll.json.lines.length, 0);
  assert.equal(partialPayroll.json.reconciliation.ok, false);
  const correctionAudit = partialPayroll.json.audit.find(item => item.type === 'exception-evidence-confirmed' && item.team === teamId && item.record === recordId && item.actor === 'm1');
  const categoryAudit = partialPayroll.json.audit.find(item => item.type === 'category-checked' && item.team === teamId && item.category === 'adjustments' && item.actor === 'm1');
  const signAudit = partialPayroll.json.audit.find(item => item.type === 'team-signed' && item.team === teamId && item.actor === 'm1');
  assert.equal(correctionAudit?.before?.clockOut, '2026-09-09T13:00:00.000Z');
  assert.equal(correctionAudit?.after?.clockOut, '2026-09-09T13:30:00.000Z');
  assert.equal(correctionAudit?.reason, correctionReason);
  assert.ok(categoryAudit, 'Saved Adjustments verification was not present in domain audit state.');
  assert.ok(signAudit, 'Signed weekly state was not present in domain audit state.');
  assert.equal(signAudit.revision, submittedSignRevision, 'Sign-off audit is not bound to the submitted review revision.');
  attendanceJourney.weeklySignOffEvidence = {
    submittedRevision: submittedSignRevision,
    signatureRevision: signedTeam.signature.revision,
    auditRevision: signAudit.revision,
    refreshedStatus: signedTeam.status
  };
  payrollJourney.teamSignOffs[0].auditRevision = signAudit.revision;
  attendanceJourney.domainAuditReadBack = true;
  await attendancePayrollPage.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await attendancePayrollPage.waitForFunction(() => document.querySelector('button[data-vector-workflow="release"]'), { timeout: 30000 });
  assert.equal(await attendancePayrollPage.locator('button[data-vector-workflow="release"]').isDisabled(), true, 'Payroll release became available while review holds remained.');
  attendanceJourney.payrollReleaseStillBlocked = true;

  async function completeWeeklyTeam(targetTeamId) {
    await attendanceManagerPage.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await attendanceManagerPage.waitForFunction(() => document.querySelectorAll('.vector-shell,.vector-sidebar,[class*=vector-]').length > 0, { timeout: 30000 });
    await openWeeklyRoute(attendanceManagerPage, targetTeamId);
    let team = await weeklyTeamState(targetTeamId);
    assert.ok(team, `Weekly team ${targetTeamId} is unavailable to the manager.`);

    for (const issue of team.issues.filter(item => item.status === 'open')) {
      const row = team.records.find(item => item.id === issue.row);
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
      } else if (issue.type === 'overtime') {
        await attendanceManagerPage.locator('#modalform select[name="decision"]').selectOption('approve');
      }
      await attendanceManagerPage.locator('#modalform textarea[name="reason"]').fill(issue.evidence || reviewReason);
      await attendanceManagerPage.locator('#modalform input[name="checked"]').check();
      const responsePromise = attendanceManagerPage.waitForResponse(response => {
        if (!response.url().endsWith('/api/command') || response.request().method() !== 'POST') return false;
        try {
          const submitted = response.request().postDataJSON();
          return submitted?.command === 'review-resolve' && submitted?.payload?.issue === issue.id;
        } catch { return false; }
      }, { timeout: 10000 });
      await attendanceManagerPage.locator('#modalform button[type="submit"]').click({ timeout: 5000 });
      assert.equal((await responsePromise).status(), 200, `Weekly issue ${issue.id} was rejected.`);
      team = await weeklyTeamState(targetTeamId);
      assert.equal(team.issues.find(item => item.id === issue.id)?.status, 'resolved');
    }

    for (const category of team.categories.filter(item => !item.confirmed)) {
      const action = attendanceManagerPage.locator(`button[data-vector-workflow="category"][data-id="${category.id}"]`);
      await action.waitFor({ state: 'visible', timeout: 10000 });
      await action.click({ timeout: 5000 });
      await attendanceManagerPage.locator('#modalform input[name="checked"]').check();
      const responsePromise = attendanceManagerPage.waitForResponse(response => {
        if (!response.url().endsWith('/api/command') || response.request().method() !== 'POST') return false;
        try {
          const submitted = response.request().postDataJSON();
          return submitted?.command === 'review-check' && submitted?.payload?.team === targetTeamId && submitted?.payload?.category === category.id;
        } catch { return false; }
      }, { timeout: 10000 });
      await attendanceManagerPage.locator('#modalform button[type="submit"]').click({ timeout: 5000 });
      assert.equal((await responsePromise).status(), 200, `Weekly category ${category.id} was rejected.`);
      team = await weeklyTeamState(targetTeamId);
    }

    for (const employee of team.employees.filter(item => !item.checked)) {
      const action = attendanceManagerPage.locator(`button[data-vector-workflow="employee"][data-id="${employee.id}"]`);
      await action.evaluate(button => { const details = button.closest('details'); if (details) details.open = true; });
      await action.waitFor({ state: 'visible', timeout: 10000 });
      await action.click({ timeout: 5000 });
      await attendanceManagerPage.locator('#modalform input[name="checked"]').check();
      const responsePromise = attendanceManagerPage.waitForResponse(response => {
        if (!response.url().endsWith('/api/command') || response.request().method() !== 'POST') return false;
        try {
          const submitted = response.request().postDataJSON();
          return submitted?.command === 'review-check' && submitted?.payload?.team === targetTeamId && submitted?.payload?.employee === employee.id;
        } catch { return false; }
      }, { timeout: 10000 });
      await attendanceManagerPage.locator('#modalform button[type="submit"]').click({ timeout: 5000 });
      assert.equal((await responsePromise).status(), 200, `Weekly employee check ${employee.id} was rejected.`);
      team = await weeklyTeamState(targetTeamId);
    }

    assert.equal(team.issues.every(item => item.status === 'resolved'), true);
    assert.equal(team.categories.every(item => item.confirmed), true);
    assert.equal(team.employees.every(item => item.checked), true);
    const revision = team.revision;
    const sign = attendanceManagerPage.locator('button[data-vector-workflow="sign"]');
    assert.equal(await sign.isDisabled(), false, `Weekly sign-off for ${targetTeamId} did not unlock.`);
    await sign.click({ timeout: 5000 });
    await attendanceManagerPage.locator('#modalform input[name="checked"]').check();
    const signPromise = attendanceManagerPage.waitForResponse(response => {
      if (!response.url().endsWith('/api/command') || response.request().method() !== 'POST') return false;
      try {
        const submitted = response.request().postDataJSON();
        return submitted?.command === 'review-sign' && submitted?.payload?.team === targetTeamId;
      } catch { return false; }
    }, { timeout: 10000 });
    await attendanceManagerPage.locator('#modalform button[type="submit"]').click({ timeout: 5000 });
    const response = await signPromise;
    assert.equal(response.status(), 200, `Weekly sign-off for ${targetTeamId} was rejected.`);
    assert.equal(response.request().postDataJSON()?.payload?.revision, revision);

    await attendanceManagerPage.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await attendanceManagerPage.waitForFunction(() => document.querySelectorAll('.vector-shell,.vector-sidebar,[class*=vector-]').length > 0, { timeout: 30000 });
    await openWeeklyRoute(attendanceManagerPage, targetTeamId);
    const persisted = await weeklyTeamState(targetTeamId);
    assert.equal(persisted?.status, 'signed');
    assert.equal(persisted?.signature?.revision, revision);
    assert.match(await attendanceManagerPage.locator('.vw-panel').innerText(), /signed · revision/i);
    return {
      teamId: targetTeamId,
      submittedRevision: revision,
      signatureRevision: persisted.signature.revision,
      auditRevision: null,
      refreshedStatus: persisted.status
    };
  }

  for (const targetTeamId of payrollJourney.expectedTeamIds.filter(id => id !== teamId)) {
    payrollJourney.teamSignOffs.push(await completeWeeklyTeam(targetTeamId));
  }
  assert.equal(payrollJourney.teamSignOffs.length, payrollJourney.expectedTeamIds.length);
  assert.deepEqual(attendancePageErrors, [], `Attendance journey uncaught page errors: ${attendancePageErrors.join(' | ')}`);
  await attendanceManagerContext.close();

  const readyPayroll = await attendancePayrollPage.evaluate(async period => {
    const response = await fetch('/api/payroll-run?period=' + encodeURIComponent(period), { cache: 'no-store' });
    return { status: response.status, json: await response.json() };
  }, period);
  assert.equal(readyPayroll.status, 200);
  assert.equal(readyPayroll.json.teams.every(item => item.status === 'signed'), true);
  assert.equal(readyPayroll.json.canRelease, true, JSON.stringify(readyPayroll.json.blockers));
  assert.equal(readyPayroll.json.reconciliation.ok, true);
  assert.ok(readyPayroll.json.lines.length > 0, 'Reconciled payroll has no export rows.');
  for (const evidence of payrollJourney.teamSignOffs) {
    const audit = readyPayroll.json.audit.find(item => item.type === 'team-signed' && item.team === evidence.teamId && item.actor === 'm1');
    assert.ok(audit, `Signed team ${evidence.teamId} is missing its domain audit.`);
    assert.equal(audit.revision, evidence.submittedRevision);
    evidence.auditRevision = audit.revision;
  }

  await attendancePayrollPage.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await attendancePayrollPage.waitForFunction(() => document.querySelector('button[data-vector-workflow="release"]'), { timeout: 30000 });
  const releaseButton = attendancePayrollPage.locator('button[data-vector-workflow="release"]');
  assert.equal(await releaseButton.isDisabled(), false, 'Payroll release did not unlock after every team signed.');
  await releaseButton.click({ timeout: 5000 });
  await attendancePayrollPage.locator('#modalform input[name="checked"]').check();
  await attendancePayrollPage.locator('#modalform input[name="schemaReviewed"]').check();
  const mappingReview = attendancePayrollPage.locator('#modalform input[name="timeReviewMappingReviewed"]');
  if (await mappingReview.count()) await mappingReview.check();
  const releaseResponsePromise = attendancePayrollPage.waitForResponse(response => {
    if (!response.url().endsWith('/api/command') || response.request().method() !== 'POST') return false;
    try { return response.request().postDataJSON()?.command === 'payroll-release'; } catch { return false; }
  }, { timeout: 10000 });
  await attendancePayrollPage.locator('#modalform button[type="submit"]').click({ timeout: 5000 });
  const releaseResponse = await releaseResponsePromise;
  assert.equal(releaseResponse.status(), 200, 'Payroll release business action was rejected.');
  const releaseResult = await releaseResponse.json();
  const batchId = releaseResult.result?.id;
  assert.equal(releaseResult.result?.status, 'released');
  assert.ok(batchId, 'Payroll release did not return a batch identity.');

  const releasedReadBack = await attendancePayrollPage.evaluate(async ({ period, batchId }) => {
    const [runResponse, exportResponse] = await Promise.all([
      fetch('/api/payroll-run?period=' + encodeURIComponent(period), { cache: 'no-store' }),
      fetch('/api/payroll-export/' + encodeURIComponent(batchId), { cache: 'no-store' })
    ]);
    return {
      runStatus: runResponse.status,
      run: await runResponse.json(),
      exportStatus: exportResponse.status,
      checksum: exportResponse.headers.get('x-export-sha256'),
      csv: await exportResponse.text()
    };
  }, { period, batchId });
  assert.equal(releasedReadBack.runStatus, 200);
  assert.equal(releasedReadBack.exportStatus, 200);
  const persistedBatch = releasedReadBack.run.batches.find(item => item.id === batchId);
  const releaseAudit = releasedReadBack.run.audit.find(item => item.type === 'payroll-batch-released' && item.batch === batchId);
  assert.equal(persistedBatch?.status, 'released');
  assert.ok(releaseAudit, 'Payroll release audit is missing the returned batch identity.');
  const computedChecksum = crypto.createHash('sha256').update(releasedReadBack.csv).digest('hex');
  assert.equal(releasedReadBack.checksum, computedChecksum);
  const rowCount = releasedReadBack.csv.trim().split(/\r?\n/).length - 1;
  assert.equal(rowCount, persistedBatch.rowCount);

  await attendancePayrollPage.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await attendancePayrollPage.waitForFunction(id => document.body?.innerText?.includes(id), batchId, { timeout: 30000 });
  const freshPayrollContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const freshPayrollPage = await freshPayrollContext.newPage();
  await loginRole(freshPayrollPage, 'payroll@northstar.example');
  const freshPayroll = await freshPayrollPage.evaluate(async period => {
    const response = await fetch('/api/payroll-run?period=' + encodeURIComponent(period), { cache: 'no-store' });
    return await response.json();
  }, period);
  const freshBatch = freshPayroll.batches.find(item => item.id === batchId);
  assert.equal(freshBatch?.checksum, computedChecksum);
  await freshPayrollContext.close();

  payrollJourney.release = {
    responseStatus: releaseResponse.status(),
    batchId,
    persistedBatchId: persistedBatch.id,
    auditBatchId: releaseAudit.batch,
    freshLoginBatchId: freshBatch.id,
    status: persistedBatch.status,
    rowCount,
    checksumHeader: releasedReadBack.checksum,
    computedChecksum,
    reconciliationOk: readyPayroll.json.reconciliation.ok
  };
  assert.deepEqual(payrollPageErrors, [], `Payroll readback uncaught page errors: ${payrollPageErrors.join(' | ')}`);
  await attendancePayrollContext.close();

  browserProofEvidence = { leaveJourney, attendanceJourney, payrollJourney };
  console.log(`CURRENT_ATTENDANCE_BROWSER_JOURNEY=PASS|issue=${issueId}|record=${recordId}|workedMinutes=450->480|weeklyInitiallyBlocked=true|weeklySigned=true|payrollBlocked=true|domainAudit=true`);
  console.log(`CURRENT_PAYROLL_BROWSER_JOURNEY=PASS|teams=${payrollJourney.teamSignOffs.length}|batch=${batchId}|rows=${rowCount}|checksum=${computedChecksum}|refreshReadback=true|freshLoginReadback=true`);

  assert.ok(navigationClicks >= 3, 'Insufficient role-first navigation clicks.');
  assert.equal(timeReviewActionJourneys + timeReviewEmptyStateJourneys, 1, 'Manager Time Review source state was not proven exactly once.');
  assert.ok(managerAlignmentEvidence?.base64, 'Manager alignment screenshot unavailable.');
  const finalIdentityResponse = await fetch(`${origin}/api/runtime-identity`, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
  assert.equal(finalIdentityResponse.status, 200, 'Final runtime identity endpoint unavailable.');
  assert.equal(finalIdentityResponse.headers.get('x-wfm-source-sha'), expectedSha, 'Final runtime identity source SHA header mismatch.');
  assert.equal(finalIdentityResponse.headers.get('x-wfm-source-binding'), 'build-file-matched', 'Final runtime identity lost build-file binding.');
  const finalRuntimeIdentity = await finalIdentityResponse.json();
  assert.equal(finalRuntimeIdentity.candidateSha, expectedSha, 'Serving candidate changed during the browser journey.');
  assert.equal(finalRuntimeIdentity.sourceBinding, 'build-file-matched', 'Final serving candidate is not build-file matched.');
  console.log(`CURRENT_MANAGER_SCREENSHOT_META|bytes=${managerAlignmentEvidence.bytes}|sha=${managerAlignmentEvidence.sha256}`);
  console.log(`CURRENT_MANAGER_SCREENSHOT_B64|${managerAlignmentEvidence.base64}`);
  console.log(`CURRENT_CANDIDATE_ROLE_BROWSER_MATRIX=PASS|roles=${receipts.length}|navClicks=${navigationClicks}|sourceActionOpenJourneys=${timeReviewActionJourneys}|leaveBusinessActionJourneys=1|attendanceBusinessActionJourneys=1|emptyStateJourneys=${timeReviewEmptyStateJourneys}|sha=${expectedSha}|sourceBinding=build-file-matched`);
} finally {
  await browser.close();
  delete process.env.WFM_STAGING_PASSWORD;
}

// CHAT_CAPTURE_REFRESH_20260920_A
