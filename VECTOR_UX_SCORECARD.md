# Vector UX/CX scorecard

This is the single canonical scorecard for the approved Vector role-first NEW-UI lineage. Historical cycle detail remains in Git history; this file keeps only the current evidence boundary, validated increments and one dependency-ordered next action so documentation does not become a second backlog.

## 2026-09-20 — Vector r15: remove position-inferred action urgency

### Journey reviewed
Factory/operations manager Vector Home → `Needs my action` → compact source-bound Time Review rows. The review focused on whether presentation styling could imply urgency independently of the structured authoritative workflow state.

### NEW-UI lineage confirmation
All product/test work is on `feature/one-day-enterprise-implementation-v1` / PR #79, the canonical Vector role-first NEW-UI owner. No legacy/0.6.139 presentation, retired UI branch, customer-proof runtime, staging or production presentation was changed.

### Reuse / duplicate-work decision
- Reused the existing Universal Action row, `actionDisposition()` / `actionQueueGroups()`, source-owned confirmation lifecycle, existing `vector-action-queue.test.cjs` and existing exact-candidate browser oracle.
- Did not create a new component, queue, lifecycle mapper, CSS fork, branch, test harness or research task.
- Did not repeat competitor/general UX research because the defect was directly observable in current NEW-UI source and the governing product rule is already settled.
- The existing browser oracle already covers Needs-my-action versus Awaiting-source grouping, bell-count exclusion, lifecycle equality, keyboard disclosure and 1440/760/390 containment, so it was not rebuilt.

### Evidence-backed finding
The canonical NEW-UI CSS applied a red/pink action treatment to `.vector-alert-row:first-child>button` purely because the row appeared first. The row renderer does not bind that positional selector to a structured reason code, source urgency state or authority state. This could therefore visually imply that the first item was more urgent even when source evidence did not say so, contradicting the rule that consequential urgency must come only from authoritative structured state.

### Hypothesis
If action styling is neutral by default and presentation order cannot change urgency appearance, managers should be less likely to infer unsupported priority while retaining source-owned lifecycle text and the same compact interaction cost.

### Exact implementation / design delta
- Commit `ee11d60056feb04af6f95c6a76ef90142cc08a64` removes only the positional `.vector-alert-row:first-child>button` red/pink override from `ux-overlay/vector-shell.css`.
- The existing neutral action style remains: `background:#edf3fb; color:#355375`.
- Commit `4b52f4c2d73aa716a4ac2a7752389325fe3e547f` extends the existing `ux-overlay/vector-action-queue.test.cjs` with one distinct regression requiring positional action-button urgency styling to remain absent while the neutral default remains present.
- No action ordering, lifecycle grouping, status text, source evidence, permissions, authority, audit or workflow logic changed.

### Serious-idea decision
| Idea | Evidence | Decision |
| --- | --- | --- |
| Remove first-position red action styling | Current NEW-UI CSS inferred visual urgency from row position alone | **BUILD NOW** |
| Add replacement urgency colours by lifecycle label | Source contract does not define presentation severity/urgency colours | **REJECT** |
| Add another priority field in Vector | Would move priority authority into presentation | **REJECT** |
| Repeat external research on action colour | Existing source-governance requirement already resolves the question | **REJECT** |
| Execute the existing exact-candidate browser oracle once an executor is available | Required to turn source-level validation into real responsive/browser proof | **BUILD NEXT** |

### Focused / affected validation
- Exact source re-fetch confirms the positional first-action button rule is absent and the neutral action-button rule remains.
- Focused assertion smoke passed: `VECTOR_ACTION_URGENCY_STYLE_FOCUSED=PASS|positional-action-style=absent|neutral-action-style=present`.
- The source regression is committed in the existing action-queue test file; no additional harness was created.
- The affected GitHub Vector-only run for exact product/test head `4b52f4c2d73aa716a4ac2a7752389325fe3e547f` again received no executable steps. This is the unchanged runner-allocation blocker and was checked once, not retried.
- The isolated Railway service remains deliberately source-held; no customer-proof, staging or production redeploy was forced to manufacture proof.

### UX scorecard impact
- Calm by default: strengthened — list position no longer creates a visual alarm state.
- Dense on demand: unchanged — no extra interaction, label or screen was introduced.
- Explainability: strengthened — visible lifecycle remains source-owned, while unsupported priority decoration is removed.
- Accessibility: unchanged by this bounded CSS delta; existing status semantics remain intact.
- Responsive containment: unchanged by design; the existing oracle still covers 1440/760/390, but exact-head execution is pending.
- Authority/auditability: strengthened — presentation order cannot masquerade as structured urgency.
- Development efficiency: strengthened — one CSS rule removed, one existing regression extended, no parallel implementation.

### Still unverified
The exact-current-head browser oracle has not executed because the available GitHub job again received no runner and the isolated Railway source remains held. Therefore real rendered visual comparison, browser/accessibility execution and a genuine authoritative `Action required → Decision sent → Confirming source` transition remain unverified. No claim of hosted-green or measured task-time improvement is made.

### Single next highest-value NEW-UI action
Execute the already-existing exact-candidate browser oracle against the current isolated NEW-UI candidate when a safe executor becomes available. Require the current neutral action styling plus the existing source-ID, lifecycle, Needs-my-action/Awaiting-source, bell-count, keyboard, responsive, no-optimistic-clear and return-focus assertions to pass. If green, prove one real source-owned Time Review item transitions `Action required → Decision sent → Confirming source` before reusing the pattern for Absence or weekly sign-off.

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
