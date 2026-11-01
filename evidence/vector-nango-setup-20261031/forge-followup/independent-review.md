# Independent review: Nango suites in ordinary Forge source validation

**Disposition:** No blocking findings within the bounded local selector change.

## Exact candidate reviewed

| Item | Verified value |
| --- | --- |
| Candidate file | `scripts/run-forge-ci.mjs` |
| Candidate Git blob | `116c9248fa89dbebd3e6bb69c74a71c570b4b075` |
| Candidate SHA-256 | `5b9d08f0aef4b347848d8c573403c1e548250e9d89c4cfed912a3b1cc15ba4b3` |
| Baseline Git blob | `f6a262968855f9fdbf55fa1c01b17820d32e9a83` |
| Baseline PR head supplied for this review | PR 569, `fae49a8d2420f97abb4bbf6f9a926431fce442bf` |

The baseline blob identity was independently recomputed from the local baseline file and matches the supplied value. This review did not fetch or independently resolve the remote PR head.

## Findings

The candidate differs from the baseline only by adding these three entries at the start of the `checks` array:

1. `node integration/runtime/nango-credential-provider.test.cjs`
2. `node integration/runtime/nango-metadata-broker.test.cjs`
3. `node scripts/nango-metadata-wiring.test.cjs`

Removing exactly those three lines restores the baseline byte for byte. All 16 prior command definitions, their relative order, the selected Node executable (`process.execPath`), inherited environment and output, failure handling, and final success marker are preserved.

The unchanged `.circleci/config.yml` declares `forge_integration_validation` directly in the workflow. Its ordinary source-validation step uses `set -euo pipefail` and runs `node scripts/run-forge-ci.mjs` through `tee`. It does not invoke `require_frozen_candidate`. Therefore the three new entries are reached by the existing ordinary source-validation pipeline, subject to the dispatcher's existing fail-fast behavior. A failing suite stops later commands and prevents the success marker.

All three target files were inspected and use top-level `node:test` registrations. Their actual execution and assertions are covered separately by the parent task, not by this selector review.

## Focused independent verification

A separate inline Node harness evaluated the actual candidate and baseline dispatcher source in a VM, replacing the child-process import with a controlled `spawnSync` boundary and intercepting `process.exit`. No validation subprocess was launched by this harness. It did not use the existing `evidence/nango-forge-selector-check.cjs` as its oracle.

The check passed with Node `v24.22.1`:

- Exactly 19 candidate commands dispatched on the all-success path, including each of the three required suites once.
- The remaining 16 command dispatches matched the baseline exactly in command, arguments, order, and inherited output; the same environment object was forwarded on every call.
- 57 fault cases passed: nonzero exit status, signal/null status, and spawn error at each of the 19 command positions.
- Each failure stopped subsequent dispatches, preserved the expected failure exit code, and suppressed `VECTOR_FORGE_CORE_CI=PASS`.
- For every prior command, failure behavior was also compared with the corresponding baseline command.
- The ordinary CircleCI workflow invocation and its `pipefail` behavior were checked statically against the unchanged configuration.

The following protected files are byte-identical to their local baseline copies:

| File | SHA-256 |
| --- | --- |
| `.circleci/config.yml` | `e0894c8b425b8c468c7849be83dfdb7a53adcb4d5b6546d4bbeb5bb02b8f8b25` |
| `scripts/require-frozen-candidate.sh` | `d14c6d7b572465ccf09d226bf67117090582a743e5608babf81c6b80acebc6aa` |
| `artifact/vector-proof-freeze.trigger` | `03741b17a8e1b34335423eccbb553a4ef46a222b124933cdd45f6de3003277ab` |

## Limits

This is a local selector review, not a full Forge pipeline or hosted CircleCI result. The focused harness ran under Node `v24.22.1`; the CircleCI configuration pins `v22.23.2`. The parent task owns execution of the three actual Nango suites and existing frozen-gate tests. No deployment, upstream source, pipeline configuration, frozen-candidate gate, or freeze marker was changed by this review.

No CircleCI job logs were available to this review. The exact baseline's freeze marker is unchanged by the candidate. This review makes no diagnosis of the reported live `forge_core_validation` failure and provides no evidence that a hosted CI run has passed.

Only this review receipt was written.
