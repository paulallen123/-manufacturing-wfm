# Vector UX/CX scorecard

This is the single canonical scorecard for the approved Vector role-first NEW-UI lineage. Historical cycle detail remains in Git history; this file keeps the current evidence boundary, validated deltas and one dependency-ordered next action without repeating old research.

## 2026-09-19 — Vector r9: source-bound Time Review runtime bridge

### Journey reviewed
Factory/operations manager Vector Home → `Items to review` → Time Review, specifically the missing read-only path between the already-tested `WFM_WORKFLOW_ACTION_EVIDENCE_V1` producer and the existing Vector review consumer.

### NEW-UI lineage confirmation
Work remains owned only by the approved Vector Workforce Operations lineage on `feature/one-day-enterprise-implementation-v1` / PR #79. No legacy/0.6.139 presentation, retired overlay, staging, production, customer-proof surface, replacement branch or parallel queue implementation was changed.

### Reuse / duplicate-work decision
- Reused the existing authoritative `/api/time-review` source instead of creating a second Time Review calculation or report.
- Reused `produceTimeReviewActionEvidence()` and the shared validator; the bridge contains no duplicate freshness, consequence or confirmation rules.
- Reused the existing workforce runtime route owner through a thin composition router rather than changing the sealed server or creating another control plane.
- Reused the existing session database and source endpoint's session cookie; client-supplied tenant/role headers are not trusted or forwarded.
- Extended the existing Docker build-admission test stage instead of creating a second CI harness.
- Did not bind Vector yet and did not build Absence/sign-off producers in parallel; those remain dependency-ordered behind exact runtime proof of this first bridge.

### Research delta
No competitor/general UX research was repeated. Fresh read-only Railway HTTP evidence resolved the previously unanswered platform question: the hosted application uses authenticated `GET /api/time-review`; before login `/api/bootstrap` was 401, login succeeded, authenticated bootstrap returned 200 and `/api/time-review` returned 200. That changed the implementation decision from designing a speculative source endpoint to reusing the real sealed Time Review source.

### Hypothesis
If the manager-facing action path reads the already-authoritative Time Review report under the same signed-in session, admits only records that pass the shared evidence producer, and fails closed on source/scope errors, Vector can consume one trustworthy action contract without acquiring calculation, permission, freshness or confirmation authority.

### Exact implementation / design delta
- Added `operations/runtime/workflow-action-evidence-bridge.cjs` as a read-only adapter over the existing `/api/time-review` source.
- The bridge independently resolves the signed-in session to tenant/role, rejects employee-role access, forwards only the existing session cookie plus bounded safe request headers, and never accepts client tenant/role identity headers.
- Source reads are bounded to 3 seconds and 512 KiB and fail closed; non-200/invalid source responses do not create a synthetic action fallback.
- If the source explicitly returns a tenant identifier that disagrees with the authenticated session, the bridge fails closed.
- The only admitted team IDs are those returned by the authenticated Time Review source response; the shared producer then performs the existing stable-ID/reason/observation/authority/freshness/confirmation admission checks.
- The route is `GET /api/workforce/lifecycle/action-evidence/time-review`, deliberately composed through the existing workforce runtime owner. Non-GET access is refused.
- Added `workforce-lifecycle-router.cjs` as a thin composition layer: action-evidence routes go to the shared bridge; every other workforce-lifecycle request delegates unchanged to the existing core implementation.
- Docker build composition now packages the existing lifecycle core, shared contract, bridge and router separately, and runs the existing contract suite, bridge suite and lifecycle suite together in the same deterministic build-admission stage.
- Visible Vector presentation was deliberately left unchanged in this increment. No card, badge, urgency state or confirmation lifecycle is shown from the bridge until exact runtime proof and consumer binding are complete.

### Serious-idea decision
| Idea | Evidence | Decision |
| --- | --- | --- |
| Reuse authenticated `/api/time-review` as the source | Fresh hosted HTTP evidence confirms the real endpoint | **BUILD NOW** |
| Add a second Time Review calculation/API | Would duplicate source truth | **REJECT** |
| Let Vector calculate freshness/SLA/authority | Violates shared evidence boundary | **REJECT** |
| Route through existing workforce runtime owner | Smallest additive change; sealed server remains untouched | **BUILD NOW** |
| Bind visible Vector rows before exact runtime build proof | Would outrun evidence | **BUILD NEXT** |
| Build Absence/sign-off bridges now | First bridge pattern is not yet exact-runtime proven | **DEFER** |

### Focused / affected validation
Current product-code head is `ffb1e35aa3e39606571ba1915e2c90b293c60b57`. Exact committed blobs used in focused validation: contract `472ff24ec4129c23d06849ebc69b9985a02becc3`, bridge `38afc93eec1ba83f88980a2f28a06df86cf10d11`, bridge tests `30a13c061ab2fea5ba57a6d16a5c3d2ee6199ae0`, lifecycle router `646b5730e298ea5e10792a829d863864bdc990ee`, Dockerfile `58d3982985d6761e6e2cfbac66e61c1c2b6005a4`.

Local Git blob hashes for the shared contract, bridge, bridge test and lifecycle router matched the committed blobs exactly. `node --test workflow-action-evidence-bridge.test.cjs` passed **5/5**, zero skipped, covering manager/session context, employee fail-closed behaviour, explicit tenant mismatch, incomplete evidence remaining absent and source/write failure. A focused composition smoke test using the exact committed contract/bridge/router passed **1/1**, proving action-evidence routing is separated from unchanged lifecycle delegation; that smoke used a stub lifecycle core and is not claimed as exact-runtime proof.

Affected Vector-only run `35451354525` was triggered for exact product head `ffb1e35aa3e39606571ba1915e2c90b293c60b57` but again received no runner: job `105918950473` exposes `steps=[]` and `runner_id=0`. No product test executed, so this is unavailable hosted evidence rather than a product-test failure. The unchanged runner blocker was verified once and was not retried.

### UX scorecard impact
- Calm by default: strengthened — bridge/source failures emit no synthetic workload or urgency.
- Dense on demand: unchanged — no new visible surface was added.
- Explainability: strengthened — one source route now feeds one shared evidence admission contract.
- Accessibility: unchanged this run; no new presentation interaction was added.
- Authority/auditability: strengthened — signed-in session scope remains authoritative and Vector still has no write/freshness/permission authority.
- Development efficiency: improved — existing source, contract, workforce route owner and build harness were reused; no second report or queue implementation was created.

### Still unverified
The exact Docker runtime composition has not executed because the affected GitHub job received no runner. The bridge therefore is committed and focused-tested but is not yet claimed as hosted. The sealed Time Review response is known to exist and authenticate successfully, but its live record-level completeness for stable issue IDs, structured reason codes, authority, freshness and later confirmation states remains unverified; incomplete records intentionally emit nothing. Vector `structuredReviewRows()` still uses its current neutral pre-contract path. Authenticated hosted Vector rendering of bridge-backed rows, real screen-reader behaviour and measured first-click/time-on-task/error rate remain unverified.

### Single next highest-value NEW-UI action
Bind only the Time Review portion of the existing Vector `structuredReviewRows()` consumer to `GET /api/workforce/lifecycle/action-evidence/time-review`, accepting only `WFM_WORKFLOW_ACTION_EVIDENCE_V1` items and mapping source confirmation/freshness fields without calculating them. Preserve the current neutral fallback when bridge evidence is absent or incomplete, leave Absence and weekly sign-off on their existing source-bound neutral paths, and run focused consumer tests before any broader browser/accessibility gate.

## Validated prior Vector increments

| Increment | Bounded delta | Exact evidence |
| --- | --- | --- |
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
- No scorecard entry treats a green source/build gate or local deterministic test as real-user, hosted authenticated-role, accessibility-device or production proof.
- Missing or stale evidence remains neutral; no presentation wording may manufacture urgency, cost, qualification, compliance, authority or confirmation.
