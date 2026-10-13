# F1.6 truthful readiness remediation — 13 October 2026

## Requirement and source

Accepted backlog row F1.6 and PR #303 review discussion `discussion_r4243119830`: a complete learning population must not be told that population coverage is incomplete merely because certification or required-role evidence is unfinished. The population-specific diagnosis comes from `roleLearningPopulationReady`; `populationAndRoleCoverageReady` remains the combined readiness gate. No launch gate is weakened.

## Ownership and conflict check

The exact canonical base is `release/vector-customer-ready-candidate-20260925@48dce8f697825c8cd5f99b3e5aeea3953647f8c2`, tree `cc8ff3737036dec8fe69a90e0759289661280537`. PR #303 is merged and closed. Focused open-PR searches for F1.6, the readiness fields and the rendered labels found no active claimant; branch search found no label branch. Current readiness diagnostic/proof packages own other files and runners. Reservation: issue #265 comment `6151673323`. Private chats and undisclosed leases cannot be exhaustively observed. The existing canonical integration/release owner remains unchanged.

## Files and implementation

- Changed `implementation/ui/implementation-journey.js`.
- Changed `implementation/ui/implementation-observer.test.cjs`.
- Added this evidence record.

`learningCounts()` now carries separate population-specific and combined readiness values. Population remediation uses only the former. Team-ready presentation and Training-stage completion require both, plus the existing three requirement controls. Contradictory or absent inputs fail closed.

## Tests actually run

TDD RED on Node v24.19.0:

- `node --test implementation/ui/implementation-observer.test.cjs` — 11 passed, 1 failed. The new six-case matrix caught the existing false “Population coverage incomplete” diagnosis.

Final local verification on Node v24.19.0:

- `node --test implementation/ui/implementation-observer.test.cjs` — 12/12 passed; 0 failed/skipped/cancelled/todo.
- `node --test implementation/ui/workspace-setup.test.cjs` — 18/18 passed; 0 failed/skipped/cancelled/todo.
- `node --check implementation/ui/implementation-journey.js` — exit 0.

Final local SHA-256:

- source: `ded4b7c1001bd9eb6dd922d8da140c0068f6fa5dbe3cf6e18df7ce7a0285d33e`
- focused test: `c52950ff2978881befad5f3e37b02a37b7da3197dae7ed952f711767651618ce`

## Review, integration and proof status

Author self-review completed; independent exact-head review is pending. The package is not canonical-integrated, deployed, enabled, hosted-proven or customer-proven. No runner, controller, repository policy, deployment, customer, payroll or personnel state was changed.

## Risks, blockers and next action

This proves deterministic rendering only. It does not prove that the hosted status route emits current, authoritative readiness fields or that refresh/new-login render the same evidence. The sole canonical owner must independently review the exact head, reconcile it with current implementation UI work, run supported combined admission, integrate once, deploy the exact approved candidate through release controls, and execute the retained six cases in an authenticated synthetic browser refresh/new-login journey.
