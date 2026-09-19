# Vector UX/CX scorecard

This is the single canonical scorecard for the approved Vector role-first NEW-UI lineage. Historical cycle detail remains in Git history; this file keeps the current evidence boundary, validated deltas and one dependency-ordered next action without repeating old research.

## 2026-09-19 — Vector r6: fail-closed freshness contract

### Journey reviewed
Factory/operations manager Vector Home → notification badge / `Items to review` → Time Review or Absence & Leave source workflow, specifically whether source observation timestamps can safely drive “current”, “fresh” or urgency state.

### NEW-UI lineage confirmation
Work remains owned only by the approved Vector Workforce Operations presentation on `feature/one-day-enterprise-implementation-v1` / PR #79. The retired Cycle 11 implementation was inspected only as prior source-contract/proof evidence. No legacy/0.6.139 presentation, retired overlay, staging/prod surface, replacement branch, duplicate queue or duplicate browser harness was changed or loaded.

### Reuse / duplicate-work decision
- Reused the existing `structuredReviewRows()` source adapter and the existing `scripts/validate-vector-only-ui.mjs` Vector guard; no new component, service, PR, branch or test workflow was created.
- Reused prior source-bound contract evidence only to answer the unresolved dependency question. That evidence shows report-shaped Time Review data can carry an observation timestamp (`generatedAt`, with team-level `updatedAt` where supplied) and that terminal source state can confirm outcomes; it does **not** define a freshness SLA.
- Preserved the current Vector behaviour: source-confirmed open/pending work remains visible and neutral `Needs review`; no item is hidden merely because freshness is unknown.

### Research delta
No competitor/general UX research was repeated. The unresolved issue was internal and contractual. Inspection found no trustworthy authoritative freshness/SLA rule that would let Vector convert an observation timestamp into `current`, `fresh`, urgent or overdue state. A timestamp proves when evidence was observed; it does not by itself prove how long that evidence remains decision-safe.

Prior source-contract evidence also confirms useful terminal semantics without moving authority into presentation: Absence is resolved only when the source request reports an explicit terminal state such as approved/rejected/declined/cancelled/withdrawn; Time Review is resolved only when the source report confirms zero open exceptions for the scoped team; weekly sign-off is resolved only when the source reports the team as signed. These confirmation rules are not a freshness SLA and are not being reimplemented as presentation-side business logic.

### Hypothesis
If the canonical Vector guard explicitly prevents observation timestamps from being promoted into `current`/`fresh` status or an invented age threshold before the authoritative source exposes an SLA, future UX work is less likely to manufacture urgency while managers still retain all source-confirmed work that needs judgment.

### Exact implementation / design delta
- Extended the existing Vector-only repository guard on the same canonical branch.
- The guard now isolates the `structuredReviewRows()` source adapter and fails if it introduces `evidenceState: current`, `Current`/`Fresh`/`Verified current` row status, or a `Date.now()` age calculation against `generatedAt`/`updatedAt` without an upstream SLA contract.
- Added `VECTOR_ACTION_FRESHNESS_NEUTRAL_CONTRACT=PASS` as a distinct regression outcome.
- No product presentation was restyled or expanded this run because the missing dependency is authoritative source semantics, not layout.
- No pending approval/time/sign-off work is suppressed because doing so would silently hide consequential work.

### Serious-idea decision
| Idea | Evidence | Decision |
| --- | --- | --- |
| Treat `generatedAt` / `updatedAt` as proof the item is currently safe to act on | Observation timestamp only; no SLA | **REJECT** |
| Invent a UI age threshold such as 5/15/30 minutes | No authoritative workflow contract | **REJECT** |
| Hide pending/open work when freshness is unknown | Would silently hide judgment/payroll/approval work | **REJECT** |
| Protect neutral behaviour with the existing Vector guard | Distinct regression risk, no duplicated runtime logic | **BUILD NOW** |
| Add authoritative `observedAt` + `freshnessState`/expiry + confirmation state at the source boundary | Needed to support explainable stale/confirming/needs-verification UI | **BUILD NEXT** |

### Focused / affected validation
The guard-only commit is `8a200ded8d11ad7bf0d034623b018588d144f4a0`. Diff inspection confirms the change is limited to `scripts/validate-vector-only-ui.mjs`; no Vector presentation or source workflow was mutated. Exact-head Vector-only run `35439251475` completed successfully: the retired-UI refusal/source guard passed, the exact Docker runtime build passed, and the built-runtime proof confirmed Vector remains the only active presentation. This validates the new freshness-neutral regression at the same risk level as the existing Vector source/build gate; it does not claim real-user or hosted authenticated-role proof.

### UX scorecard impact
- Calm by default: strengthened — source observation time cannot manufacture urgency/freshness.
- Dense on demand: unchanged — no additional surface was added.
- Explainability: strengthened — observation provenance and freshness authority remain distinct concepts.
- Accessibility: unchanged this run; no new interaction was added.
- Authority/auditability: strengthened — terminal source state remains authoritative and presentation cannot create a freshness SLA.
- Development efficiency: improved — one existing guard protects the shared adapter; no duplicate component, model or workflow was introduced.

### Still unverified
An authoritative Time Review/Absence freshness SLA, exact source-side `observedAt`/expiry semantics, source-side confirmation timing for `Decision sent → Confirming source → Needs verification`, authenticated hosted rendering for each role, real screen-reader behaviour, and measured first-click/time-on-task/error rate.

### Single next highest-value NEW-UI action
Define and verify the smallest authoritative source contract required by the shared Vector review adapter: source-owned `observedAt`, an explicit freshness state or expiry derived by the owning workflow, confirmation state, and confirmation-SLA expiry. Reuse that one contract across Time Review, Absence and Sign-off. Do not calculate freshness or SLA in Vector. Once source-side proof exists, bind it once to the shared review rows so missing/stale remains neutral, confirming work stays visible, and `Needs verification` appears only after the source-defined confirmation SLA expires.

## Validated prior Vector increments

| Increment | Bounded delta | Exact evidence |
| --- | --- | --- |
| r5 | Source-bound manager review rows and notification count; removed hidden presentation-card counting | Vector-only run `35436525530` green |
| r4 | Source-bound signed-in identity/site context and approved next-seven-day leave only | Vector-only run `35433767094` green |
| r3 | Removed synthetic KPI trends, invented labour-cost target progress and unsupported KPI severity | Vector-only run `35431023141` green |
| r2 | Removed text-inferred department risk, invented shift timeline and percentage-like planning widths | Vector-only run `35428391626` green |
| r1 | Removed position-derived review urgency; established neutral review-state governance | Vector-only run `35426218781` green |

## Standing release / evidence boundary
- Cycle 10 schedule-publication promotion remains separately gated by exact source-bound hosted proof.
- Vector is the only active NEW-UI presentation owner in this lineage; retired overlays and legacy/0.6.139 presentation remain non-owners.
- No scorecard entry treats a green source/build gate as real-user, hosted authenticated-role, accessibility-device or production proof.
- Missing or stale evidence remains neutral; no presentation wording may manufacture urgency, cost, qualification, compliance, authority or confirmation.
