# Vector UX/CX scorecard

This is the single canonical scorecard for the approved Vector role-first NEW-UI lineage. Historical cycle detail remains in Git history; this file keeps the current evidence boundary, validated deltas and one dependency-ordered next action without repeating old research.

## 2026-09-19 — Vector r13: visible authoritative action lifecycle

### Journey reviewed
Factory/operations manager Vector Home → `Items to review` → contract-backed Time Review action. The bounded friction was that Vector already consumed authoritative confirmation state and exposed it in the row accessibility label, but a sighted user still saw only the issue/detail plus a generic `Review` button. That made `Action required`, `Decision sent`, `Confirming source` and `Needs verification` visually indistinguishable.

### NEW-UI lineage confirmation
All product/test mutation is on `feature/one-day-enterprise-implementation-v1` / PR #79, the canonical Vector role-first NEW-UI owner. No legacy/0.6.139 presentation, retired overlay, customer-proof runtime, staging or production presentation was changed.

### Reuse / duplicate-work decision
- Reused the existing Universal Action row, `actionStatus()` mapping, `structuredReviewRows()` consumer, authoritative `WFM_WORKFLOW_ACTION_EVIDENCE_V1` state and current-candidate role browser proof.
- Did not add another badge component, queue, lifecycle mapper, timer, workflow, branch or CSS fork. The status is rendered inside the existing title column so it remains in the compact row and is not removed by the existing mobile rule that hides only the detail column.
- Extended the existing repository Vector guard and existing five-role browser oracle for this distinct visual-state failure mode rather than creating another harness.
- No competitor/general UX research was repeated because no unresolved external design question remained; the defect was directly observable in the current NEW UI source.

### Evidence-backed finding
Before r13, the source-owned lifecycle value was already mapped into each Time Review row and included in `aria-label`, but `alertsMarkup()` did not render `r.status` as visible text. This meant a manager could not visually tell whether an item still needed a decision, had been sent, was confirming upstream or required verification without opening the source workflow.

The smallest safe improvement is therefore presentation-only: surface the already-admitted `r.status` beside the existing action title. It does not infer urgency or colour, does not calculate SLA/freshness, and does not move write authority into Vector.

### Hypothesis
If the existing source-owned lifecycle is visible directly inside each compact action row, managers can distinguish outstanding versus in-flight work without another click or screen while preserving the same authoritative workflow, neutral fallback and mobile containment.

### Exact implementation / design delta
- Commit `b313af4bab95a5a10c67baa86d02f83b9dc50d3d` extends the existing `alertsMarkup()` row only. The already-existing `r.status` is now visibly rendered beside the action title through `data-vector-action-status`, while the row's existing accessible status label remains authoritative.
- The visible lifecycle is marked `aria-hidden` because the row's group `aria-label` already announces the same status; this avoids duplicate screen-reader speech rather than removing accessibility information.
- No lifecycle colour was introduced. Missing/incomplete source evidence continues to show neutral `Needs review`.
- Commit `542d8e3cd56ee434d6a98132a5dc309116993b03` extends the existing source-controlled browser oracle to compare visible status with the authoritative evidence item and require it to remain visible at desktop (1440), tablet (760) and mobile (390) widths before the Time Review navigation assertion proceeds.
- Commit `f687a3d35db038b18a97ec97a3ec81c8868dde0f` extends the existing Vector repository guard so future changes cannot silently return lifecycle state to accessibility-only presentation.

### Serious-idea decision
| Idea | Evidence | Decision |
| --- | --- | --- |
| Render the already-source-owned lifecycle inline in the existing action title | Current NEW-UI source proved sighted lifecycle was absent while accessibility label already contained it | **BUILD NOW** |
| Add colour/severity per lifecycle state | Would imply urgency/severity not provided by the source contract | **REJECT** |
| Add another lifecycle/badge component | Existing action row and status mapper are sufficient | **REJECT** |
| Begin Absence/sign-off lifecycle consumers before Time Review executable proof | Would duplicate an interaction pattern before the first domain is hosted-proven | **REJECT** |
| Prove source-owned `Decision sent → Confirming source` after this row/browser proof executes | Next missing end-to-end lifecycle evidence | **BUILD NEXT** |

### Focused / affected validation
- A deterministic focused local delta check reproduced the exact revised `alertsMarkup()` status fragment across five states (`Action required`, `Decision sent`, `Confirming source`, `Needs verification`, `Needs review`) and passed attribute/text/accessibility consistency plus escaping: `VECTOR_ACTION_LIFECYCLE_DELTA_FOCUSED=PASS|cases=5|escaped=pass`.
- The exact browser-oracle delta was syntax-checked locally: `VECTOR_BROWSER_LIFECYCLE_DELTA_SYNTAX=PASS`.
- Source re-fetch at exact product/test head `f687a3d35db038b18a97ec97a3ec81c8868dde0f` confirms the visible lifecycle marker is in the canonical Vector row and the browser oracle compares it to the authoritative item across desktop/tablet/mobile before navigation.
- Affected GitHub run `35466287202` again received no executable steps (`runner_id=0`, `steps=[]`) and therefore did not execute the repository guard, Docker build or browser suite. This unchanged runner-allocation blocker was observed once after the new head and not retried.
- No customer-proof/staging/production environment was mutated to manufacture proof.

### UX scorecard impact
- Calm by default: preserved — no added urgency colour, countdown, synthetic priority or UI-owned SLA.
- Dense on demand: improved — lifecycle meaning is available inside the existing row with no extra screen, drawer or interaction.
- Explainability: strengthened — a manager can now see whether authoritative work is awaiting action, sent, confirming or needing verification before opening it.
- Accessibility: preserved by design — the pre-existing row accessibility label still announces status; the new duplicate visual text is hidden from assistive technology. Full browser/screen-reader execution remains unverified.
- Responsive containment: strengthened in test design — the existing browser oracle now explicitly requires lifecycle visibility at 1440/760/390 widths; executable hosted result is still pending.
- Authority/auditability: preserved — lifecycle still comes from the validated source contract; Vector neither writes it nor advances it.
- Development efficiency: improved — one existing row, one existing browser oracle and one existing guard were extended; no replacement implementation was created.

### Still unverified
The exact-head hosted/browser suite has not executed because the GitHub job again received no runner. Therefore real DOM visibility at the three widths, actual browser accessibility behaviour, task-time improvement, and source-owned transition through `Decision sent → Confirming source` remain unverified. The current evidence proves the bounded source change, focused markup behaviour and strengthened executable oracle — not hosted success.

### Single next highest-value NEW-UI action
Execute the existing exact-current-candidate browser proof when an executable runner or isolated canonical candidate becomes available. Require visible lifecycle text to equal the authoritative Time Review confirmation state at desktop/tablet/mobile, then preserve the existing source-ID/open/return-focus/no-optimistic-clear assertions. If green, advance only the same Time Review path to a deterministic source-owned `Decision sent → Confirming source` transition before reusing the pattern for Absence or weekly sign-off.

## 2026-09-19 — Vector r12: hosted Time Review evidence replay repair

### Journey reviewed
Factory/operations manager Vector Home → `Items to review` → source-bound Time Review action → authoritative `/api/time-review` evidence → return to the source workflow. The bounded question was whether the first r11 end-to-end browser proof could execute against the isolated current candidate without weakening the source-owned action lifecycle.

### NEW-UI lineage confirmation
All product/test mutation is on `feature/one-day-enterprise-implementation-v1` / PR #79, the canonical Vector role-first NEW-UI owner. No legacy/0.6.139 presentation, retired overlay, customer-proof runtime, staging or production presentation was changed.

### Reuse / duplicate-work decision
- Reused the existing `WFM_WORKFLOW_ACTION_EVIDENCE_V1`, Time Review producer, read-only evidence bridge, `structuredReviewRows()` consumer, r11 return-context interaction and the existing source-controlled five-role browser proof.
- Reused the repository's already-established hosted loopback invariant: hosted local requests preserve the external Host plus `X-Forwarded-Proto` rather than weakening origin/security controls.
- A concurrent canonical commit (`213bcfe6affa24d1af2250b5e3885330aae2a5cc`) had already repaired browser-proof liveness before this cycle's attempted wrapper change. That work was detected by the reuse/diff check, not duplicated, and was used to expose the first real r11 assertion failure.
- Added one regression to the existing action-evidence bridge suite for a distinct hosted reverse-proxy replay failure mode; no second service, bridge, queue, component or browser harness was created.
- No competitor/general UX research was repeated because the unresolved question was now an exact hosted source-replay defect.

### Evidence-backed finding
The isolated test-project application successfully served exact candidate `2dbe3913e50941f90c8e8d73f8c4ff14517e3d24`. Once the existing browser-proof wrapper became diagnosable, its exact candidate run reached the real manager journey and failed at the action-evidence bridge with `502 !== 200` (`Manager action-evidence bridge unavailable`) rather than at Vector rendering or direct Time Review access.

The browser proof checks the manager's direct `/api/time-review` surface before it requests `/api/workforce/lifecycle/action-evidence/time-review`, so this isolated the failure to the bridge replay path. The bridge replayed Host and session cookie to the same authoritative source but omitted the incoming `X-Forwarded-Proto`. Existing hosted repository proofs explicitly require Host plus `X-Forwarded-Proto: https` for localhost requests. The smallest safe repair is therefore to preserve only a normalized incoming `http`/`https` forwarded protocol on the read-only internal source request; no source authority or lifecycle state is synthesized.

### Hypothesis
If the existing read-only Time Review evidence bridge preserves the hosted reverse-proxy protocol context already required by the authoritative runtime, then a manager's contract-backed Vector action should receive the same authenticated source response as direct Time Review, eliminating the bridge-only 502 without changing permissions, tenant scope, freshness, urgency, confirmation or write authority.

### Exact implementation / design delta
- Commit `edfa835d993a1b402f87909bc7e2c1078f61f67d` extends the existing bridge's internal `/api/time-review` GET to pass through only a normalized first `X-Forwarded-Proto` value when it is exactly `http` or `https`.
- The existing Host header, signed-in session cookie, 3-second source timeout, 512 KiB bound, tenant check, employee 403, read-only 405 and fail-closed 502 behaviour are unchanged.
- No presentation code changed. Vector still consumes only validated `WFM_WORKFLOW_ACTION_EVIDENCE_V1` rows and keeps incomplete/unavailable source work neutral.
- Commit `d5f64ff3dca599c60549606ed4f6f49246a64909` extends the existing bridge test file with one default-source-reader regression that proves Host, session cookie and hosted `X-Forwarded-Proto: https` survive the local authoritative replay.

### Serious-idea decision
| Idea | Evidence | Decision |
| --- | --- | --- |
| Preserve normalized incoming forwarded protocol on the internal read-only replay | Exact hosted failure plus existing repository localhost proxy-context contract | **BUILD NOW** |
| Weaken hosted origin/proxy validation so localhost works without proxy context | Would reduce a security boundary to accommodate a bridge defect | **REJECT** |
| Create another Time Review source service or browser harness | Existing authoritative source, bridge and proof already isolate the problem | **REJECT** |
| Start Absence/sign-off consumers before Time Review hosted proof | Would multiply an unproven transport pattern | **REJECT** |
| Prove source-owned `Decision sent → Confirming source` after the bridge journey passes | Required next lifecycle evidence | **BUILD NEXT** |

### Focused / affected validation
- Pre-repair isolated browser-proof deployment `f0b8c928-ab1f-4084-bf1c-e31ccb19b647` built successfully, started the proof wrapper and exposed the first real assertion: `Manager action-evidence bridge unavailable`, `502 !== 200`, at the manager action-evidence request. This is a real exact-candidate integration failure, not a no-run result.
- The repair and its focused regression are committed on the canonical branch. Source re-fetch confirms the bridge now preserves only normalized `http`/`https` forwarded protocol while retaining all prior bounds and fail-closed behaviour.
- The exact-head GitHub Vector-only run `35460340148` for `d5f64ff3dca599c60549606ed4f6f49246a64909` again received no executable workflow steps; that unchanged runner-allocation blocker was checked once and not retried.
- Railway observed the two repair commits but marked automatic browser-proof deployments `SKIPPED`, so the post-repair exact candidate has **not** yet executed the source-controlled browser journey. No customer-proof/staging/production redeploy was forced to manufacture evidence.

### UX scorecard impact
- Calm by default: preserved — no new urgency, colours, timers or optimistic clearing.
- Dense on demand: unchanged — no new screen or navigation burden.
- Explainability: strengthened — a previously opaque hosted proof failure is now isolated to the source replay boundary rather than being misreported as a generic UI failure.
- Accessibility: unchanged in product; r11 focus-return semantics remain code-proven but hosted/browser accessibility proof is still pending.
- Authority/auditability: preserved — the repair transports request context only; business evidence, permissions and lifecycle state remain authoritative-source owned.
- Safety/capability preservation: strengthened — origin/proxy controls are preserved rather than weakened, and unavailable evidence continues to fail closed/neutral.
- Development efficiency: improved — one existing bridge and one existing bridge suite were extended; an overlapping proof-wrapper fix was explicitly not duplicated.

### Still unverified
The repaired bridge has not yet run in an isolated exact-head hosted candidate, so r11's full browser journey is not green yet. Real manager rendering of a contract-backed action, responsive context-bar behaviour, screen-reader behaviour, measured task time/error rate and the source-owned `Decision sent → Confirming source` transition remain unverified. The current evidence proves the exact pre-repair failure, a bounded repair consistent with the runtime's established proxy contract, and source composition — not hosted success after the repair.

### Single next highest-value NEW-UI action
Execute the existing source-controlled current-candidate browser proof against exact head `d5f64ff3dca599c60549606ed4f6f49246a64909` (or its direct canonical child) when the isolated test candidate advances or an executable runner becomes available. Require the manager action-evidence request to return 200 and the existing source-ID/open/return-focus assertions to pass. If that is green, extend the same authoritative fixture path to prove `Decision sent → Confirming source` without UI timers or optimistic clearing. Keep Absence and weekly-signoff consumers gated until this first Time Review lifecycle path has executable proof.

## Validated prior Vector increments

| Increment | Bounded delta | Exact evidence |
| --- | --- | --- |
| r11 | Source-bound Time Review return context + focus restoration + no optimistic clear browser oracle | Source composition/syntax proven; hosted proof exposed bridge 502 in r12 |
| r10 | Bind `Items to review` to the read-only Time Review evidence bridge with per-source neutral fallback | Focused consumer harness 9/9; hosted runner unavailable |
| r9 | Add the read-only role/tenant-scoped Time Review action-evidence runtime bridge | Bridge tests 5/5 + router smoke 1/1; hosted runner unavailable |
| r8 | Add the first fail-closed Time Review producer inside the shared action-evidence contract | Contract suite 14/14; hosted runner unavailable |
| r7 | Establish one shared source-owned freshness/confirmation evidence contract across Time Review, Absence and weekly sign-off | Focused contract suite 10/10; hosted runner unavailable |
| r6 | Prevent observation timestamps becoming presentation-owned freshness/urgency | Vector-only run `35439251475` green |
| r5 | Source-bind manager review rows and notification count; remove hidden presentation-card counting | Vector-only run `35436525530` green |
| r4 | Source-bind signed-in identity/site context and approved next-seven-day leave only | Vector-only run `35433767094` green |
| r3 | Remove synthetic KPI trends, invented labour-cost target progress and unsupported KPI severity | Vector-only run `35431023141` green |
| r2 | Remove text-inferred department risk, invented shift timeline and percentage-like planning widths | Vector-only run `35428391626` green |
| r1 | Remove position-derived review urgency; establish neutral review-state governance | Vector-only run `35426218781` green |

## Standing release / evidence boundary
- Cycle 10 schedule-publication promotion remains separately gated by exact source-bound hosted proof.
- Vector is the only active NEW-UI presentation owner in this lineage; retired overlays and legacy/0.6.139 presentation remain non-owners.
- No scorecard entry treats source/build guards or deterministic tests as real-user, authenticated-role, accessibility-device or production proof.
- Missing or stale evidence remains neutral; presentation wording cannot manufacture urgency, cost, qualification, compliance, authority or confirmation.