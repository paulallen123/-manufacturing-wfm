# Vector UX/CX scorecard

This is the single canonical scorecard for the approved Vector role-first NEW-UI lineage. Historical cycle detail remains in Git history; this file keeps the current evidence boundary, validated deltas and one dependency-ordered next action without repeating old research.

## 2026-09-19 — Vector r5: source-bound review queue and notification count

### Journey reviewed
Factory/operations manager Vector Home → notification badge / `Items to review` → Time Review or Absence & Leave source workflow.

### NEW-UI lineage confirmation
Work remains owned only by the approved Vector Workforce Operations presentation on `feature/one-day-enterprise-implementation-v1` / PR #79. The retired Cycle 11 implementation was inspected only for already-validated structured source behaviour; no old overlay, legacy/0.6.139 presentation, staging/prod surface, replacement branch, duplicate renderer or duplicate test workflow was changed or loaded.

### Reuse / duplicate-work decision
- Extended the existing `vector-shell.js` Home review surface and existing `scripts/validate-vector-only-ui.mjs` guard; no new queue component, service, branch, PR or harness was created.
- Reused authoritative in-browser source state already exposed to the application: `payrollPreview.report()` for structured time/sign-off state, `data.requests` for leave-request state, `people()` / `person()` / `me()` for role-visible scope, and the existing `time-review` / `leave` owning routes.
- Reused the validated predecessor rule that consequential action state comes from structured workflow fields rather than display copy, but re-implemented that requirement directly in Vector rather than loading the retired Cycle 11 presentation.
- Kept all approval, payroll, sign-off, entitlement, calculation, audit and write authority in the owning workflows.

### Research delta
No competitor or generic UX research was repeated. The unresolved question was directly provable from current Vector code: the notification badge and Home review list counted hidden presentation cards (`.fcc-action` / `.ux-approved-decision-card`) rather than structured actionable workflow state. That made a presentation-card quantity look like an authoritative workload count.

### Hypothesis
If Vector derives neutral review rows and the notification count only from structured role-visible workflow state, managers should be less likely to mistake hidden presentation-card quantity for verified work, while preserving a compact one-click route to the authoritative workflow.

### Exact implementation delta
- Added `VECTOR_ACTION_SOURCE_BOUND_V1` to the canonical Vector shell.
- Removed the presentation-derived `actionRows(source)` adapter and removed the notification badge query over hidden `.fcc-action` / `.ux-approved-decision-card` DOM.
- Added one reusable `structuredReviewRows()` source adapter. It reads only structured open time issues, structured weekly sign-off states (`stale`, `returned`, `canSign`, explicit blockers), and structured `pending` leave requests for employees visible to the current role.
- Report-team matching is scoped using structured team/site tokens from the signed-in user and role-visible people. If no structured scope token is available, report-team actions fail closed to none rather than falling back to all teams.
- Employee views fail closed to no manager review rows.
- Review rows remain neutral `Needs review`; Vector still does not infer urgency from wording, row order or colour.
- The global notification badge now uses the structured review-row count and remains hidden at zero. The Home list keeps the existing four-row visual density cap while the section count reflects the full structured set.
- The former ambiguous `View all items` control now says `Open Time Review`; leave-specific rows keep their own direct Absence & Leave action.
- Added source-bound accessibility/evidence markers and changed the empty state to `No source-confirmed items need review.`
- Extended the existing Vector-only guard to reject reintroduction of hidden-presentation action counting, loss of manager/tenant-scope fail-closed behaviour, loss of structured open/pending-state checks, or loss of `VECTOR_ACTION_SOURCE_BOUND_V1`.

### Focused / affected validation
Local focused syntax and the extended Vector repository guard passed before commit. Exact product-code head `7d888913a3eef1fde0b18be7bb9bda9480c987a5` then passed Vector-only run `35436525530`: the repository/source guard passed, the exact Docker runtime build passed, and built-asset proof passed that Vector remains the only active presentation. This proves the source/build-composition contract; it does not claim authenticated hosted-role task behaviour or assistive-technology quality.

### UX scorecard impact
- Calm by default: improved — hidden presentation quantity can no longer manufacture a global workload count.
- Dense on demand: improved — the existing compact four-row surface is retained while the source-owned workflow remains one click away.
- Explainability: improved — review state has an explicit source boundary and neutral wording.
- Accessibility: structurally improved through source-bound labelling and unambiguous row actions; real screen-reader behaviour remains unverified.
- Authority/auditability: preserved — Vector remains read/navigation-only for these consequential workflows.
- Development efficiency: improved — one Vector adapter, one existing guard and one existing exact-runtime workflow were extended; no parallel implementation was created.

### Still unverified
Authenticated hosted rendering for each role, real screen-reader behaviour, measured first-click/time-on-task/error rate, and an explicit source freshness/SLA contract for these review records. Until freshness is exposed authoritatively, these rows stay neutral and no urgent state is claimed.

### Single next highest-value NEW-UI action
Inspect the authoritative Time Review / Absence source contracts for an explicit freshness or observation timestamp plus confirmation lifecycle. If a trustworthy freshness contract already exists, bind it once into the shared Vector review adapter so stale/missing evidence becomes neutral `Needs review` and the top-level badge can suppress unverifiable work. If it does not exist, keep Vector neutral and advance the source-contract/test design without inventing an SLA in the UI.

## Validated prior Vector increments

| Increment | Bounded delta | Exact evidence |
| --- | --- | --- |
| r4 | Source-bound signed-in identity/site context and approved next-seven-day leave only | Vector-only run `35433767094` green |
| r3 | Removed synthetic KPI trends, invented labour-cost target progress and unsupported KPI severity | Vector-only run `35431023141` green |
| r2 | Removed text-inferred department risk, invented shift timeline and percentage-like planning widths | Vector-only run `35428391626` green |
| r1 | Removed position-derived review urgency; established neutral review-state governance | Vector-only run `35426218781` green |

## Standing release / evidence boundary
- Cycle 10 schedule-publication promotion remains separately gated by exact source-bound hosted proof.
- Vector is the only active NEW-UI presentation owner in this lineage; retired overlays and legacy/0.6.139 presentation remain non-owners.
- No scorecard entry treats a green source/build gate as real-user, hosted authenticated-role, accessibility-device or production proof.
- Missing or stale evidence remains neutral; no presentation wording may manufacture urgency, cost, qualification, compliance, authority or confirmation.
