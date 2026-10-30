# V113 local lifecycle custody repair

A recorded actual or selected actor could change under an old checksum, active getters could change values after checking, and finite operands could overflow into nonfinite claimed outcomes. The repair snapshots inert own data, checks episode/selection/outcome content seals, validates chronology, freezes full issued graphs, and requires finite primitive actuals and finite derived values at recording, proof issuance and learning consumption.

Direct publication parent is the exact reviewed [PR550 donor](https://github.com/paulallen123/-manufacturing-wfm/pull/550): commit `a1edabf081dde5b5ab4fd9a3b978f18c456fafdd`, tree `2653bcc7b507d334c36f70de437ccef4614b9950`, based on existing [PR335](https://github.com/paulallen123/-manufacturing-wfm/pull/335) at `5c3c5e37f4ae97cb17920e8e64deaa3bc324453d`. Only three source/test paths change, plus this bounded evidence. No AGENTS.md exists in that parent tree. Existing Forge and Docker already select the ordinary proof test entry point and include both runtime modules; no shared selector, Dockerfile or workflow change is introduced.

| Source path | Final Git blob | SHA256 |
| --- | --- | --- |
| operations/runtime/decision-episode.cjs | 7c154b59c161486b99de2dcdc23728f343da5d1a | fe53233646b972fda7dd038429bccd79899fba70d39221f20982c7b1c9d21e84 |
| operations/runtime/decision-outcome-proof.cjs | 0a2af6832cc82932ad5cbcda15cf1d780b0ee301 | 43607d4f2a1d8d193b0d57649ace435a13d1b9a86b92bab97072d408bde0c102 |
| operations/runtime/decision-outcome-proof.test.cjs | d167c036c222a2be785d76dd0db4fee70c3f3271 | c07353a412db74427016ba0a15bac1a83ad927f353c47d907ed0bb4251d2e5f8 |

Selected records now require a matching selectionDigest. Verified proofs require matching issued episode, selection and recorded-outcome checksums. Unbound plain positive fixtures now use the real lifecycle, and stale legacy selected records are refused. Explicitly supplied actual metrics must be finite primitive numbers; strings, booleans, arrays, boxed numbers and explicit null are refused. Omitted metrics and an omitted actual object retain null semantics, explicit numeric zero remains valid, and prediction normalization retains its existing behavior. Equal event timestamps, financial window endpoints, JSON transport, simulation boundaries and learning signs remain covered.

## Evidence contexts

Node22.23.2, zero skips:

| Run | Result | Context |
| --- | --- | --- |
| Ordinary episode and proof tests | 47/47 | Exact repaired modules and parent episode test blob f75dd5bbc3d43fa1035d2718d8acc7b821abcc20 |
| Independent heldouts | 31/31 | Separate reviewer's tests against frozen exact module bytes |
| Operations compatibility | 491/491 | Full frozen PR552 source 7ced0fe91742928235fe3be042766eec2911ed90 with only the three repaired paths overlaid |
| Author heldouts | 33/33 | In-process public-boundary checks |
| Local composed runtime heldouts | 33/33 | Local composition of that PR552 overlay |

These counts overlap. The operations/composition runs are compatibility evidence on the stated overlay, not a full direct-parent image, installed archive or hosted run. Root independently inspected the final identities, reran focused+independent 78/78 and operations 491/491, and approved this bounded draft publication. The independent review and portable heldouts are retained alongside this file. Fail-first donor/V2/release/selection-overflow/provider-actual logs and final logs are in logs.tar.gz; receipt.json records individual hashes and contexts.

```sh
node --test operations/runtime/decision-episode.test.cjs operations/runtime/decision-outcome-proof.test.cjs
V113_TARGET="$PWD/operations/runtime" node --test docs/execution/v113-custody-repair-20261030/independent-heldouts.test.cjs
```

Local compatibility preparation used the existing same-lock security dependency cache and TAR_OPTIONS=--no-same-owner for archive fixture extraction. Neither preparation changes shared CI.

## Open authority and release gates

The checksums are public and unkeyed. A caller who recomputes every checksum can construct a new internally consistent record; they do not establish protected human/provider authentication or authorization. Caller-asserted baseline/result/finance references still require authoritative independent custody and actual consumer trust.

V113 remains open for those authority/finance gates, canonical owner reconciliation, formal exact-version image/security/recovery admission, and authorized hosted/customer/provider audit and readback. This draft establishes no realised customer savings, canonical adoption, installed image, merge, deployment, provider/tenant write or customer-complete state. PR335/PR550 remain owner/donor records; the sole integrator controls shared source. No PR552, PR501 or live state is changed by this publication.
