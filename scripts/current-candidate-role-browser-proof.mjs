import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const origin = new URL(process.env.VECTOR_PROOF_URL).origin;
const expectedSha = process.env.WFM_EXPECTED_CANDIDATE_SHA;
const password = process.env.WFM_STAGING_PASSWORD;
const requireActionAffordanceCoverage = process.env.WFM_REQUIRE_ACTION_AFFORDANCE_COVERAGE === 'true';

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
      const [scriptAsset, styleAsset] = await Promise.all([
        fetch('/vector-ui.js', { cache: 'no-store' }),
        fetch('/vector-ui.css', { cache: 'no-store' })
      ]);
      const [scriptText, styleText] = await Promise.all([scriptAsset.text(), styleAsset.text()]);
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
        approvedScript: scriptText.includes('VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1'),
        approvedStyle: styleText.includes('VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1'),
        retiredMarkers: ['WFM_UX_RESET_CYCLE11_BEGIN', 'WFM_UX_RESET_CYCLE12_BEGIN', 'VECTOR_PRIORITY_BRIDGE_V1']
          .filter(marker => scriptText.includes(marker) || styleText.includes(marker)),
        scriptExecuted: resources.includes('/vector-ui.js'),
        styleExecuted: resources.includes('/vector-ui.css'),
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
    assert.equal(ui.approvedScript, true, `${spec.slug} canonical Vector script marker missing.`);
    assert.equal(ui.approvedStyle, true, `${spec.slug} canonical Vector stylesheet marker missing.`);
    assert.deepEqual(ui.retiredMarkers, [], `${spec.slug} retired presentation marker executed in canonical Vector assets.`);
    assert.equal(ui.scriptExecuted, true, `${spec.slug} canonical /vector-ui.js entrypoint was not loaded.`);
    assert.equal(ui.styleExecuted, true, `${spec.slug} canonical /vector-ui.css entrypoint was not loaded.`);
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
    const navCandidates = page.locator('.vector-nav-item:not([disabled])');
    const navCount = await navCandidates.count();
    for (let i = 0; i < navCount; i += 1) {
      const locator = navCandidates.nth(i);
      if (!(await locator.isVisible().catch(() => false))) continue;
      if ((await locator.getAttribute('aria-current')) === 'page') continue;
      const label = ((await locator.textContent()) || '').replace(/\s+/g, ' ').trim();
      if (!label) continue;
      await locator.click({ timeout: 5000 });
      await page.waitForTimeout(300);
      navigationClicked = label;
      navigationClicks += 1;
      break;
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
      vectorApproved: ui.approvedScript && ui.approvedStyle,
      vectorExecuted: ui.scriptExecuted && ui.styleExecuted,
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

  assert.ok(navigationClicks >= 3, 'Insufficient role-first navigation clicks.');
  assert.equal(timeReviewActionJourneys + timeReviewEmptyStateJourneys, 1, 'Manager Time Review source state was not proven exactly once.');
  assert.ok(managerAlignmentEvidence?.base64, 'Manager alignment screenshot unavailable.');
  console.log(`CURRENT_MANAGER_SCREENSHOT_META|bytes=${managerAlignmentEvidence.bytes}|sha=${managerAlignmentEvidence.sha256}`);
  console.log(`CURRENT_MANAGER_SCREENSHOT_B64|${managerAlignmentEvidence.base64}`);
  console.log(`CURRENT_CANDIDATE_ROLE_BROWSER_MATRIX=PASS|roles=${receipts.length}|navClicks=${navigationClicks}|activeActionJourneys=${timeReviewActionJourneys}|emptyStateJourneys=${timeReviewEmptyStateJourneys}|sha=${expectedSha}`);
} finally {
  await browser.close();
  delete process.env.WFM_STAGING_PASSWORD;
}

// CHAT_CAPTURE_REFRESH_20260920_A
