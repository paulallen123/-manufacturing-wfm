# Vector UX/CX scorecard

This is the single canonical scorecard for the approved Vector role-first NEW-UI lineage. Historical cycle detail remains in Git history; this file keeps the current evidence boundary, validated deltas and one dependency-ordered next action without repeating old research.

## 2026-09-19 — Vector r7: source-owned action evidence contract

### Journey reviewed
Factory/operations manager Vector Home → `Items to review` → Time Review / Absence & Leave / weekly sign-off source workflows, specifically the missing shared contract needed to represent freshness and the confirmation lifecycle without presentation-owned inference.

### NEW-UI lineage confirmation
Work remains owned only by the approved Vector Workforce Operations lineage on `feature/one-day-enterprise-implementation-v1` / PR #79. PR #90 is explicitly closed/superseded and remains logic/source material only. The open Cycle 11 predecessor is not a forward presentation owner and was not mutated. No legacy/0.6.139 presentation, retired overlay, staging, production, customer-proof surface, replacement branch or parallel queue implementation was changed.

### Reuse / duplicate-work decision
- Reused the already validated Cycle 11 lifecycle vocabulary only: `action_required → decision_sent → confirming_source → needs_verification → resolved`.
- Rejected the retired presentation's old assumption that report-shaped timestamps automatically mean `evidenceState: current`; Vector r6 already proved that no authoritative freshness SLA exists yet.
- Reused the existing `scripts/validate-vector-only-ui.mjs` guard and existing Vector-only workflow; no second validator, PR, branch, queue renderer or browser harness was created.
- Added one shared contract owner for Time Review, Absence and weekly sign-off instead of separate per-screen freshness/confirmation helpers.

### Research delta
No competitor/general UX research was repeated. This cycle answered an internal source-authority dependency. Existing evidence was sufficient: source observation timestamps and terminal workflow states exist, but source-owned freshness policy/expiry and confirmation-SLA semantics were missing from the reusable contract boundary.

### Hypothesis
If all three workflows emit one validated contract containing source identity, `observedAt`, explicit source-owned freshness policy/state/validity, structured reason, authority description and explicit confirmation state/SLA evidence, Vector can later show freshness and `Decision sent → Confirming source → Resolved / Needs verification` without calculating workflow truth in the UI or hiding consequential work.

### Exact implementation / design delta
- Added `operations/runtime/workflow-action-evidence-contract.cjs` as the single shared contract for `time-review`, `absence` and `weekly-signoff`.
- `current` freshness is accepted only when the source supplies a policy reference and explicit `validUntil`; an observation timestamp by itself is insufficient. `unknown` remains valid and neutral.
- The contract never calls `Date.now()` and does not advance lifecycle state from wall-clock time. `needs_verification` requires explicit source-owned SLA-expired state; `resolved` requires source confirmation time plus audit reference.
- Consequence copy is admitted only when the source explicitly marks it verified and provides the supporting evidence reference where available.
- Added one focused deterministic contract suite with ten distinct failure/success modes.
- Extended the existing Vector-only workflow to execute that same contract suite and extended the existing Vector repository guard to reject wall-clock-derived freshness/confirmation semantics. No visual UI, write path, permissions, payroll calculation, approval logic or audit authority changed.

### Serious-idea decision
| Idea | Evidence | Decision |
| --- | --- | --- |
| Reuse Cycle 11 lifecycle names as a cross-domain vocabulary | Previously validated and matches required confirmation semantics | **BUILD NOW** |
| Reuse Cycle 11 `evidenceState: current` inference from report/timestamp presence | No source freshness SLA | **REJECT** |
| One shared source contract across Time Review, Absence and sign-off | Prevents three divergent UI implementations | **BUILD NOW** |
| Let Vector calculate `Needs verification` when `slaExpiresAt < Date.now()` | Would move source workflow truth into presentation | **REJECT** |
| Bind the new contract into visible Vector cards before a source producer emits it | Would create a presentation-only simulation of authority | **BUILD NEXT**, after one real source producer is wired |

### Focused / affected validation
The committed contract blob SHA is `820490a258a4ec1bb1919db46f3b410c8e405cf4` and the committed focused-test blob SHA is `eb0e6321703ce517e1c8ba3743245008872f25cb`. Those exact Git blob hashes were reproduced from the locally executed files before testing. `node --test operations/runtime/workflow-action-evidence-contract.test.cjs` passed **10/10**, zero skipped, covering timestamp-only freshness refusal, explicit current/unknown states, source-owned SLA expiry, confirmation-state consistency, resolution evidence, verified consequences and unsupported-workflow fail-closed behaviour.

The previously current PR head `0d48ae57281fc40aceac48732523e845a24a2b1a` completed Vector-only run `35439333386` successfully before this delta. For the new source-contract/guard delta, GitHub run `35442049102` failed before checkout or any test step: `steps=[]`, `runner_id=0`. That is unavailable hosted evidence, not a product/test failure. The blocker was verified once after the meaningful state change and was not retried again this cycle.

### UX scorecard impact
- Calm by default: strengthened — missing freshness remains neutral and cannot be promoted by time arithmetic in Vector.
- Dense on demand: unchanged — no additional visible surface was added.
- Explainability: strengthened — source freshness policy, confirmation state, authority and verified consequence now have one explicit contract boundary.
- Accessibility: unchanged this run; no new interaction was added.
- Authority/auditability: strengthened — `Needs verification` and `Resolved` require source-owned evidence; presentation cannot manufacture them.
- Development efficiency: improved — one contract/test owner is reusable across three workflows and one existing guard/workflow protects it.

### Still unverified
No current source producer yet emits `WFM_WORKFLOW_ACTION_EVIDENCE_V1`, so visible Vector cards still correctly remain on the r6 neutral source-state path. The new guard's hosted execution is unverified because GitHub allocated no runner. Authenticated hosted rendering, real screen-reader behaviour and measured first-click/time-on-task/error rate also remain unverified.

### Single next highest-value NEW-UI action
Wire **one authoritative source producer first — Time Review** — to emit `WFM_WORKFLOW_ACTION_EVIDENCE_V1` from its existing report/decision state, including source-owned freshness policy/validity and confirmation state. Prove that producer deterministically, then bind the shared Vector review adapter to the validated contract without changing write authority. Only after that proof should Absence and weekly sign-off reuse the same producer contract.

## Validated prior Vector increments

| Increment | Bounded delta | Exact evidence |
| --- | --- | --- |
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
