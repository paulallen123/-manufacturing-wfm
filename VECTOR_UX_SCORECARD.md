# Vector UX/CX scorecard

This is the single canonical scorecard for the approved Vector role-first NEW-UI lineage. Historical cycle detail remains in Git history; this file keeps the current evidence boundary, validated deltas and one dependency-ordered next action without repeating old research.

## 2026-09-19 — Vector r10: contract-backed Time Review action consumer

### Journey reviewed
Factory/operations manager Vector Home → `Items to review` / notification count → Time Review. The bounded question was whether the existing Vector action surface could consume the already-built `WFM_WORKFLOW_ACTION_EVIDENCE_V1` bridge without creating a second queue, second lifecycle implementation or presentation-owned freshness/urgency logic.

### NEW-UI lineage confirmation
All mutation is on `feature/one-day-enterprise-implementation-v1` / PR #79, the canonical Vector role-first NEW-UI owner. No legacy/0.6.139 presentation, retired overlay, staging, production or customer-proof surface was changed.

### Reuse / duplicate-work decision
- Reused the existing `structuredReviewRows()`, alert card, notification badge and return-to-Time-Review route.
- Reused the existing read-only `GET /api/workforce/lifecycle/action-evidence/time-review` bridge and shared `WFM_WORKFLOW_ACTION_EVIDENCE_V1` vocabulary.
- Extended the existing Vector-only repository guard rather than adding a second test harness.
- Kept the existing local Time Review summary only as a neutral fail-safe when no admissible contract row is available; weekly sign-off and Absence logic were intentionally left unchanged.
- No competitor/general UX research was repeated because the unresolved dependency was internal source binding, not an interaction-pattern question.

### Hypothesis
If Vector reads the authoritative Time Review evidence contract once per page session, validates every returned record fail-closed, shows only source-owned confirmation/freshness state and retains the existing neutral fallback when evidence is unavailable/incomplete, managers gain a more explainable action queue without moving authority, SLA or urgency calculation into presentation code.

### Exact implementation / design delta
- Vector now performs a same-origin, no-store, GET-only read of `/api/workforce/lifecycle/action-evidence/time-review`; no polling/retry loop was added.
- Response and item contract version/workflow are validated before use. Stable source ID, structured reason code, observation timestamp, authority, freshness state and confirmation state are required client-side as a defence-in-depth admission boundary.
- `current` freshness is accepted only when the source also provides a policy reference and valid-until timestamp; Vector compares no timestamp to wall-clock time and calculates no freshness/SLA state.
- `Needs verification` is accepted only when the source says the SLA expired; `Resolved` requires source confirmation/audit evidence and is not shown as work still requiring action.
- Active contract rows reuse the existing alert component and remain visually neutral. The visible status is the source lifecycle (`Action required`, `Decision sent`, `Confirming source`, `Needs verification`), while detail exposes source `whyNow`, source freshness wording and `authorityRequired`.
- If the bridge is unavailable, malformed, contract-mismatched or yields no admissible active records, the existing local open-Time-Review summary remains as `Needs review` so consequential work is not silently hidden.
- Existing weekly sign-off states and pending Absence requests remain on their previous neutral source-bound paths. No Absence/sign-off contract consumer was built in parallel.
- When contract evidence arrives after initial render, only the existing review list and notification count are refreshed; the page is not rebuilt.

### Serious-idea decision
| Idea | Evidence | Decision |
| --- | --- | --- |
| Consume the existing read-only Time Review action-evidence bridge | Bridge and shared producer already exist on the same canonical branch | **BUILD NOW** |
| Create a new Vector queue/service for Time Review | Would duplicate the existing action surface and source contract | **REJECT** |
| Calculate freshness, urgency or SLA state in Vector | Violates the source-owned contract boundary | **REJECT** |
| Remove local neutral fallback immediately | Could hide consequential work when source evidence is incomplete/unavailable | **REJECT** |
| Build Absence/sign-off consumers in the same increment | First end-to-end Time Review path still lacks hosted execution proof | **BUILD NEXT, AFTER PROOF** |

### Focused / affected validation
Product-code commit `4a188477e3abb20f16bc00fe751a0ad6fec35a93` binds the consumer. Guard commit `d154333591515cd3ad153a2a2fa4e737547482ab` extends the existing Vector-only validator with distinct checks for the exact bridge path, same-origin/no-store read, response/item contract validation, source-owned Needs-verification semantics, resolved-item suppression, neutral fallback and absence of a retry loop.

The affected Vector-only run `35453869407` was triggered for `d154333591515cd3ad153a2a2fa4e737547482ab`, but GitHub allocated no runner: job `105925622720` completed with `steps=[]` and `runner_id=0`. Therefore no repository guard, Node syntax check, Docker build, browser or accessibility step executed. This is unavailable hosted test infrastructure, not a claimed product-test pass or product-test failure. The unchanged runner blocker was verified once and was not retried.

### UX scorecard impact
- Calm by default: strengthened — source lifecycle can be shown without severity colour; unavailable/incomplete evidence stays neutral.
- Dense on demand: improved — authority and source freshness meaning are carried in the existing action row without adding a new screen.
- Explainability: strengthened — each admitted Time Review action can expose why it exists, authority and source lifecycle/freshness state.
- Accessibility: structurally preserved by reusing the existing labelled alert row/button, but real screen-reader behaviour remains unverified.
- Authority/auditability: strengthened — presentation validates and displays source contract state but does not calculate authority, freshness, SLA or resolution.
- Development efficiency: improved — one existing consumer, one existing endpoint, one existing guard; no duplicate queue/service/test harness.

### Still unverified
The changed Vector source and new guard have not executed in CI because the affected GitHub job received no runner. Authenticated hosted rendering of contract-backed rows, malformed/empty bridge behaviour in the real browser, responsive behaviour, real screen-reader behaviour and measured first-click/time-on-task/error rate remain unverified. The bridge producer still depends on real Time Review records supplying stable IDs, structured reasons, authority and observation evidence; incomplete records intentionally fall back to neutral review rather than becoming trusted contract actions.

### Single next highest-value NEW-UI action
Validate the first end-to-end Time Review path in an executable environment: contract-backed action appears → opens authoritative Time Review → return-to-context remains stable → source decision moves through `Decision sent` / `Confirming source` without optimistic clearing. If the hosted runner remains unavailable, add no parallel implementation; advance only deterministic browser/test design against this same Vector owner. Do not start the Absence or weekly-signoff contract consumer until this path has executable proof.

## Validated prior Vector increments

| Increment | Bounded delta | Exact evidence |
| --- | --- | --- |
| r9 | Added the read-only role/tenant-scoped Time Review action-evidence runtime bridge | Bridge tests 5/5 + router smoke 1/1; hosted runner unavailable |
| r8 | Added the first fail-closed Time Review producer inside the shared action-evidence contract | Contract suite 14/14; hosted runner unavailable |
| r7 | Established one shared source-owned freshness/confirmation evidence contract across Time Review, Absence and weekly sign-off | Focused contract suite 10/10; hosted runner unavailable |
| r6 | Prevented observation timestamps becoming presentation-owned freshness/urgency | Vector-only run `35439251475` green |
| r5 | Source-bound manager review rows and notification count; removed hidden presentation-card counting | Vector-only run `35436525530` green |
| r4 | Source-bound signed-in identity/site context and approved next-seven-day leave only | Vector-only run `35433767094` green |
| r3 | Removed synthetic KPI trends, invented labour-cost target progress and unsupported KPI severity | Vector-only run `35431023141` green |
| r2 | Removed text-inferred department risk, invented shift timeline and percentage-like planning widths | Vector-only run `35428391626` green |
| r1 | Removed position-derived review urgency; established neutral review-state governance | Vector-only run `35426218781` green |

## Standing release / evidence boundary
- Cycle 10 schedule-publication promotion remains separately gated by exact source-bound hosted proof.
- Vector is the only active NEW-UI presentation owner in this lineage; retired overlays and legacy/0.6.139 presentation remain non-owners.
- No scorecard entry treats a source/build guard or deterministic local test as real-user, hosted authenticated-role, accessibility-device or production proof.
- Missing or stale evidence remains neutral; no presentation wording may manufacture urgency, cost, qualification, compliance, authority or confirmation.
