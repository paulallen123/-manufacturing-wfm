# Independent review: bounded VECTOR F4.6 cash outcome snapshot repair

Reviewed on 2026-10-13 by independent review agent. **Approved for canonical owner review/adoption within the scope below; no blocking findings.** Continue customer proof remains the sole integrator and release owner. This report is synthetic local verification, not deployment or customer proof.

## Exact reviewed identities and scope

Requested upstream base: `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`.

The checkout is a deliberately partial reconstruction, not a full checkout of that base. Initially it had no HEAD. The integrator subsequently created a local baseline from the supplied upstream files. I independently ran `git hash-object` on those supplied files and confirmed the exact requested original Git blob identities:

| Original upstream file | Git blob |
| --- | --- |
| `src/frontier/cash-to-capacity-outcome.mjs` | `9e1ac57a556c1db034102754ef3f1ad639267fc3` |
| `test/frontier/cash-to-capacity-outcome.test.mjs` | `8062ad93b2169afceb8502e34660de76075dd3dd` |

I reviewed the implementation plan, the complete source and test files, and their diff against those original blobs. The source diff adds proxy detection plus plain-data snapshot admission, replacing the initial learning-array check; reconciliation, existing serialized consistency validation, scope/identity rules and aggregation formulas remain unchanged. Diff size: source 35 additions/1 deletion; tests 71 additions.

| Reviewed file | SHA256 |
| --- | --- |
| `src/frontier/cash-to-capacity-outcome.mjs` | `c5382504f675cbb2b43e6114fe45789f5f93ceec41214e80a60540c4f62c2ea9` |
| `test/frontier/cash-to-capacity-outcome.test.mjs` | `5a9f0a0f2c53e0a5aca77b8b5985aefbf369f4f3fc3791ec0307d642d342f2d3` |
| `.github/workflows/cash-capacity-outcome-snapshot.yml` | `ff4a1e648ebdcb8e94c3fed63439ac49c4952c6df69cf1ff1665b61366fdb595` |

These hashes were rechecked after testing and remained unchanged. The report and independent probe file were the only files I wrote, both outside the source checkout. I did not edit implementation/tests, post externally, initiate jobs or builds, or deploy anything.

## Findings by severity

- **Critical: none.**
- **Important/blocking: none.**
- **Minor actionable defects: none found.**

The repair closes the reported validation/calculation race: an accessor returning 500 on validation and 0 on aggregation produces a false zero with the exact original source; the reviewed source rejects it with zero accessor calls. Snapshot admission runs before status, validation or identity reads. Proxy detection precedes reflective operations, including for nested and revoked proxies. Descriptor traversal rejects accessors, symbol/nonenumerable properties, custom prototypes, serializers, overridden iteration, cycles and non-JSON values without invoking their supplied behavior. The detached null-prototype object copies and frozen arrays are the records used throughout validation, duplicate identity checking and means.

Persisted JSON, original frozen reconciler outputs, recursively null-prototype plain objects, recursively reordered keys, frozen root arrays and repeated shared data references remain compatible. Duplicate weighting remains unchanged; mixed tenant/site/legal-entity/currency scope and same-identity source revisions/windows remain rejection boundaries. The trusted reconciler source boundary, evidence-only result, `executionAuthority: false` and absence of execution capability remain unchanged.

Deliberate compatibility limits are consistent with the stated plain persisted JSON contract: class/cross-realm prototypes, sparse arrays, active/hidden metadata, and undefined/nonfinite/function/symbol/bigint values are rejected. Because the entire collection is snapshotted first, such invalid data also rejects a collection containing otherwise skipped non-reconciled rows; ordinary JSON non-reconciled rows still skip normally. This does not authenticate provenance or protect a process whose standard built-ins have already been replaced by hostile code. Those are outside this input-object repair.

## Commands and actual results

Runtime: `command -v node` returned `/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node`; `node --version` returned `v24.19.0`.

From `/workspace/scratch/11d7df70bc11/cash-outcome` unless noted:

| Command | Result |
| --- | --- |
| `node --test test/frontier/cash-to-capacity-outcome.test.mjs` | Exit 0; 54 tests, 54 pass, 0 fail/skipped |
| `node --test test/frontier/cash-to-capacity-{engine,decision,evidence,outcome}.test.mjs` | Exit 0; 69 tests, 69 pass, 0 fail/skipped (includes the 54 outcome tests) |
| `node --check src/frontier/cash-to-capacity-outcome.mjs && node --check test/frontier/cash-to-capacity-outcome.test.mjs` | Exit 0 |
| `git diff --check` | Exit 0; no output |
| `git diff --numstat` | Source `35 1`; tests `71 0` |
| `node --test test/frontier/cash-to-capacity-outcome.test.mjs` from `../upstream` | Exit 0; exact original suite 48 tests, 48 pass, 0 fail/skipped |
| `git hash-object ../upstream/src/frontier/cash-to-capacity-outcome.mjs ../upstream/test/frontier/cash-to-capacity-outcome.test.mjs` | Exact original blob identities shown above |
| `node --test /workspace/scratch/11d7df70bc11/cash-outcome-review-probes.mjs` | Final run exit 0; 16 independent probe groups, 16 pass, 0 fail/skipped |
| `sha256sum src/frontier/cash-to-capacity-outcome.mjs test/frontier/cash-to-capacity-outcome.test.mjs .github/workflows/cash-capacity-outcome-snapshot.yml` | Exact reviewed hashes shown above |

The independent probe file covers nested getters on scope/measurement/prediction/realised/provenance/timing fields; nested proxies and revoked proxies; inherited/custom-prototype accessors and serializers; hidden/symbol serializer getters; nonenumerable array indices and Array-subclass iteration; unsafe scalars and exotic objects; `__proto__`/constructor/toJSON plain-data extras; recursive null prototypes and key reversal; deeply frozen JSON and root arrays; shared object references; Unicode/delimiter scope integrity; revised-source replay conflicts; cross-realm prototype rejection; ordinary skipped JSON rows and malformed roots; a 20,000-level hostile data chain failing closed; and the original-versus-repaired false-zero comparison. Call counters remain zero on the denied active-object cases. The deep-chain probe returns a rejection without leaking a stack-overflow exception; it does not establish resource-exhaustion resistance.

## Workflow review and approval limits

I statically reviewed the new workflow and the supplied existing role gate (`upstream/cash-capacity-role-gate.yml`, independently verified Git blob `dba90fbcc7971343342682e265ba6cbae93961f9`). Checkout/setup-node action pins, Node `22.23.2`, disabled package-manager cache, read-only contents permission, runner/timeout, release-branch restriction and Docker build pattern match that reference. The new workflow scopes automatic PR runs to its own file and the outcome source/test and runs all four cash suites plus syntax checks. It adds no publishing/deployment step or expanded token authority. The supplied canonical Dockerfile already includes the outcome suite in its existing admission tests; its SHA256 is `ec99af59ec60a535efa8295dd81546484e3cf61602cd80104b1b15ab4fba34d8`.

Approval covers the exact source/test hashes above and the new workflow's static configuration for canonical owner adoption. It does **not** certify the complete canonical base tree, supported Node22 execution, hosted workflow success, Docker admission success, built runtime provenance, deployment, source truth, realised customer value or customer acceptance. I did not execute Docker or Node22, and no hosted job was initiated. Existing authoritative owner checks and customer proof remain necessary before any release claim.
