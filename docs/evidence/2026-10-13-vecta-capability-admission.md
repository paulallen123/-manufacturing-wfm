# Vecta capability-admission seam — bounded handoff

Status: **TESTED locally on Node 24; draft handoff only**. This record does not claim canonical integration, exact-image admission, deployment, hosted proof, or customer readiness.

## Requirement and source

- Backlog row: F2.7, Vecta voice/text authorised operations.
- Primary source: PR #241 and its current-base admission review comment `6136908883`.
- Required boundary: deny a blocked capability before plan persistence; bind an allowed plan to tenant, actor, capability, and readiness revision; recheck the same authority at execution; deny revision drift; keep authority invariant across locale; do not expose or consume raw questionnaire answers.

## Owner and conflict check

- Exact base: `48dce8f697825c8cd5f99b3e5aeea3953647f8c2` (`release/vector-customer-ready-candidate-20260925`).
- Reservation: issue #265 comment `6151527758`.
- Searches covered the current open PR inventory through #455, Vecta/bot/admission branches, focused PR queries, and the current release tree.
- The only Vecta bot implementation remains historical PR #241 / `feature/vector-operations-bot-voice-v1-20260925`; its review blocks direct transplantation.
- No current claimant was found for this helper seam. Continue customer proof retains sole canonical integration, release, deployment, and hosted-proof authority.

## Changed files

- `operations/runtime/vector-operations-capability-admission.cjs`
- `operations/runtime/vector-operations-capability-admission.test.cjs`
- `.github/workflows/vecta-capability-admission-gate.yml`
- `docs/evidence/2026-10-13-vecta-capability-admission.md`

Pre-commit SHA-256 identities for the executable package:

- source: `e8c2b1f69254a56c6fa3e9aeeb78c9eb06e91dbecb4a6968a90539b9fd882f91`
- test: `3ed20503ff2bd0d625ae77f20dac1a94fbb2958ac9b9c5f83de7dc52ed5dd365`
- scoped workflow: `2f07fbdf9e3516d2254ea94f72d3c71f9785b6fafe2d0e6e594cff14b98983a1`

No bot, router, bootstrap, controller, database, Dockerfile, shared release workflow, or canonical branch file is changed.

## Implementation result

The new pure helper:

- accepts only an explicit `VECTOR_CAPABILITY_READINESS_V1` projection;
- rejects undeclared fields, including raw questionnaire material;
- rejects active/accessor-backed and inherited record inputs;
- requires exact tenant, actor, capability, and revision identities without truncation;
- creates no plan binding for BLOCK or undeclared capabilities;
- HMAC-binds admitted plans using a caller-supplied server-held key;
- rechecks scope, HMAC, exact readiness revision, tenant, and current capability state before execution;
- omits locale from authority decisions and bindings;
- returns immutable detached results and performs no persistence, network, provider, payroll, or personnel effect.

## Tests actually run

1. Initial RED: `node --test operations/runtime/vector-operations-capability-admission.test.cjs` failed because the module did not exist (`MODULE_NOT_FOUND`, exit 1).
2. First GREEN: 12/12 passed on Node 24.19.0.
3. HMAC review RED: the added authority-key regression failed; the pre-review implementation accepted no key and the new wrapper field was undeclared (12 failed, 1 passed, exit 1).
4. HMAC GREEN: 13/13 passed on Node 24.19.0.
5. Prototype-pollution RED: polluted inherited `Array.prototype.includes` suppressed duplicate blocking-reason detection (0/1, exit 1).
6. Final local GREEN: 14/14 passed, zero failures/skips/cancellations/todos on Node 24.19.0. Both source and test syntax checks exited 0.

The full repository suite was not run because this execution environment did not contain an authenticated repository checkout. The scoped workflow pins Node 22.23.2; its result must be read from the exact PR head before advancing beyond local TESTED.

## Review and integration state

- Self-review found and repaired the unkeyed-digest weakness with a server-held HMAC contract.
- Adversarial review found and repaired inherited `Array.prototype.includes` dependence in duplicate reason detection.
- Fresh independent review is still required on the exact committed head.
- Canonical owner adoption/wiring is not performed or implied.

## Deployment and proof state

- Canonical integration: **not performed**.
- Exact-image admission: **not run**.
- Deployment/enabling: **not performed**.
- Hosted/customer proof: **not run**.
- Strongest supported state before PR CI/review: **TESTED locally**.

## Remaining risks and next action

- The owner must map an authoritative, revisioned readiness projection into this helper without questionnaire payloads.
- The owner must store admitted bindings server-side, call verification immediately before registered action execution, and keep the existing plan expiry/confirmation/source-readback controls.
- A valid HMAC proves server-key possession and exact binding, not that upstream readiness evidence is truthful.
- Run the scoped Node 22.23.2 workflow and independent exact-head review; then the sole integrator may adopt once, run affected union/full-image gates, deploy through approved controls, and prove BLOCK, ALLOW, revision drift, locale invariance, fresh-login persistence, audit, and authoritative action readback on the exact serving image.
