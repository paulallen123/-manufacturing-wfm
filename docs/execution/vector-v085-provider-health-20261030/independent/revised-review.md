# V085 revised independent review

**PASS** for the final bounded future-evidence, BLOCKED-runtime maintenance refusal, and degraded-runtime signal repair. Both specification and engineering-quality review pass for this changed surface; no unresolved material in-scope finding remains. This supersedes `review.md` for the final candidate bytes.

The frozen target remains `/workspace/scratch/2ea1ba0f2164/v085-proof-health/candidate`. I inspected the additional summary and test changes against the previous reviewed summary, checked their exact bytes, and independently reran the affected evidence on Node v22.23.2. I did not modify the candidate.

| Fresh independent evidence | Result |
| --- | --- |
| Original independent future/blocker/clock/redaction/immutability heldout | 217/217 pass (`revised-heldout.tap`) |
| Six independently asserted stale/latency/retry × expired/uncertain maintenance cases | 6/6 pass (`revised-degradation.tap`) |
| Identical new six cases against the previous reviewed summary | 0/6 pass, six expected failures (`pre-signal-degradation.tap`) |
| Revised owner summary tests against the previous reviewed summary | 11/17 pass, six expected failures (`pre-signal-primary-summary.tap`) |
| Final full owner runtime suite | 113/113 pass (`revised-existing.tap`) |

The old-summary comparison used a separate local reconstruction of the final 29-file tree with only `connection-health-summary.cjs` replaced by the previously reviewed bytes. Those bytes were verified against the prior independent SHA256 `140218a7d3fa2950bc593f47d2c4dcc9074224caf85d2ce00941ca7328674559`. No prior candidate source was inferred from an assertion or recreated by rewriting the algorithm.

For all six repaired cases, independently observed direct runtime `DEGRADED` now remains `signals.runtime:'DEGRADED'`, while overall state stays `DEGRADED` and permitted `canSync:true` continuation is retained. The customer message now mentions the degraded condition and retains the specific expired or uncertain maintenance explanation. Provider signals remain `RETRYING` and `OUTCOME_UNCERTAIN`, respectively. Deep-frozen input and secret-sentinel checks also pass on these cases. The previous false HEALTHY signal finding is resolved for this scope.

The exact final source hashes are:

| Path under `integration/runtime/` | SHA256 |
| --- | --- |
| `connection-proof-gate.cjs` | `4ed09983cf2dcbba21255a79c6b4b38a5a053dced6011bf49568468fc09d62e9` |
| `connection-proof-gate.test.cjs` | `6c006a30b8ea4b0c8b05af9a54b1c6f6cf45e254ef9d4dfad62608cc311145fa` |
| `connection-health-summary.cjs` | `4f8d89bd0c89bd2b23c7ad6da9c338bc7a6e27e35ff4b0667e1a2f39a5c2aefc` |
| `connection-health-summary.test.cjs` | `b27d40e9dff239cb7802649ce41e544f58d6558788109aaf4884597159fe08ef` |

The final 29-file tree still differs from its provided baseline in exactly these four files. Against the first independently reviewed candidate, only summary source and test changed; all other 27 files have identical hashes. `revised-receipt.json` contains the full file manifest and test counts.

Separate remaining limitation, low severity and high confidence: Symbol/BigInt `now` values still throw TypeError in both exported evaluation APIs. This is identical to the previous candidate and supplied baseline and does not yield HEALTHY or `canSync:true`. The numeric Date.now-style clock contract and the previously enumerated malformed ordinary clock cases pass. Do not claim all JavaScript input types return a structured BLOCKED result. Raw observations are retained in `revised-adjacent.json`.

Commands use `/workspace/scratch/722aeb5410a4/node-v22.23.2-linux-x64/bin/node`. Heldout commands use `V085_TEST_ROOT=<target> <node22> --test <heldout.test.cjs-or-degradation.test.cjs>`. Existing suites use `<node22> --test integration/runtime/*.test.cjs` from the candidate root. All tests are local pure-helper checks; no dependencies were installed. No provider call, live tenant operation, protected approval, PR #501 action, commit, push, or deployment occurred. Canonical adoption and live provider/customer behavior remain outside this verdict.
