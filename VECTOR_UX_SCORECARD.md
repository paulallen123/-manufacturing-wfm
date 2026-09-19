# Vector UX/CX scorecard

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
