# Vector UX/CX scorecard

This is the single canonical scorecard for the approved Vector role-first NEW-UI lineage. Historical cycle detail remains in Git history; this file keeps only the current evidence boundary, validated increments and one dependency-ordered next action so documentation does not become a second backlog.

## 2026-09-20 — Vector r16: lifecycle-consistent action affordance

### Journey reviewed
Factory/operations manager Vector Home → `Needs my action` / collapsed `Awaiting source confirmation` → Time Review, plus the source/build/browser evidence path used to validate that journey.

### NEW-UI lineage confirmation
All product/test work is on `feature/one-day-enterprise-implementation-v1` / PR #79, the canonical Vector role-first NEW-UI owner. No legacy/0.6.139 presentation, retired UI branch, customer-proof runtime, staging or production presentation was changed. The browser oracle remains explicitly bound to the canonical composed NEW-UI entrypoints `/vector-ui.js` and `/vector-ui.css` and rejects execution of retired presentation assets.

### Reuse / duplicate-work decision
- Reused the existing `actionDisposition()` / `actionQueueGroups()` lifecycle partition, Universal Action row renderer, source-owned confirmation state, neutral action styling, action-queue regression, Vector-only guard and existing browser oracle.
- Did not create another queue, component, lifecycle mapper, branch, issue, prototype, workflow or browser harness.
- Did not repeat competitor/generic UX research because the unresolved question is evidence integrity and source-owned lifecycle execution, not design theory.
- The dependency check found the existing Vector-only workflow was stale: the runtime had already moved to the canonical composed `/vector-ui.js` + `/vector-ui.css` presentation and physically removes retired presentation files, while the guard still required `vector-shell.js` and `factory-control-ui.css` from the retired runtime presentation. That stale guard would have failed for the wrong reason as soon as runner allocation recovered, so it had to be corrected before exact hosted proof could be trusted.

### Hypothesis
If source-confirming rows remain inspectable but use a passive lifecycle-consistent affordance, managers should distinguish “I need to act” from “the source is confirming my decision” faster without losing evidence, recovery or audit context. Browser evidence only supports this when it executes the canonical NEW-UI presentation and at least one authoritative row exercises each claimed affordance.

### Exact implementation / test delta
- Shared `actionAffordance(row)` remains the sole renderer owner: `decision_sent` / `confirming_source` → **View status**; `action_required` / `needs_verification` / neutral fallback → **Review**.
- Same route, source ID, workflow binding, lifecycle text, queue grouping, badge count, authority and neutral visual treatment remain unchanged.
- `77a31b15e5e69f65865bd038dd9d427bbc92e098` made lifecycle-affordance coverage non-vacuous: empty authoritative collections report `UNEXERCISED` and strict mode can fail closed.
- `fdedd7b6f0cf40e44e633132b53d67c5575b24a0` corrected the existing browser oracle to load and verify only `/vector-ui.js` + `/vector-ui.css`, require the approved Vector marker in both, and fail if `vector-shell.js`, `review-ui.*`, `factory-control-ui.css`, `value-cockpit-ui.*` or `ui-evolution.css` execute. No second harness was created.
- `9e444f050a471fe6ad6f0ee41455ca8c35d90faf` corrected the existing **Vector-only UI guard** to the same canonical runtime contract instead of creating another validation lane. It now builds the exact runtime, requires `/vector-ui.js` + `/vector-ui.css` and their approved markers, requires both canonical entrypoints in `index.html`, fails if retired presentation files or references remain, and emits SHA-256 digests for both canonical assets. Its trigger scope now also covers `implementation/ui/**`, `learning/ui/**` and the shared presentation composer so future changes to any code composed into Vector cannot bypass this guard.

### Evidence correction
The previously credited Railway browser matrix cannot be counted as proof of the current canonical NEW UI. Railway HTTP logs for the successful 20 September run show the browser executing retired presentation assets including `/vector-shell.js`, `/review-ui.js`, `/review-ui.css`, `/factory-control-ui.js`, `/factory-control-ui.css`, `/value-cockpit-ui.js`, `/value-cockpit-ui.css` and `/ui-evolution.css`. The old oracle explicitly fetched `/vector-shell.js`, so it could pass on that older presentation even while logging a newer expected SHA. That evidence is now reclassified as historical functional/source-behaviour evidence only, not NEW-UI UX proof.

A later browser attempt also reached the same hosted candidate but `/api/login` returned `401`, so it did not validate r16. The current Railway proof service skipped the new `fdedd7b6…` commit under its existing security hold. After the canonical guard correction, GitHub runs `35501180290` / `35501182639` accepted the revised workflow but again received no runner and executed zero steps (`runner_id=0`), so the unchanged allocation blocker was observed once for the meaningful new head and was not retried.

### Focused validation / regression state
- Existing deterministic action-queue regression protects **Review** vs **View status**, matching accessible labels, resolved exclusion, collapsed confirmation disclosure and presentation-word independence.
- Current browser oracle source requires canonical `/vector-ui.js` + `/vector-ui.css` and rejects retired presentation resources before role/journey assertions can pass.
- Existing 1440 / 760 / 390 source-ID, badge, disclosure, keyboard, lifecycle, no-optimistic-clear and return-to-context assertions remain in the same oracle.
- GitHub accepted and instantiated the corrected Vector-only workflow at exact commit `9e444f050a471fe6ad6f0ee41455ca8c35d90faf`, but hosted execution is still infrastructure-blocked before step 1; therefore the new built-asset assertions and emitted asset hashes are source-controlled but not yet executed evidence.
- Hosted execution of the corrected browser oracle remains blocked; therefore no hosted responsive/accessibility claim is currently made for r16.

### UX scorecard impact
- Calm by default: improved in source — confirmation-in-progress uses **View status** and stays collapsed.
- Dense on demand: preserved — no new page/panel/permanent detail.
- Explainability: improved in source — visible/accessibility wording follows source lifecycle disposition.
- Evidence integrity: materially improved — legacy presentation can no longer satisfy the current browser oracle, zero-row lifecycle assertions cannot count as exercised proof, and the authoritative build guard no longer expects retired presentation assets.
- Accessibility/responsive evidence: **unverified on the canonical hosted NEW UI** until the corrected oracle executes.
- Authority/auditability: preserved — no source state, approval authority, SLA, resolution logic or write authority moved into Vector.
- Development efficiency: improved — one existing workflow was repaired rather than adding a second gate; the same canonical composed assets are now the subject of source, build and browser validation.

### Still unverified
1. Execution of the corrected Vector-only build guard so the canonical `/vector-ui.js` and `/vector-ui.css` SHA-256 values are produced from the exact candidate image.
2. A hosted candidate built from the current canonical branch that actually serves those exact canonical asset bytes without retired presentation resources.
3. Exact source-bound browser identity by comparing hosted canonical asset digests with the digests produced from the exact source-built image, rather than merely logging `WFM_EXPECTED_CANDIDATE_SHA`.
4. A genuine source-owned `Action required → Decision sent → Confirming source` transition with at least one actionable and one source-confirming row.
5. Corrected-oracle browser evidence for 1440 / 760 / 390, keyboard disclosure, source identity, bell-count exclusion, no optimistic clearing and return focus.

### Single next highest-value NEW-UI action
Extend the **existing** corrected browser oracle to consume the canonical `vector-ui.js` / `vector-ui.css` SHA-256 values produced by the exact source-built image and fail closed on any hosted-byte mismatch. Do not create another proof path. Once a safe executor is available, run that same oracle against the isolated canonical candidate; only after exact asset identity passes should the existing authoritative Time Review source seam drive one item through `Action required → Decision sent → Confirming source` and prove **Needs my action / Review → Awaiting source confirmation / View status** with stable source identity, unchanged authority and no bell-count inflation.

## 2026-09-20 — Vector r15: remove position-inferred action urgency

### Validated delta
- Removed the positional first-row red/pink action override from `ux-overlay/vector-shell.css`.
- Existing neutral action treatment remains.
- Existing action-queue regression protects the absence of position-derived urgency.
- No ordering, lifecycle, source evidence, permission, authority or workflow logic changed.

## Validated prior Vector increments

| Increment | Bounded delta | Evidence boundary |
| --- | --- | --- |
| r14 | Separate `Needs my action` from collapsed source-owned `Awaiting source confirmation`; responsive/keyboard oracle assertions added | Source/unit/oracle code present; canonical hosted NEW-UI execution now requires re-proof |
| r13 | Render authoritative lifecycle visibly in the existing action row | Source-level implementation; canonical hosted active-row execution pending |
| r12 | Preserve normalized hosted proxy protocol in the read-only Time Review evidence bridge | Exact pre-repair 502 isolated; source/test repair committed |
| r11 | Source-bound Time Review return context, focus restoration and no optimistic-clear oracle | Source composition present; canonical hosted re-proof pending |
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
- Vector is the only approved NEW-UI presentation owner in this lineage; retired overlays and legacy/0.6.139 presentation are functional/source references only and may never satisfy NEW-UI proof.
- No scorecard entry treats source/build guards, deterministic tests, an expected-SHA environment value or a browser run on a retired presentation as exact hosted NEW-UI proof.
- Missing or stale evidence remains neutral; presentation wording, order or styling cannot manufacture urgency, cost, qualification, compliance, authority or confirmation.
