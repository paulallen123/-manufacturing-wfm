# V113 independent custody review receipt

Reviewer: `/root/v113_custody_peer`, independent author-file read only.
Runtime: Node v22.23.2 (`/workspace/scratch/722aeb5410a4/node-v22.23.2-linux-x64/bin/node`).
Scope: synthetic local decision lifecycle and proof-to-adaptive consumer. No remote refs, live mutation, customer realization, hosted workflow, or financial/provider authority exercised.

## Exact V3 reviewed bytes

| File | SHA256 |
| --- | --- |
| decision-episode.cjs | fe53233646b972fda7dd038429bccd79899fba70d39221f20982c7b1c9d21e84 |
| decision-outcome-proof.cjs | 43607d4f2a1d8d193b0d57649ace435a13d1b9a86b92bab97072d408bde0c102 |
| decision-outcome-proof.test.cjs | c07353a412db74427016ba0a15bac1a83ad927f353c47d907ed0bb4251d2e5f8 |

The exact reviewed source is identified by the hashes above. Independent public-boundary tests are retained here as `independent-heldouts.test.cjs`; raw logs are in `logs.tar.gz`.

## Direct evidence

| Risk | Observed V3 behavior |
| --- | --- |
| Selected actor/option/authority/timestamp/execution flag changed under stale seal | Recording rejects |
| Changed outcome actual/evidence/timestamp under stale digest | Proof rejects |
| Rewritten outcome digest with stale selected actor seal | Proof rejects |
| Recomputed seals with pre-trigger selection or pre-selection observation | Chronology rejects |
| Recomputed selection authority shape inconsistent with mode | Rejects |
| Explicit raw actual string, boolean, arrays, null, NaN, infinity | Recording rejects |
| Omitted metrics and explicit zero | Omitted remains null; numeric zero retains exact measured value |
| Finite operands overflowing predicted/observed improvement or prediction error | Rejects |
| Rehashed nonfinite/inconsistent derived proof arithmetic | Adaptive consumer rejects |
| Nested proxy/accessor inputs | Rejects without invoking hostile traps/getters |
| Nested issued proof and adaptive result mutation | Deeply frozen; stale cloned nested mutation rejects |
| Financial measurement interval | Observation outside interval and empty interval reject |
| Simulation learning | Rejects |
| Legitimate numeric lifecycle after JSON transport | Preserves +200 cost improvement; adaptive verified true and memoryGrantsAuthority false |

## Runs

- Initial donor candidate: `V113_TARGET=.../v113-union-peer/candidate/operations/runtime node --test heldouts.test.cjs` -> 7/31 pass, 24 fail; `donor-heldouts.tap`.
- V2 frozen repair: `node --test heldouts.test.cjs` -> 25/31 pass, 6 fail; `v2-heldouts.tap`.
- V2 ordinary proof tests: `node --test decision-outcome-proof.test.cjs` -> 36/36 pass; `v2-proof.tap`.
- V3 frozen repair: `V113_TARGET=.../v113-custody-peer/v3 node --test heldouts.test.cjs` -> 31/31 pass; `v3-heldouts.tap`.
- V3 ordinary episode+proof tests: `node --test decision-episode.test.cjs decision-outcome-proof.test.cjs` -> 47/47 pass (5 episode + 42 proof); `v3-source.tap`.

The V2 fail-first finding was reproduced through a real synthetic lifecycle: raw actual `'320'`, true, false, [], [320] were coerced to 320, 1, 0, 0, 320 and could produce verified financial proof/adaptive learning. Explicit null stored null and the proof correctly rejected it; its intake failure was stricter validation, not a verified-proof bypass. V3 rejects all six at recording while retaining legitimate zero and omission behavior.

## Verdict and limits

PASS for the reviewed local integrity/finite-actual/chronology/immutable-data contract. No surviving tested stale-seal, TOCTOU, derived-overflow, malformed-actual, nested-mutation, or chronology bypass was found in the exact V3 bytes.

The checksums are public and unkeyed. An actorRef replacement with a fully recomputed selection checksum is accepted; this is a directly tested limit, not protected human authentication or authorization. Caller-asserted evidence references and checksums do not prove an authoritative provider, finance/customer realization, hosted CI, signed human approval, or live deployment. Root retains final affected-suite and publication decisions.
