# WFM UX scorecard — Cycle 12 r5

## Journey reviewed
Authoritative Integration Fabric state → Cycle 12 `integrations` provider → shared Cycle 11 Decision Card → existing Integrations workflow → shared return context.

## New-UI lineage confirmation
All design and implementation work remained on canonical Cycle 12 PR #90 (`ux/cycle12-unified-operating-experience-20260918-r1`). No legacy/0.6.139 presentation surface, customer-proof environment, staging service or production service was changed.

## Reuse / duplicate check
- Reused the existing Cycle 12 provider registry, route binding, Cycle 11 ranking/Decision Card/navigation/return-context primitives and existing signal-contract regression.
- Reused the existing implementation read-only status adapter pattern by extracting one shared `refreshSource()` poller rather than adding a second polling implementation.
- Inspected the existing Autonomous Integration Fabric only as authoritative source behaviour. Its manager-safe `GET /api/integrations/autonomous/status` contract is reused; no UX was added to or modified on that separate branch.
- No new page, drawer, route, card renderer, queue, approval flow, write path, API calculation or test harness was created.

## Research delta
No competitor or generic UX research was repeated. The unresolved question was whether a real authoritative integration source already existed. Repository inspection confirmed the Autonomous Integration Fabric exposes a signed-in manager status contract containing connection state, health/sync evidence, source identity and reconciliation summary. That changed the decision from placeholder/provider-only design to a bounded read-only adapter.

## Hypothesis
If only actionable authoritative integration states are surfaced through the existing universal action grammar, managers can find authorization and recovery work without hunting through setup screens, while ACTIVE/VALIDATING connections stay calm and a DEGRADED state cannot manufacture urgency when freshness is not contractually proven.

## Exact implementation delta
- Added one `integrationSignals(status)` mapper to the existing Cycle 12 model.
- `AUTHORIZATION_REQUIRED` becomes a current, mandatory, neutral `NEEDS_REVIEW` action to the existing Integrations workflow.
- `REAUTH_REQUIRED` becomes a current, mandatory `INTEGRATION_DEGRADED` recovery action to the existing Integrations workflow.
- `DEGRADED` becomes an Integration review action but remains `unknown`/`missing` evidence because the source contract does not expose a confirmation-freshness SLA; Cycle 11 therefore caps it to neutral review rather than an urgent blocker.
- `ACTIVE` and `VALIDATING` produce no action card, preserving calm-by-default behaviour.
- Generalised the existing implementation status fetch into one reusable `refreshSource()` poller and bound `/api/integrations/autonomous/status` through the same cache/fail-closed path. 401/403/404/non-OK/network absence remains silent rather than inventing status.
- Registered `integrations` on the existing unified signal surface and exposed a manual refresh through the existing `WFMUXSignals` object.
- No integration write authority, credential handling, connection state transition, reconciliation, payroll/attendance logic, permissions, audit or tenant logic moved into presentation.

## Focused validation
- Updated Cycle 12 model syntax check passed locally.
- Shared source-poller syntax check passed locally: `UX12_SOURCE_POLLER_SYNTAX=PASS`.
- Focused integration fixture passed: `UX12_INTEGRATION_SOURCE_BINDING_FOCUSED=PASS`.
- The extended existing contract covers AUTHORIZATION_REQUIRED, REAUTH_REQUIRED, DEGRADED, ACTIVE and VALIDATING; it asserts the first three are the only surfaced actions, all stay source-routed to Integrations, and DEGRADED cannot present current evidence without an authoritative freshness contract.
- The exact changed code head produced no GitHub workflow run when checked once, so hosted/composed-browser/accessibility proof is not claimed green and the unchanged execution blocker was not retried.

## UX scorecard impact
- Calm by default: improved — ACTIVE/VALIDATING connections remain absent from the action queue.
- Dense on demand: unchanged — detail stays in the existing Integrations workflow.
- Explainability: improved — source state, authority and route are explicit and source-bound.
- Decision safety: improved — DEGRADED cannot become urgent from a stale/unspecified health timestamp.
- Navigation predictability: unchanged/green — all integration actions use the existing route and return lifecycle.
- Accessibility/responsive: no new visible primitive; full browser/screen-reader proof remains pending.
- Development efficiency: improved — one shared source poller now serves implementation and integrations.
- Capability preservation: green by design — no source workflow or write capability was removed or duplicated.

## Serious-idea decisions
- Build a separate integration dashboard/queue: **REJECT** — duplicates the role-first action surface.
- Treat every non-ACTIVE state as urgent: **REJECT** — would manufacture consequence without freshness/authority evidence.
- Bind the existing manager-safe Integration Fabric status contract read-only: **BUILD NOW — completed**.
- Surface ACTIVE/VALIDATING receipts every cycle: **REJECT** — unnecessary density with no decision required.
- Invent an integration confirmation SLA: **REJECT** — source contract does not provide one.

## Still unverified
Sealed-runtime composed-browser behaviour on the exact changed head, mobile/tablet/screen-reader rendering of real Integration Fabric data, real authenticated source round-trip on a safely composed development candidate, and Cycle 10 exact source-bound hosted promotion proof.

## Single next highest-value action
Inspect the authoritative Attendance source contract already owned by the new-platform engineering line. If it exposes manager-safe structured coverage/certification exceptions, bind only those exceptions through the existing `attendance` provider and the same shared source-poller/Decision Card/return lifecycle. If it does not, do not invent an adapter; advance the next verified provider instead.
