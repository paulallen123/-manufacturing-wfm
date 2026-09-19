# UX scorecard — Cycle 12 r6 / Vector priority projection

## Journey reviewed
Approved Vector manager Home → governed Universal Action Queue priority → Integrations owning workflow → Back to priority queue → exact originating Decision Card focus.

## NEW-UI lineage confirmation
All work in this cycle was applied only to `feature/one-day-enterprise-implementation-v1`, the approved Vector Workforce Operations NEW-UI lineage. No legacy/0.6.139 presentation surface, superseded concept shell, customer-proof runtime, staging or production environment was mutated.

## Fast reuse / dependency decision
- Reused the existing Cycle 11 Decision Card renderer, ranking, evidence/authority rows, source marker, route hand-off, return control and focus restoration.
- Reused the existing Cycle 12 provider registry, integration source adapter and shared source poller.
- Reused and extended the existing Cycle 11 composed-browser harness and existing UX gate instead of creating another harness/workflow.
- Repository inspection found the critical dependency first: Vector's current Docker composition loaded only `vector-shell.js`; the validated Cycle 11/12 governed action primitives were present on the branch but not composed into the served Vector runtime.
- Vector Home also deliberately hides `.vector-home-source`, so a newly composed queue would still have been invisible unless projected into the approved Vector hierarchy.

## Research delta
No external competitor/general UX research was repeated. The unresolved question was implementation/runtime composition and could be answered directly from current repository evidence.

## Hypothesis
If the already-validated Cycle 11/12 governed priority primitives are composed beneath Vector and the single existing queue DOM is projected into the visible Vector Home, managers should receive the intended exception-first experience without a second renderer, duplicate cards, copied business logic or a return-context fork.

## Exact implementation delta
- Added `vector-priority-bridge.js`, a presentation-only projector that moves the existing governed `.ux11-queue` from Vector's hidden source container into one visible `vector-priority-slot`; it does not clone or re-render cards.
- The bridge replaces an older projected queue only when the authoritative source queue re-renders, preventing parallel DOM owners.
- The bridge also clears stale `data-vector-home` state when moving away from Home so the approved Vector home can rebuild correctly on return.
- Added a small Vector-specific CSS containment layer for the shared queue; the Cycle 11 card/evidence grammar remains authoritative.
- Updated Docker composition so Cycle 11 model/UI, Cycle 12 model/UI, their existing CSS, Vector shell and the bridge are served in dependency order. Legacy/retired shells remain unloaded.
- Extended the existing Cycle 11 browser harness with the real Vector shell, Cycle 12 integration adapter, an authoritative `AUTHORIZATION_REQUIRED` integration fixture, Vector projection proof, Integrations round-trip, exact originating focus restoration and 390px containment.
- Updated the existing UX gate to execute on the canonical Vector branch and verify exact served-asset composition; no new CI workflow was created.

## Focused validation / evidence boundary
- New bridge and composition source were added on the canonical Vector branch and GitHub accepted all commits without branch conflict.
- The browser gate now fails unless an Integrations priority is inside the visible Vector priority slot rather than hidden in `.vector-home-source`.
- It also fails unless `Integrations priority → Integrations workflow → Back → exact original Decision Card` succeeds, including a 390px return-focus check.
- The build gate now fails unless Cycle 11 → Cycle 12 → approved Vector → priority bridge are present in served assets in that order while the sealed base runtime hash/server contract remains unchanged.
- Exact workflow/browser execution remains pending until GitHub Actions actually allocates a runner for the changed head; no browser, accessibility or hosted pass is claimed before that evidence exists.

## UX scorecard impact
- Calm by default: improved; the approved Vector dashboard remains the visible shell and reuses one governed priority lane rather than exposing the hidden source UI.
- Dense on demand: preserved; cards retain existing progressive evidence disclosure and only the governed queue is projected.
- Explainability: preserved/improved; source, reason, evidence state and authority remain the same structured Decision Card contract.
- Navigation predictability: materially improved by making the intended Vector priority journey actually reachable and preserving exact return focus.
- Development efficiency: materially improved; no duplicate card renderer, provider adapter, route lifecycle, browser harness or workflow was created.
- Capability preservation: green by design; no server-side calculation, permission, integration credential/write action, payroll/compliance authority or audit ownership moved into presentation.

## Serious-idea decision
**BUILD NOW** — compose and visibly project the existing governed action queue under Vector. Evidence strength: high repository-level implementation evidence. Risk controlled by reusing the single queue DOM and keeping all source writes in owning workflows.

## Still unverified
Actual headless Chromium result on the changed exact head, screen-reader announcement quality, tablet widths, real user first-click/time-on-task/error-rate improvement, and hosted source-bound runtime proof.

## Single next highest-value NEW-UI action
Consume the exact gate result for the new Vector composition once the changed head receives a runner. If browser composition is green, inspect the visible Vector priority hierarchy at tablet width and then bind the next authoritative source only where freshness/authority is already structured. If CI again fails before execution with the known zero-step signature, do not retry repeatedly; advance the next non-blocked Vector-only validation/design dependency instead.

---

# Cycle 12 r7 validation update — browser-gate diagnostics

## Journey reviewed
Approved Vector manager Home → governed Integrations priority → Integrations workflow → Back to priority queue → exact originating card focus, including the existing 390px mobile return-focus check.

## NEW-UI lineage confirmation
Validation and code changes remained exclusively on `feature/one-day-enterprise-implementation-v1`. No legacy/0.6.139 presentation code, customer-proof runtime, staging or production surface was changed.

## Reuse / duplicate-work decision
The existing Cycle 11 browser harness and existing `ux-cycle11-gate.yml` remain the single owners. No second browser harness, workflow, card renderer, route lifecycle or Vector presentation branch was created.

## New evidence
GitHub runner allocation recovered for exact Vector head `c165f2137e554af3bd3acb1b50b2802664ded2cd`. The source/deterministic model step executed and passed the existing Cycle 11/12 signal, provider-route, integration-source, shared-Decision-Card, specialist-return-context and manager queue stress checks. The browser step then timed out after 45 seconds with exit code 124 before emitting journey evidence; the build/composition step was skipped. This is now a browser-harness/interaction diagnostic problem, not the previous zero-runner state.

## Hypothesis
The outer 45-second timeout can hide the actual browser failure because the harness cleanup waits indefinitely for `server.close()` while open browser/CDP sockets may still exist. If cleanup is bounded and retry exhaustion emits a stage/error marker, the next exact-head run should either complete normally or expose the first real failed interaction instead of ending as an opaque timeout.

## Exact implementation delta
Updated only `.github/scripts/ux-cycle11-context-browser.mjs` on the canonical Vector branch. The existing retry helper now emits the final retry error, the harness logs when CDP is ready, and cleanup closes idle/all HTTP connections, bounds the server-close wait to one second, then force-terminates Chrome if required. Product UX, routing rules, provider contracts, permissions, calculations, write authority and audit behavior are unchanged.

## Focused validation / regression state
The implementation commit is `e390a804e2b703527dbdcf534071163514db012d`. GitHub accepted the source update. No workflow run was attached to that exact new head at the first post-commit check, so the revised Chromium journey is not yet claimed green. The previous exact-head deterministic checks remain valid evidence for unchanged model/contracts; the browser journey remains unverified until the new diagnostic harness executes.

## Blockers not retried
The obsolete zero-runner blocker was not retried because its state materially changed: a runner successfully executed the prior gate. The failed 45-second browser job was not blindly re-run unchanged; the harness was first corrected to make the next execution diagnostic and bounded.

## UX scorecard impact
No product-facing score is increased from this cycle alone. Evidence quality and development efficiency improve because future browser failures should expose the failing journey rather than consume a cycle as an opaque timeout. Calm-by-default, density, explainability, permissions and authoritative controls are unchanged.

## Single next highest-value NEW-UI action
Consume the first workflow result for the exact updated head. If the harness now identifies a real Vector interaction/focus defect, patch that bounded defect in the same canonical lineage and rerun only the affected browser gate. If it passes, proceed to the already-planned tablet-width hierarchy/accessibility validation rather than adding new UI.

---

# Cycle 12 r8 validation update — browser roundtrip green

## Exact runtime lineage
The runtime-fix parent is `ff3f241f1cfc6b48fa220a7aaf0a6cc3e32b4b03`. It was promoted to `feature/one-day-enterprise-implementation-v1` only after the isolated fix branch passed the governed browser/build gate, then the feature-branch gate itself passed on GitHub Actions run `35422064672`.

## Browser proof now green
Real headless Chromium exercised the composed candidate and passed all required journey assertions: Vector role-first Home rendered; the governed Cycle 11/12 priority queue was projected out of the hidden source shell; Integrations opened its authoritative destination and returned focus to the exact originating projected priority; Absence, Time Review and Weekly Sign-off opened their correct source scopes and returned correctly; and the 390px mobile journey reported zero horizontal overflow with successful Integrations return focus.

## Defects corrected without authority changes
- Bounded the Vector shell MutationObserver during shell-owned DOM writes to prevent recursive render churn.
- Preserved Cycle 12 external priorities when Cycle 11 rerenders the queue.
- Retained return context across queue replacement and restored focus only at the visible projected Vector boundary.
- No server write authority, provider credential boundary, payroll/compliance authority, tenant boundary, security control or sell-readiness flag was weakened.

## Regression evidence
The same gate completed the exact Docker composition build after browser execution. The built image retained the previously established strict T0–T4 autonomy admission and full 66-test runtime regression, including the 10,000-employee / 50-site scale harness and independent payroll zero-unexplained-variance gate. Provider fixtures remain fixtures and the one-day implementation timing model remains synthetic; neither is promoted to live/customer proof by this browser result.

## Evidence boundary
This clears the deterministic composed-browser regression blocker. It does not yet constitute an authenticated role journey against the deployed Railway origin, an authenticated external-provider sandbox connection, or a real zero-human customer provisioning event. Those remain separate sell-readiness gates.

---

# Cycle 12 r9 validation update — tablet return context

## Journey reviewed
Approved Vector manager Home → governed Integrations priority → Integrations workflow → Back to priority queue → exact originating Decision Card at desktop, 768×1024 tablet and 390×844 mobile widths.

## NEW-UI lineage confirmation
All research-free validation, test extension and product fixes remained exclusively on `feature/one-day-enterprise-implementation-v1`, the canonical approved Vector NEW-UI lineage. No legacy/0.6.139 UI, superseded presentation branch, customer-proof runtime, staging or production environment was mutated.

## Reuse / duplicate-work decision
The existing Cycle 11 browser harness, Universal Action Queue, shared return marker, `focusNode` helper, Vector projection bridge and existing governed-priority workflow remained the single owners. Tablet validation was added as another parameter to the existing responsive browser routine; no tablet-only harness, navigation lifecycle, focus helper, renderer, branch or workflow was created.

## Research delta
No competitor or generic UX research was repeated. The unresolved question was measurable responsive return-context behavior and was answerable directly from the current implementation and browser gate.

## Hypothesis
At tablet width the governed Vector queue should have zero page-wide horizontal overflow, remain contained and operable, and a manager returning from an owning workflow should regain exact keyboard focus on the originating priority with that focused control visibly inside the viewport.

## Finding and exact implementation delta
The new 768×1024 check found a real defect: the exact Integrations button regained keyboard focus but remained outside the viewport after return. Investigation found two overlapping focus loops: Cycle 11 owned generic return focus while the Vector bridge separately re-focused projected content. The fix generalized the existing Cycle 11 `focusNode` primitive with optional scroll behavior/delay, reused that same primitive from both Cycle 11 and the Vector bridge, and retained the bridge's captured return context through the projection-settle window before clearing it. No business rule, evidence classification, permission, payroll/compliance calculation, source write authority or audit behavior changed.

## Focused and affected regression evidence
Exact-head GitHub Actions run `35423347730` completed successfully. All existing Cycle 11/12 deterministic contract checks passed, including signal governance, provider-route binding, integration-source binding, shared Decision Card reuse, specialist return context, model stress and human/automation separation. Real headless Chromium then reported: tablet overflow `0`, four projected actions, queue contained, Integrations action height `36`, not aria-hidden, and return focus `integrations` with `inViewport:true`; the 390×844 mobile run reported the same zero-overflow/contained/exact-visible-return result. Desktop Integrations, Absence, Time Review and Weekly Sign-off round trips remained green. The same run also passed Vector governed-priority asset composition and confirmed the sealed base runtime/server contract was unchanged.

## Blockers not retried
The prior zero-runner state was not retried after runner allocation had already recovered. Once the tablet defect was reproduced, work stayed on that bounded failure instead of re-running unrelated broad suites or repeating research.

## UX scorecard impact
Responsive containment and keyboard return-context evidence are now green for desktop, tablet and mobile in the composed browser harness. Navigation predictability and accessibility evidence improve because exact restored focus is now also visibly located for the user. No real-user time-on-task or first-click improvement is claimed from synthetic browser evidence alone.

## Still unverified
Screen-reader announcement quality with real assistive technology, authenticated role behavior against the deployed hosted origin, real user first-click/time-on-task/error-rate performance, authenticated external-provider sandbox behavior, and Cycle 10's separate source-bound hosted promotion proof remain unverified.

## Single next highest-value NEW-UI action
Validate screen-reader/semantic lifecycle behavior for the shared Vector priority lane — especially Action required → Confirming source → Resolved and the collapsed Handled automatically receipts — by extending the existing accessibility/browser evidence rather than adding a new interaction or presentation layer.
