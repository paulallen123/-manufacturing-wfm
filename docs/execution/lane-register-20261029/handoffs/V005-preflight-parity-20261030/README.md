# V005: signed-proof preflight/client configuration parity

Original lane: activate the existing signed browser proof runner. This packet removes a concrete offline configuration blocker. V005 remains BLOCKED on protected authorization/bindings and actual signed browser proof. Research decision: NO / SKIP_REPEAT_RESEARCH.

## Change and owner boundary

The current offline preflight can report `CONFIGURATION_VALID` for input that the real `createProofClient` refuses: untrimmed or oversized deployment/tenant/run identifiers, noncanonical signer encoding, malformed actor fields, and coerced non-string digests. It also refuses valid HTTPS origins lacking a trailing slash. The patch aligns that offline gate with the existing client contract. It never logs input values, exchanges a session, or establishes server authorization.

The candidate changes exactly `scripts/proof-access-preflight.cjs` and `scripts/proof-access-preflight.test.cjs`. It adds trimmed bounded binding/actor checks, canonical base64 PKCS8 PEM Ed25519 validation, string-only source/configuration digests, and compatible HTTPS-origin handling. New tests execute the real existing public client factory without importing Playwright or running the browser body. Existing three preflight tests are retained.

This documentation handoff does not modify either live runtime path, Docker/bootstrap/schema/lockfiles, #501, service configuration, signer, actors, tenant data or provider. The existing sole #501 proof/integration/release owner retains adoption and activation. No competing runner/controller or new release lane was created. The independently owned signed-business-journey gap remains separate.

## Exact base and current state

- #501 exact source: `61718e1862fa650136e1952f622c9d8dd4c22af8`.
- Baseline preflight Git blob: `80668b6f9c1e10d97501ca41e50ca59c684778ee`.
- Baseline preflight test Git blob: `d9eded07d6d30f3599afbb7c0adfa024351eacda`.
- Unchanged client Git blob: `b736e153d621daeec4915fbe8627885b6496ff00` (SHA256 `5d5921f54b3e501f70004d324036e3c5fbd336b1f04550cb0ec390434252d903`). All three baselines were fetched from GitHub and local bytes verified against those blob IDs.
- Fresh read-only Railway observation: proof service `48ee3ceb-9cfc-4399-b3a1-3628e3603815`, SUCCESS deployment `c95e7a37-2504-437c-9edb-495178a88935`, source61718, no staged patch. Existing `vector-live-browser-proof` service `f84fe27d-af17-451c-b164-54dfef6b6a4b` remains on SUCCESS wrapper deployment `60f21e99-b8e9-4873-bb1f-5f32ddd37a5c` from 17 October, no staged patch. These are platform/config observations, not a current authenticated browser result. No variable-name inventory was repeated.

## Verification

Primary `/root/proof_runner_unblock`, independent reviewer `/root`; requested Sol xhigh, actual runtime model identifiers not independently exposed. The reviewer read the exact diff and found a digest-type parity edge; the final patch includes that correction and heldouts. No independent browser worker was inferred.

| Check | Environment | Result |
| --- | --- | --- |
| Exact original preflight suite | Node v24.22.1 | exit0, 3/3 pass, zero skips |
| Expanded regression tests against exact original source | Node v24.22.1 | exit1, 3 pass / 8 fail; intended contract drift detected |
| Patch application to separate exact-base directory | `git apply --check`, then `git apply`; applied bytes compared to reviewed candidate | exit0, exact match |
| Expanded tests on freshly applied patch | Node v24.22.1 | exit0, 11/11 pass, zero skips |
| Independent final tests and diff review | Parent reviewer, Node22 | ACCEPT, exit0, 11/11 pass, zero skips; exact patch hash confirmed |

Tests use disposable synthetic Ed25519/EC keys and actors. No protected credential was read or invented. CLI checks use only generated local inputs and confirm field-name-only rejection, exit1 and the offline claim boundary.

Patch SHA256: `e1e9edd28aaf0faa96e434e768ee3d5e40a4b390c8bd432a70e5f59056b5ea2d`. `manifest.json` records candidate and receipt hashes. The final test source/hash is fixed; test-generated private material is never persisted.

## Owner next step

On a disposable checkout of exact61718, apply `v005-preflight-parity.patch` with `git apply --check` then `git apply`, and run `node --test --test-reporter=tap scripts/proof-access-preflight.test.cjs`. The patch does not import or start Playwright.

The existing #501 owner must adopt/review the exact source change and rerun applicable integrated image/security/recovery checks. The protected operator must separately authorize and bind the existing runner to matching current app/run/actor/configuration, retain sandboxed browser evidence, and address the signed mode's zero-business-journey coverage. No runner activation, intended-role hosted session, durable customer workflow, provider acceptance, deployment, product readiness or customer acceptance is established by this packet.
