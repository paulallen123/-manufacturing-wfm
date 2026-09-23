# Vector UX/CX scorecard

This is the single canonical scorecard for the approved Vector role-first NEW-UI lineage. Historical cycle detail remains in Git history; this file keeps only the current evidence boundary, validated increments and one dependency-ordered next action so documentation does not become a second backlog.

## 2026-09-23 — Scheduling simplicity contract

### Journey boundary
Scheduling parity/evolution is allowed to add intelligence behind **Today / Plan / Factory**, but it may not add a new top-level section, a second scheduling workspace, a permanent scheduling-intelligence panel, or a button simply because a capability exists.

### Complexity budget
- Top-level navigation additions: **0**.
- New Plan tabs: **0**.
- New permanent scheduling panels: **0**.
- Primary actions per scheduling task: **maximum 1**.
- Secondary actions: **maximum 1**, limited to progressive disclosure such as **View details**.
- Default visible scheduling metrics: **maximum 3**.
- If VECTOR can safely complete the task without a human, **no button is rendered**.
- Technical solver/AI language is forbidden from normal action labels; the interface communicates the business outcome instead.

### Product behaviour
VECTOR should pre-calculate, filter ineligible workers, compare internal/cross-site/overtime/contingent/agency options, preserve schedule stability, and prepare the best safe answer in the background. The manager sees the outcome and only the decision they still need to make. Details, rejected alternatives, constraints and evidence remain inspectable on demand.

### Source / proof boundary
`ux-overlay/vector-scheduling-simplicity-contract.cjs` turns this into an executable contract. Its regression protects the existing five-section navigation and action-density limits before scheduling UI is wired. The test is admitted to the exact Docker proof path. This is a source/build guard only until the eventual canonical hosted scheduling journey is browser-proven.

## 2026-09-20 — Vector r16: lifecycle-consistent action affordance

### Journey reviewed
Factory/operations manager Vector Home → `Needs my action` / collapsed `Awaiting source confirmation` → Time Review, plus the source/build/host/browser evidence path used to validate that journey.

### NEW-UI lineage confirmation
All product/test work is on `feature/one-day-enterprise-implementation-v1` / PR #79, the canonical Vector role-first NEW-UI owner. No legacy/0.6.139 presentation, retired UI branch, customer-proof runtime, staging or production presentation was modified directly. Existing legacy presentation files remain source-of-truth references only and cannot satisfy NEW-UI proof.

### Reuse / duplicate-work decision
- Reused the existing `actionDisposition()` / `actionQueueGroups()` lifecycle partition, Universal Action row renderer, source-owned confirmation state, neutral action styling, action-queue regression, Vector-only guard, 24h sell-readiness gate and existing browser oracle/proof server.
- Did not create another queue, component, lifecycle mapper, branch, issue, prototype, release workflow, browser harness or Railway proof service.
- Did not repeat competitor/generic UX research because the unresolved question is evidence integrity and source-owned lifecycle execution, not design theory.
- The highest-value unblocked dependency was the final hand-off between the exact-image digest gate and the existing browser oracle: digest validation existed in the proof server, but the canonical exact-candidate workflow still did not supply the digests and execute that existing oracle against the just-deployed isolated candidate. The existing workflow was extended in place rather than creating another proof lane or mutating the held browser-proof Railway service.

### Hypothesis
If source-confirming rows remain inspectable but use a passive lifecycle-consistent affordance, managers should distinguish “I need to act” from “the source is confirming my decision” faster without losing evidence, recovery or audit context. Browser evidence only supports this when it executes the exact canonical NEW-UI bytes and at least one authoritative row exercises each claimed affordance.

### Exact implementation / test delta
- Shared `actionAffordance(row)` remains the sole renderer owner: `decision_sent` / `confirming_source` → **View status**; `action_required` / `needs_verification` / neutral fallback → **Review**.
- Same route, source ID, workflow binding, lifecycle text, queue grouping, badge count, authority and neutral visual treatment remain unchanged.
- `77a31b15e5e69f65865bd038dd9d427bbc92e098` made lifecycle-affordance coverage non-vacuous: empty authoritative collections report `UNEXERCISED` and strict mode can fail closed.
- `fdedd7b6f0cf40e44e633132b53d67c5575b24a0` corrected the existing browser oracle to load and verify only `/vector-ui.js` + `/vector-ui.css`, require the approved Vector marker in both, and fail if retired presentation assets execute.
- `9e444f050a471fe6ad6f0ee41455ca8c35d90faf` corrected the existing Vector-only UI guard to the same canonical runtime contract and emit SHA-256 digests for both canonical assets.
- `8f2073b58efd41dddaa9cde59660b11a972e38e1` corrected the existing **24h sell-readiness candidate** workflow instead of adding a new release lane. It builds the exact candidate image, extracts `/app/public/vector-ui.js` + `/app/public/vector-ui.css`, records their SHA-256 digests, deploys the same candidate to the existing isolated services, and fails closed unless the hosted canonical bytes match those exact digests. It also rejects retired presentation references/URLs and triggers on the shared Vector presentation composer.
- `673c849121bedbba76a95000081169a0df21bee4` extends the existing browser-proof server to consume the same `VECTOR_CANONICAL_JS_SHA256` / `VECTOR_CANONICAL_CSS_SHA256` contract. When strict mode (`WFM_REQUIRE_VECTOR_ASSET_DIGESTS=true`) is enabled, missing digests fail closed; when digests are supplied, `/vector-ui.js` and `/vector-ui.css` are fetched as bytes and SHA-256 matched before the existing browser oracle runs. The proof server exposes only the resulting binding status/digests, not source authority or secrets.
- `fe9f92dbccb25b28133211291417c7800ef5d2b8` wires that existing digest-aware browser proof into the existing **24h sell-readiness candidate** workflow after the one-day isolated host has passed exact-byte binding. The step reuses the existing browser-proof Dockerfile/oracle, injects the exact source-built JS/CSS digests, enables `WFM_REQUIRE_VECTOR_ASSET_DIGESTS=true`, and requires `BROWSER_PROOF_ASSET_BINDING=BOUND`, the existing five-role browser matrix and action-queue grouping before crediting browser proof. It deliberately keeps `WFM_REQUIRE_ACTION_AFFORDANCE_COVERAGE=false` until authoritative Time Review data contains both lifecycle states; this prevents the workflow inventing data merely to turn the UX gate green. The workflow trigger also now covers the existing browser-proof scripts/Dockerfile so changes to the proof cannot bypass this lane.

### Evidence correction
The previously credited Railway browser matrix cannot be counted as proof of the current canonical NEW UI. Railway HTTP logs for the successful 20 September run showed retired presentation assets executing, so that evidence is historical functional/source-behaviour evidence only, not NEW-UI UX proof.

A later browser attempt reached the hosted candidate but `/api/login` returned `401`, so it did not validate r16. GitHub has repeatedly instantiated corrected workflows without allocating a runner (`runner_id=0`, zero steps). The exact-image/host-byte gate and strict browser binding path are therefore source-controlled but not yet executed hosted evidence; they must not be reported green until a safe executor runs them.

### Focused validation / regression state
- Existing deterministic action-queue regression protects **Review** vs **View status**, matching accessible labels, resolved exclusion, collapsed confirmation disclosure and presentation-word independence.
- Current browser oracle source requires canonical `/vector-ui.js` + `/vector-ui.css` and rejects retired presentation resources before role/journey assertions can pass.
- Existing 1440 / 760 / 390 source-ID, badge, disclosure, keyboard, lifecycle, no-optimistic-clear and return-to-context assertions remain in the same oracle.
- Browser-proof server syntax check passed after the digest-binding delta.
- Focused two-arm digest validation passed locally against a disposable HTTP fixture: exact expected JS/CSS digests reached `BROWSER_PROOF_ASSET_BINDING=BOUND`; a deliberately wrong JS digest failed closed before the oracle with `Hosted /vector-ui.js bytes do not match the exact source-built candidate digest.`
- GitHub accepted the `fe9f92db…` workflow as valid workflow source and instantiated the expected `24h sell-readiness candidate` run, confirming the YAML/trigger path is recognized. That run received no runner (`runner_id=0`, zero steps), so the new exact-source browser execution itself is not yet credited.
- Railway CLI variable-list syntax used by the bounded step was checked against current Railway CLI documentation; credentials are read only from the isolated test service at run time, masked, never committed, and the held browser-proof Railway service is not mutated.
- Hosted execution of these corrected gates remains unverified until a safe runner/executor executes them.

### UX scorecard impact
- Calm by default: improved in source — confirmation-in-progress uses **View status** and stays collapsed.
- Dense on demand: preserved — no new page/panel/permanent detail.
- Explainability: improved in source — visible/accessibility wording follows source lifecycle disposition.
- Evidence integrity: materially improved — legacy presentation cannot satisfy the current browser oracle; zero-row lifecycle assertions cannot count as exercised proof; exact canonical build/host digests are now wired into the same browser proof before role/responsive interaction evidence can be credited.
- Accessibility/responsive evidence: **unverified on the canonical hosted NEW UI** until the strict corrected oracle executes.
- Authority/auditability: preserved — no source state, approval authority, SLA, resolution logic or write authority moved into Vector.
- Development efficiency: improved — the existing exact-candidate workflow, proof server, oracle and Dockerfile were extended in place; no second test owner or proof service was created.

### Still unverified
1. Actual runner execution of the corrected Vector-only build guard and corrected 24h exact-image/host-byte gate.
2. Hosted strict browser execution reaching `BROWSER_PROOF_ASSET_BINDING=BOUND` against the exact source-built candidate and completing the existing role/responsive/accessibility matrix.
3. A genuine source-owned `Action required → Decision sent → Confirming source` transition with at least one actionable and one source-confirming row.
4. Strict lifecycle-affordance browser evidence for **Review → View status**, stable source identity, bell-count exclusion, no optimistic clearing and return focus once both authoritative states exist.

### Single next highest-value NEW-UI action
Execute the existing `24h sell-readiness candidate` workflow unchanged when a safe runner is allocated and require the newly wired exact-source browser step to reach `BROWSER_PROOF_ASSET_BINDING=BOUND`; do not create another proof path or bypass the held Railway service. Only after browser-level exact asset identity is green should the authoritative Time Review source seam drive one item through `Action required → Decision sent → Confirming source` and run the same oracle with `WFM_REQUIRE_ACTION_AFFORDANCE_COVERAGE=true` to prove **Needs my action / Review → Awaiting source confirmation / View status** with stable source identity, unchanged authority and no bell-count inflation.

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
