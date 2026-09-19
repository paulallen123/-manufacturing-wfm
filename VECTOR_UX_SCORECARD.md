# Vector UX/CX scorecard

## 2026-09-19 — Vector r2: neutral department-planning evidence boundary

### Journey reviewed
Factory/operations manager Vector Home → department planning summary → schedule planning source workflow.

### NEW-UI lineage confirmation
Work remains owned only by the approved Vector Workforce Operations presentation on `feature/one-day-enterprise-implementation-v1` / PR #79. The legacy/retired presentation was not modified. Parallel PR #141 was inspected only to recover its validated bounded-observer requirement; that behavior is already present in PR #79, so #141 was explicitly marked superseded and closed rather than maintained as a second Vector implementation.

### Reuse / duplicate-work decision
- Reused the existing `departmentRows()` and `shiftsMarkup()` ownership in `vector-shell.js`; no replacement planning component was created.
- Reused the existing `schedule-publication` owning workflow and its authority rather than copying schedule or coverage logic into Vector.
- Extended the existing `scripts/validate-vector-only-ui.mjs` guard; no second UX test harness or workflow was added.
- Reused the existing bounded MutationObserver implementation already present in PR #79 and closed the overlapping PR #141.

### Research delta
No competitor or generic UX research was repeated. The unresolved question was answered directly from the current Vector implementation: department status was derived from display words (`gap`, `critical`, `short`, `risk`, `review`, `under`) and the UI then invented severity colours, timeline hours and fixed percentage-like widths. The current Vector adapter does not expose a structured planning status/freshness field for those rows, so binding a verified status would have required guessing.

### Hypothesis
If Vector removes text-derived risk, invented timeline widths and implied shift timings until the source workflow supplies structured status/freshness, managers should be less likely to treat decorative presentation as verified operational evidence while retaining one-click access to schedule planning.

### Exact implementation delta
- Added `VECTOR_PLANNING_NEUTRAL_V1` to the current Vector shell.
- `departmentRows()` now uses source cards only for a descriptive label; it no longer parses display words into risk or status.
- Missing structured status now fails neutral as `Open source planning`.
- Removed invented red/amber/green planning severity, hard-coded percentage-like widths and hard-coded 06:00–22:00 time-axis presentation from this summary.
- Kept the approved card hierarchy but changed the section to `Department planning` with a direct `Open schedule planning` route.
- Neutral rows use a non-timeline, non-severity visual treatment and explicitly state that status/coverage are shown only when verified by the source workflow.
- Extended the existing Vector-only guard to fail if text-inferred risk, fixed planning widths/times, or the neutral evidence/visual contract regress.

### Focused / affected validation
On exact product-code head `cbcec55fb2b542fe960a80e7e87e94519efb003e`, Vector-only run `35428391626` allocated a runner and the focused `Refuse retired UI source` step passed, which exercises the extended neutral-review/planning contract. The exact Docker build was still running when this scorecard revision was recorded; built-asset proof, hosted role behavior, real browser layout and assistive-technology behavior therefore remain unclaimed until observed.

### UX scorecard impact
- Calm by default: improved — planning no longer manufactures risk/severity from copy or decorative widths.
- Dense on demand: improved — unverified timeline detail is removed from the summary while source planning remains one click away.
- Explainability: improved — the evidence boundary is explicit instead of implied through colour/position.
- Accessibility: neutral-to-improved structurally; real assistive-technology behavior remains unverified.
- Authority/auditability: preserved — schedule/coverage truth and writes remain in the source workflow.
- Development efficiency: improved — one Vector owner, one guard, and the redundant PR #141 is closed.

### Still unverified
Exact built-asset result for `cbcec55f…`, authenticated hosted-role rendering, real screen-reader behavior, measured first-click/time-on-task/error rate, and a structured source-specific planning freshness/status contract that could safely replace the neutral state.

### Single next highest-value NEW-UI action
Audit the remaining Vector Home KPI/trend presentation for the same evidence problem, starting with hard-coded labour-cost progress and decorative sparklines. Bind only authoritative structured series/targets; otherwise remove the implied trend/progress while preserving the underlying KPI and route.

## 2026-09-19 — Vector r1: neutral review-state governance

### Journey reviewed
Manager Vector Home → summary items requiring review → owning source workflow.

### NEW-UI lineage confirmation
Work is owned only by the current approved Vector Workforce Operations presentation on `feature/one-day-enterprise-implementation-v1`. During this cycle the branch had already retired the historical overlay lineage and introduced an explicit Vector-only repository guard. A stale browser harness accidentally recreated during the transition was removed immediately; no retired presentation implementation remains owned by this cycle.

### Reuse / duplicate-work decision
- Reused the approved `vector-shell.js` as the single presentation owner.
- Reused underlying WFM routes and source workflows for authority; no calculation, approval, payroll, compliance, tenant or audit rule was copied into Vector.
- Extended the existing `validate-vector-only-ui.mjs` and existing Vector-only workflow rather than creating another presentation branch or parallel test workflow.
- The sealed underlying application may remain as hidden functional/source-of-truth behaviour; the guard now verifies that retired presentation overlays are not active instead of incorrectly requiring authoritative source code to disappear from the artifact.

### Research delta
No external competitor or generic UX research was repeated. The unresolved issue was directly observable in current Vector source: Home review rows were given red/amber urgency purely from their array position even when no structured urgency evidence existed.

### Hypothesis
If Vector keeps review items neutral unless a structured source contract proves urgency, users should be less likely to treat presentation order as operational severity while retaining one-click access to the owning workflow.

### Exact implementation delta
- Removed index-based red/amber urgency from Vector Home review rows.
- Unverified rows now use one neutral review treatment and the explicit state `Needs review`.
- Added accessible group context stating that source evidence must be reviewed before acting.
- Added unambiguous `Review <item>` accessible names without increasing visible density.
- Added `VECTOR_REVIEW_NEUTRAL_V1` as the current presentation-governance contract.
- Extended the existing Vector-only repository validator to fail if presentation-index urgency returns or the neutral/accessibility contract is removed.
- Corrected the exact-runtime guard so hidden authoritative source behaviour may remain underneath while retired presentation overlays remain forbidden and Vector remains the only visible shell.

### Focused / affected validation
Exact workflow run `35426218781` is green. The repository guard passed, the exact Docker runtime build passed, and the built-asset proof passed that retired presentation overlays are absent while Vector is loaded as the only active presentation shell. This verifies the current neutral-review contract at source/build-composition level; it does not claim real assistive-technology or hosted-user evidence.

### UX scorecard impact
- Calm by default: improved — review ordering no longer manufactures severity.
- Dense on demand: unchanged — no new panel or page added.
- Explainability: improved — review state explicitly directs users to authoritative source evidence.
- Accessibility: improved structurally through descriptive group/action names; real assistive-technology quality remains unverified.
- Authority/auditability: preserved — all consequential writes and evidence remain in owning workflows.
- Development efficiency: improved — one current Vector presentation owner and one current guard; stale retired harness removed.

### Still unverified
Real screen-reader behaviour, measured user task time/error rate, authenticated hosted-role behaviour, structured source-specific freshness/authority on each Home review row, and Cycle 10's separate source-bound promotion proof.

### Single next highest-value NEW-UI action
Replace Vector's remaining text-derived status/risk presentation with structured source state where authoritative fields already exist. Start with the workforce/department planning summary; if no structured status or freshness contract is available, keep the presentation neutral rather than infer risk from display words.
