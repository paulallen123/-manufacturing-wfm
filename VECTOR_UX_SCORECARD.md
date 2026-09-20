# Vector UX/CX scorecard

This is the single canonical scorecard for the approved Vector role-first NEW-UI lineage. Historical cycle detail remains in Git history; this file keeps only the current evidence boundary, validated increments and one dependency-ordered next action so documentation does not become a second backlog.

## 2026-09-20 — Vector r15.1 design gate: source-confirming rows must not look like fresh work

### Journey reviewed
Factory/operations manager Vector Home → `Needs my action` / collapsed `Awaiting source confirmation` → Time Review. The review focused on whether a row that has already moved to source confirmation still presents itself as if the manager needs to take another action.

### NEW-UI lineage confirmation
All inspection/design work is on `feature/one-day-enterprise-implementation-v1` / PR #79, the canonical Vector role-first NEW-UI owner. No legacy/0.6.139 presentation, retired UI branch, customer-proof runtime, staging or production presentation was changed.

### Reuse / duplicate-work decision
- Reused the existing `actionDisposition()` / `actionQueueGroups()` lifecycle partition, Universal Action row, source-owned confirmation state, current browser oracle and r15 neutral styling.
- Did not create another queue, component, lifecycle mapper, branch, issue, prototype or browser harness.
- Did not repeat external UX/competitor research because the unresolved question is already decided by the product contract: `Decision sent` / `Confirming source` are awaiting-source states, not new action-required states.
- Did not stack a product-code mutation on top of the still-unexecuted exact-candidate r15 browser proof; doing so would move the proof target before the existing increment is validated.

### Evidence-backed finding
The current source correctly separates `decision_sent` / `confirming_source` into collapsed `Awaiting source confirmation`, and excludes those rows from the notification badge. However, `timeReviewEvidenceRows()` still assigns `action: 'Review'` to every active Time Review item, and the shared action-row renderer displays that action unchanged. A manager therefore sees a row inside `Awaiting source confirmation` with the same **Review** affordance used for work that genuinely needs action. This does not change authority or lifecycle, but it can falsely imply that another decision is required.

### Hypothesis
If awaiting-source rows retain inspectability but use a passive lifecycle-consistent affordance instead of the same `Review` action used for unresolved work, managers should distinguish “I need to act” from “the source is confirming my decision” more quickly without losing access to evidence or audit context.

### Exact design delta / acceptance criteria
- **Needs-action rows:** retain the existing `Review` affordance.
- **Awaiting-source rows (`decision_sent`, `confirming_source`):** retain the same source route and inspection capability, but use a passive `View status` affordance and the existing neutral visual treatment.
- Affordance selection must derive only from structured `confirmationState` / `actionDisposition()`. Presentation words such as “urgent”, row order, elapsed client time or AI output must never select it.
- Do not hide awaiting-source rows, remove their route, auto-resolve them, alter authority, or change the badge count.
- Reuse the existing action-row renderer; extend it generically rather than forking a Time Review-only card.
- Extend the existing `vector-action-queue.test.cjs` and current-candidate browser oracle only. Browser acceptance must cover desktop/tablet/mobile, keyboard disclosure, unchanged source ID, unchanged lifecycle text, no optimistic clear and return-to-context.

### Serious-idea decision
| Idea | Evidence | Decision |
| --- | --- | --- |
| Passive `View status` affordance for `decision_sent` / `confirming_source` | Current NEW-UI source groups these as awaiting-source yet renders the same `Review` action as actionable work | **BUILD NEXT** |
| Hide awaiting-source rows entirely | Would remove audit/confirmation visibility and violate the existing lifecycle requirement | **REJECT** |
| Remove the route/button from awaiting-source rows | Would reduce inspectability and recovery | **REJECT** |
| Use colour to distinguish awaiting-source urgency | Source contract does not provide a severity colour authority | **REJECT** |
| Repeat external pattern research before this change | Existing source-state semantics already answer the question | **REJECT** |

### Validation / blocker discipline this run
- Exact source inspection confirms lifecycle grouping is structured and the same `Review` action is currently assigned to all active Time Review evidence rows.
- The current exact-head Vector-only GitHub job still failed before executing any step (`runner_id=0`, `steps=[]`), so the unchanged hosted-runner blocker was checked once and not retried.
- The isolated Railway `wfm-one-day-enterprise-v1` service remains deliberately rooted at `/__security_hold_one_day_enterprise__`; the latest automatic deployment failed at build scheduling and the containment root was not weakened or bypassed.
- `wfm-test-runner` and `wfm-vector-mobile-proof` remain explicitly security-contained; neither containment lock was altered to manufacture proof.

### UX scorecard impact
- Calm by default: design strengthened — confirmation-in-progress will no longer reuse fresh-work wording once implemented.
- Dense on demand: preserved — no new screen, panel or persistent information is added.
- Explainability: strengthened — the action verb will match the authoritative lifecycle state.
- Accessibility: acceptance criteria preserve the same route and disclosure semantics; browser execution remains pending.
- Authority/auditability: preserved — no source state, approval authority, SLA or resolution logic moves into Vector.
- Development efficiency: strengthened — one shared renderer/lifecycle path is the intended owner; no parallel implementation.

### Still unverified
The exact-current-head browser oracle has not executed because GitHub still has no runner and the isolated Railway candidate remains source-held. Therefore r15 neutral styling and the existing queue/browser assertions are still not hosted-green. No r16 product-code claim is made: this run advanced the dependency-safe interaction/test design only.

### Single next highest-value NEW-UI action
Execute the already-existing exact-candidate browser oracle for r15 when a safe executor is available. If green, implement the bounded shared-renderer delta above so `decision_sent` / `confirming_source` rows say **View status** while needs-action rows retain **Review**, then extend the existing unit/browser assertions rather than creating a new harness.

## 2026-09-20 — Vector r15: remove position-inferred action urgency

### Validated delta
- Removed the positional `.vector-alert-row:first-child>button` red/pink override from `ux-overlay/vector-shell.css`.
- The existing neutral action style remains: `background:#edf3fb; color:#355375`.
- Extended `ux-overlay/vector-action-queue.test.cjs` with a distinct regression requiring positional urgency styling to remain absent while the neutral default remains present.
- No action ordering, lifecycle grouping, status text, source evidence, permissions, authority, audit or workflow logic changed.

### Evidence boundary
Focused source assertions passed. Exact-head browser execution remains pending because the available GitHub job received no runner and the isolated Railway candidate is intentionally source-held. No hosted-green or measured task-time claim is made.

## Validated prior Vector increments

| Increment | Bounded delta | Evidence boundary |
| --- | --- | --- |
| r14 | Separate `Needs my action` from collapsed source-owned `Awaiting source confirmation`; browser oracle extended for 1440/760/390 grouping, badge and keyboard checks | Source/unit/oracle code proven; exact-head browser execution pending |
| r13 | Render authoritative lifecycle visibly in the existing action row | Focused markup and oracle syntax proven; hosted browser execution pending |
| r12 | Preserve normalized hosted proxy protocol in the read-only Time Review evidence bridge | Exact pre-repair 502 isolated; source/test repair committed |
| r11 | Source-bound Time Review return context, focus restoration and no optimistic-clear oracle | Source composition proven; hosted execution exposed the r12 bridge defect |
| r10 | Bind `Items to review` to the read-only Time Review evidence bridge with per-source neutral fallback | Focused consumer harness passed |
| r9 | Add read-only role/tenant-scoped Time Review action-evidence bridge | Bridge/router focused tests passed |
| r8 | Add first fail-closed Time Review producer inside the shared evidence contract | Contract suite passed |
| r7 | Establish shared source-owned freshness/confirmation evidence contract | Focused contract suite passed |
| r6 | Prevent observation timestamps becoming presentation-owned freshness/urgency | Vector-only guard green at that increment |
| r5 | Source-bind review rows and bell count; remove hidden presentation-card counting | Vector-only guard green at that increment |
| r4 | Source-bind identity/site context and approved next-seven-day leave only | Vector-only guard green at that increment |
| r3 | Remove synthetic KPI trends, invented labour-cost target progress and unsupported KPI severity | Vector-only guard green at that increment |
| r2 | Remove text-inferred department risk, invented shift timeline and percentage-like planning widths | Vector-only guard green at that increment |
| r1 | Remove position-derived review urgency; establish neutral review-state governance | Vector-only guard green at that increment |

## Standing release / evidence boundary
- Cycle 10 schedule-publication promotion remains separately gated by exact source-bound hosted proof.
- Vector is the only active NEW-UI presentation owner in this lineage; retired overlays and legacy/0.6.139 presentation remain non-owners.
- No scorecard entry treats source/build guards or deterministic tests as real-user, authenticated-role, accessibility-device or production proof.
- Missing or stale evidence remains neutral; presentation wording, order or styling cannot manufacture urgency, cost, qualification, compliance, authority or confirmation.
