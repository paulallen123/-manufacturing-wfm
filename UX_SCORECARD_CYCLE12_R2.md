# WFM UX scorecard — Cycle 12 r4

## Journey reviewed
Specialist/system priority → governed Cycle 12 provider contract → shared Cycle 11 Decision Card → owning source workflow.

## Reuse / duplicate check
- Work remained on the canonical Cycle 12 successor branch; no legacy/0.6.139 presentation surface was changed.
- Reused the existing Cycle 12 provider registry/model, Cycle 11 Decision Card/navigation grammar, and the existing Cycle 12 signal-contract regression.
- No new page, drawer, route, card renderer, approval flow, write path, or test harness was created.
- The previous specialist return-context primitive remains the single return lifecycle.

## Research delta
No external competitor or generic UX research was repeated. The unresolved question was internal and directly observable in the current contract: a registered provider could supply an arbitrary `route`, allowing a card to retain a trusted source label while navigating to an unrelated workflow. Existing source-ownership principles were sufficient to decide the change.

## Hypothesis
If provider identity and destination route are bound by one governed contract, users cannot be shown a Payroll, Attendance, Integration or other source-bound priority that silently navigates to a different domain. This should improve predictability and explainability without adding interface density or moving write authority into the presentation layer.

## Exact implementation delta
- Added an explicit `allowedRoutes` contract to every existing Cycle 12 provider.
- Added one shared `sourceRoute()` normaliser that accepts a requested route only when it is in that provider's registered allow-list; otherwise it falls back to the provider's existing default route.
- Preserved all current provider destinations exactly: Implementation/Learning → Onboarding, Integrations → Integrations, Attendance → Attendance, Agency → Temporary, Manufacturing cost → Costs, Energy → Insights, Support/Documents → Support, Handover → Handover, Payroll → Payroll run.
- Provider source identity remains bound by registration; signal payloads can no longer create cross-domain navigation while retaining a different trusted source label.
- No server-side permission, payroll, attendance, implementation, approval, tenant, audit or source-write logic changed.
- Extended the existing Cycle 12 contract regression with a spoofed Payroll → Leave route case and a valid explicit Attendance route case; no second harness was created.

## Focused validation
- `node --check` passed for the revised Cycle 12 model.
- `node --check` passed for the extended existing Cycle 12 signal-contract script.
- Focused VM contract check passed: a Payroll signal requesting `leave` was normalised back to `payroll-run`, an authorised Attendance route remained `attendance`, and an unknown provider remained rejected: `UX12_PROVIDER_ROUTE_BINDING=PASS`.
- The complete repository gate/composed-browser path remains unverified until hosted execution is available on the exact changed head.

## UX scorecard impact
- Calm by default: unchanged; no additional visible control or navigation was added.
- Dense on demand: unchanged; the same shared cards and owning workflows remain in use.
- Explainability: improved; source label and destination can no longer disagree through provider-supplied route data.
- Navigation predictability: improved structurally; each provider now has an explicit source-owned route contract.
- Accessibility: unchanged in presentation; no new focus surface was introduced.
- Development efficiency: improved; routing governance lives once in the provider normaliser and is protected by the existing contract test.
- Capability preservation: green by design; existing provider routes and all authoritative workflow controls are preserved.

## Serious-idea decisions
- Guess a specialist in-workflow focus selector without authoritative evidence: **REJECT** — no verified stable source-specific target was found.
- Let registered provider payloads choose any product route: **REJECT** — source/navigation mismatch and cross-domain drift risk.
- Bind destination routes to the existing provider contract: **BUILD NOW — completed**.
- Create a separate routing layer for specialist queues: **REJECT** — duplicates the provider and Cycle 11 navigation contracts.
- Repeat generic competitor research this run: **REJECT** — it would not change the source-governance decision.

## Still unverified
Full existing Cycle 12 contract/gate execution on the exact head, sealed-runtime composed-browser behaviour, screen-reader/mobile/tablet specialist round trips, a verified source-specific in-workflow target for the next specialist domain, and Cycle 10 exact source-bound hosted promotion proof.

## Single next highest-value action
Run the existing Cycle 12 contract/gate on the exact head if infrastructure executes it. If hosted execution remains unavailable, inspect the first real next provider adapter (prefer Integrations or Attendance) and wire it only from authoritative structured source state with verified permissions and evidence; reuse the same provider/Decision Card/return contracts and do not create another UI path.
