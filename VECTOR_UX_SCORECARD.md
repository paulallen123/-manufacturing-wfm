# Vector UX/CX scorecard

This is the single canonical scorecard for the approved Vector role-first NEW-UI lineage. Historical cycle detail remains in Git history; this file keeps the current evidence boundary, validated deltas and one dependency-ordered next action without repeating old research.

## 2026-09-19 — Vector r8: fail-closed Time Review evidence producer

### Journey reviewed
Factory/operations manager Vector Home → `Items to review` → Time Review, specifically the first source-side producer needed before the shared Vector review adapter may consume `WFM_WORKFLOW_ACTION_EVIDENCE_V1` without presentation-owned inference.

### NEW-UI lineage confirmation
Work remains owned only by the approved Vector Workforce Operations lineage on `feature/one-day-enterprise-implementation-v1` / PR #79. No legacy/0.6.139 presentation, retired overlay, staging, production, customer-proof surface, replacement branch or parallel queue implementation was changed.

### Reuse / duplicate-work decision
- Extended the existing `operations/runtime/workflow-action-evidence-contract.cjs`; no second evidence module, lifecycle helper, queue renderer or branch was created.
- Reused the existing contract validator for final admission instead of duplicating freshness, consequence or confirmation rules inside the Time Review producer.
- Reused the existing Time Review report/team/issue shape already consumed by Vector's neutral `structuredReviewRows()` path, but did not bind the new producer into visible Vector UI before source proof.
- Reused the existing Vector-only workflow, which already runs the shared contract suite when this contract changes.
- Did not build Absence or weekly-signoff producers yet; they remain dependency-ordered behind the first proven source producer.

### Research delta
No competitor/general UX research was repeated. This cycle was an internal source-authority implementation dependency and previous research did not need to be revisited.

### Hypothesis
If Time Review emits the shared contract only for explicitly scoped open source issues with stable IDs, structured reason codes, observation evidence and source authority, while failing neutral when freshness is not supplied, Vector can later consume real action evidence without inventing urgency, authority, freshness or lifecycle transitions.

### Exact implementation / design delta
- Added `produceTimeReviewActionEvidence(report, { allowedTeamIds })` inside the existing shared evidence-contract module.
- The producer fails closed unless an explicit allowed-team scope is supplied; out-of-scope teams are never emitted.
- Only structured `status: open` issues with a stable source ID, structured reason code, observation timestamp and authority requirement are admitted.
- `generatedAt`/`observedAt` may supply observation time but never freshness. If no source freshness contract exists the producer emits `freshness.state = unknown`.
- The only derived lifecycle state is `action_required`, and only from structured `status: open`. `decision_sent`, `confirming_source`, `needs_verification` and `resolved` must be supplied explicitly by source state and still pass the shared validator.
- Verified consequence, explicit source freshness and confirmation evidence pass through the existing validator; invalid or incomplete evidence emits nothing.
- Added four producer-specific regression tests to the existing contract suite; no new test harness was created.
- Visible Vector cards were deliberately not changed in this increment. The existing neutral source-state path remains active until the producer can be safely exposed to the Vector consumer.

### Serious-idea decision
| Idea | Evidence | Decision |
| --- | --- | --- |
| First real producer should reuse the shared evidence contract | Prevents source/presentation semantic drift | **BUILD NOW** |
| Accept report timestamps as proof of freshness | No source freshness SLA | **REJECT** |
| Infer `action_required` from structured open source status | Deterministic source workflow state | **BUILD NOW** |
| Infer later confirmation states or SLA expiry in producer/UI | Would manufacture workflow truth | **REJECT** |
| Bind visible Vector rows immediately | Runtime exposure/source-shape proof still incomplete | **BUILD NEXT** |
| Build Absence/sign-off producers in parallel | Would duplicate an unproven producer pattern | **DEFER** |

### Focused / affected validation
Committed product-code SHA: `33b469d3ef174870bddaf2ac140b2c2fe4e6c0e8` (`ux: add fail-closed Time Review evidence producer`). The committed contract blob is `472ff24ec4129c23d06849ebc69b9985a02becc3`; the committed test blob is `4441a6993a420585dd423709cb117eeddc5e5d35`. Local Git blob hashes matched those committed blobs exactly before validation.

`node --check operations/runtime/workflow-action-evidence-contract.cjs` passed. `node --test operations/runtime/workflow-action-evidence-contract.test.cjs` passed **14/14**, zero skipped: the original ten contract tests plus scoped open-source emission, fail-closed scope/required fields, explicit freshness pass-through, and confirmation lifecycle preservation without wall-clock expiry.

Affected Vector-only run `35447919535` was triggered for the exact product commit but completed with a runner-level failure before checkout/test execution: the job exposes `steps=[]`. This is unavailable hosted evidence, not a product-test failure. The unchanged runner blocker was verified once and was not retried.

### UX scorecard impact
- Calm by default: strengthened — incomplete Time Review evidence emits nothing rather than a guessed state; missing freshness stays neutral.
- Dense on demand: unchanged — no new visible surface was added.
- Explainability: strengthened — source ID, structured reason, authority, freshness and confirmation now pass one common admission path.
- Accessibility: unchanged this run; no new interaction was added.
- Authority/auditability: strengthened — explicit team scope and the shared validator fail closed before Vector can consume evidence.
- Development efficiency: improved — one producer extends the existing contract and test harness; no duplicate per-screen logic was created.

### Still unverified
The producer is committed and deterministically tested, but it is not yet exposed by the exact hosted runtime to Vector and the visible `structuredReviewRows()` consumer remains on the neutral pre-contract path. The real sealed Time Review report may not yet provide stable issue IDs, structured reason codes, explicit authority/freshness/confirmation fields for every record; those records must intentionally emit nothing until the authoritative source supplies them. Exact hosted Vector guard/build execution remains unavailable because the triggered job received no executable steps. Authenticated hosted rendering, real screen-reader behaviour and measured first-click/time-on-task/error rate also remain unverified.

### Single next highest-value NEW-UI action
Expose the existing Time Review producer through one read-only, role/tenant-scoped authoritative runtime bridge and make the existing Vector `structuredReviewRows()` consume only validated `WFM_WORKFLOW_ACTION_EVIDENCE_V1` records. Preserve the current neutral fallback for source records that do not yet satisfy the contract. Do not calculate freshness, urgency, permissions or confirmation state in Vector. Once this end-to-end Time Review path is proven, reuse the same producer pattern for Absence and weekly sign-off.

## Validated prior Vector increments

| Increment | Bounded delta | Exact evidence |
| --- | --- | --- |
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
- No scorecard entry treats a green source/build gate or local deterministic test as real-user, hosted authenticated-role, accessibility-device or production proof.
- Missing or stale evidence remains neutral; no presentation wording may manufacture urgency, cost, qualification, compliance, authority or confirmation.
