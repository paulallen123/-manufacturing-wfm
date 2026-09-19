# Vector UX/CX scorecard

This is the single canonical scorecard for the approved Vector role-first NEW-UI lineage. Historical cycle detail remains in Git history; this file keeps the current evidence boundary, validated deltas and one dependency-ordered next action without repeating old research.

## 2026-09-19 — Vector r11: source-bound Time Review return context

### Journey reviewed
Factory/operations manager Vector Home → contract-backed `Items to review` action → authoritative Time Review → return to the originating Home action surface. The bounded question was whether the manager can preserve enough context to move into the source workflow and come back without creating UI-owned business state or optimistically clearing the action.

### NEW-UI lineage confirmation
All product and test mutation is on `feature/one-day-enterprise-implementation-v1` / PR #79, the canonical Vector role-first NEW-UI owner. No legacy/0.6.139 presentation, retired overlay, customer-proof runtime, staging or production presentation was changed.

### Reuse / duplicate-work decision
- Reused the existing Vector `Items to review` alert row, existing route/navigation primitive and existing `WFM_WORKFLOW_ACTION_EVIDENCE_V1` Time Review consumer.
- Reused and extended the already source-controlled `scripts/current-candidate-role-browser-proof.mjs` instead of creating a new browser harness.
- Reused existing Vector card/header styling for the return-context control; no one-screen CSS fork or replacement component was created.
- Did not copy the same browser proof into the historical inline Railway proof service and did not weaken the security-contained `wfm-test-runner` merely to obtain a green result.
- No competitor/general UX research was repeated because the unresolved dependency was an internal interaction/proof gap, not an unanswered market-pattern question.

### Hypothesis
If a contract-backed Time Review action carries only its stable source identity into the authoritative workflow, presents a clear return path, and restores keyboard focus to `Items to review`, managers should spend less effort re-orienting after investigation while the source workflow remains the sole owner of action state, confirmation and resolution.

### Exact implementation / design delta
- Added one presentation-only same-tab return-context key, `VECTOR_ACTION_RETURN_CONTEXT_V1`. It stores only `workflow`, `route`, stable `sourceId` and bounded display title; it stores no pay, authority, freshness, approval, SLA or resolution state.
- Only admitted contract-backed Time Review rows receive `sourceId` / `workflow` context attributes. Neutral fallback rows, weekly-signoff summaries and leave requests do not inherit false source identity.
- Clicking a contract-backed action records that minimal context and navigates through the existing authoritative Time Review route. No write occurs and no action is cleared on navigation.
- Time Review reuses the existing Vector card/header primitive to show `Back to Items to review` plus the originating title. Invalid, malformed or wrong-route stored context fails closed and is discarded.
- Returning Home clears the stored context and restores keyboard focus to the existing `.vector-alerts` review region; the action list itself remains source-driven.
- The existing source-controlled role-browser proof was extended with a manager journey that requires a real active contract item, verifies the rendered action source ID against authoritative evidence, opens Time Review, verifies the source action still exists after opening, returns Home, verifies focus restoration and verifies the context record was cleared.
- The same proof now asserts that an employee receives `403` from the manager action-evidence endpoint. It will fail rather than manufacture an interaction receipt when no active contract-backed manager item exists.

### Serious-idea decision
| Idea | Evidence | Decision |
| --- | --- | --- |
| Preserve only stable source identity for return context | Existing contract already provides a stable source ID; no business state needs duplication | **BUILD NOW** |
| Store action lifecycle/freshness/authority in browser context | Would duplicate authoritative source state and risk stale decisions | **REJECT** |
| Add a new drawer/queue just to preserve context | Existing route, alert list and card primitive are sufficient | **REJECT** |
| Duplicate the updated proof inside the inline Railway service | Would create two browser-test owners and repeated maintenance | **REJECT** |
| Prove `Decision sent → Confirming source` with an authoritative fixture transition | Required before claiming the full lifecycle interaction | **BUILD NEXT** |

### Focused / affected validation
Product-code commit for the return-context delta is `64c6c36cd0b0a4a58b072f730683916498b9b534`; its exact Vector blob is `ccae9be28e65e43ce22b046c30265ba9cacf8ba7`. The existing source-controlled browser proof was then extended at commit `e4837cd3b4f3e40c14918eeafad129caddd24e29`; its exact script blob is `3f9909bc5a5cfac546b6bb7be4480c7f2f0fc12d`. Both exact blobs passed `node --check` locally.

The affected Vector-only GitHub run `35457073415` for exact product head `64c6c36cd0b0a4a58b072f730683916498b9b534` did not execute repository, build or browser work: its only job contained `steps=[]` and `runner_id=0`. This remains an unavailable hosted runner, not a product-test failure and not a product-test pass; it was checked once and not retried.

The isolated Railway test-project service that follows this canonical branch was still serving candidate `9e703d3ae5dcfd6e0dcb79be294e8e8ba9827f40` when inspected, so the new source-controlled journey could not yet be executed against its exact candidate. No manual customer-proof, staging or production redeploy was used to force proof.

### UX scorecard impact
- Calm by default: preserved — no new urgency/severity and no optimistic action clearing.
- Dense on demand: improved — the manager gets one small contextual return control only after intentionally opening a source-bound action.
- Explainability: improved — the Time Review screen records which source action brought the manager there without copying business-state authority.
- Accessibility: structurally improved — the return control is a semantic button/navigation region and Home return restores programmatic focus to the review region; real screen-reader behaviour remains unverified.
- Authority/auditability: preserved — session context carries navigation identity only; all workflow state continues to come from the authoritative source contract.
- Safety/capability preservation: strengthened — opening an action does not clear it, and malformed context fails closed.
- Development efficiency: improved — one existing alert primitive, one existing route, one existing browser harness; no second queue, service, CSS variant or browser-test owner.

### Still unverified
The updated browser journey has not executed against the exact new candidate because the isolated Railway source service has not yet advanced to this head and the GitHub hosted runner received no runner. Therefore real manager browser rendering, existence of an active fixture contract item, responsive behaviour of the context bar, real screen-reader behaviour, measured first-click/time-on-task/error rate, and the authoritative `Decision sent → Confirming source` transition remain unverified. The current evidence proves source/code composition and executable test design, not that lifecycle transition in a running exact candidate.

### Single next highest-value NEW-UI action
Execute the source-controlled current-candidate browser proof against an isolated exact-head deployment when that canonical branch is available, without touching customer-proof/staging/production. Require the manager action journey to pass exactly as written, then extend the same authoritative fixture path to prove a source-owned `Decision sent → Confirming source` transition without UI timers or optimistic clearing. Do not start the Absence or weekly-signoff contract consumer until this first Time Review lifecycle path has executable proof.

## Validated prior Vector increments

| Increment | Bounded delta | Exact evidence |
| --- | --- | --- |
| r10 | Bound `Items to review` to the read-only Time Review evidence bridge with per-source neutral fallback | Focused consumer harness 9/9; hosted runner unavailable |
| r9 | Added the read-only role/tenant-scoped Time Review action-evidence runtime bridge | Bridge tests 5/5 + router smoke 1/1; hosted runner unavailable |
| r8 | Added the first fail-closed Time Review producer inside the shared action-evidence contract | Contract suite 14/14; hosted runner unavailable |
| r7 | Established one shared source-owned freshness/confirmation evidence contract across Time Review, Absence and weekly sign-off | Focused contract suite 10/10; hosted runner unavailable |
| r6 | Prevented observation timestamps becoming presentation-owned freshness/urgency | Vector-only run `35439251475` green |
| r5 | Source-bound manager review rows and notification count; removed hidden presentation-card counting | Vector-only run `35436525530` green |
| r4 | Source-bound signed-in identity/site context and approved next-seven-day leave only | Vector-only run `35433767094` green |
| r3 | Removed synthetic KPI trends, invented labour-cost target progress and unsupported KPI severity | Vector-only run `35431023141` green |
| r2 | Removed text-inferred department risk, invented shift timeline and percentage-like planning widths | Vector-only run `35428391626` green |
| r1 | Removed position-derived review urgency; established neutral review-state governance | Vector-only run `35426218781` green |

## Standing release / evidence boundary
- Cycle 10 schedule-publication promotion remains separately gated by exact source-bound hosted proof.
- Vector is the only active NEW-UI presentation owner in this lineage; retired overlays and legacy/0.6.139 presentation remain non-owners.
- No scorecard entry treats a source/build guard or deterministic local test as real-user, hosted authenticated-role, accessibility-device or production proof.
- Missing or stale evidence remains neutral; no presentation wording may manufacture urgency, cost, qualification, compliance, authority or confirmation.