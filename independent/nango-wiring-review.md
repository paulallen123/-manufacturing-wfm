# Independent Nango wiring review

**Disposition: ACCEPT for the bounded local proposal.** No remaining blocker was found in the reviewed wiring. This does not attest a full image build, deployment, live connection, provider sync, or payroll delivery.

## Source reviewed

The full composer and Dockerfile were compared with the recorded source at parent `61718e1862fa650136e1952f622c9d8dd4c22af8`. Git blob hashing of the recorded original bytes matched composer `72552d85e6533d732cd229892338b6bb65d6f2a0` and Dockerfile `03ff80449601bd7bbbd8f28a7b6541515f18a4cd`. The proposal adds 13 composer lines and 9 Dockerfile lines, with no removal of prior gates.

| Reviewed file | SHA-256 |
| --- | --- |
| integration/runtime/nango-credential-provider.cjs | `4a9959044cfc350b09b5f163a8032346c9c6d3f6b71836421303e4abab3fa15b` |
| integration/runtime/nango-metadata-broker.test.cjs | `8e13024a5cd37a54715329a8e93282c35bf8b8cf5eeaba441bc58ac578288013` |
| test-support/sealed-nango-broker.cjs | `1194ac817148b8a1d7b57eb726c10e990349f089f3f53347e3dae04cef5a774c` |
| scripts/nango-metadata-wiring.test.cjs | `46ffa06fda7982a26cac8bfb2303f9fde347d071d3374cbd432e046a7734b321` |
| scripts/compose-vector-local-runtime.mjs | `38e45d555be02b16165cc81073c2a70023b31c48f997e5651baaf88e12eeee0d` |
| Dockerfile | `24fa770d439b6455d09f5f1379cf14ecc2c9c5654b7e918a1515b52049d9929a` |

## Findings

- Both the existing-output and fresh-output assembly paths call `composeStaffology`, which invokes `composeNangoMetadata` before writing the assembled server. The new hook requires exactly one import anchor and one broker-construction anchor and rejects drift or repeat application.
- The hook records and copies the new resolver, inserts its import, and supplies the existing broker's `credentialProvider` option. It does not replace broker code, add a transport, or modify the sealed archive.
- The hardened-runtime Docker stage copies the resolver into `/workspace/integration/runtime/` before invoking the composer. Later copies into `/app/integration-runtime/` preserve the added module.
- Installed resolver and broker tests select `/app/integration-runtime` and `/app/lib`. The test staging directory contains test files and the source-check helper, without a sibling resolver that could accidentally satisfy the import. The helper checks the exact sealed broker module hashes.
- The actual emitted constructor expression selects the original environment-reference credential mode when Nango is disabled and the callback credential mode when enabled. The new positive legacy-token test verifies successful collection with the disabled loader, with zero Nango requests.
- The real sealed broker tests retain permit-before-credential ordering, tenant checks, provider-origin binding, pinned DNS, redirect refusal, and rejection of private addresses. A Nango ownership error has no legacy fallback. External Nango, DNS, and provider HTTP boundaries are controlled fakes.

## Fresh verification

Runtime: Node.js `v24.22.1`.

Run from `/workspace/scratch/9c262827f7fd/vector-nango-implementation/`:

```sh
VECTOR_TEST_ARCHIVE=/tmp/vector-nango-audit-archive.tar.gz node scripts/nango-metadata-wiring.test.cjs
VECTOR_TEST_ARCHIVE=/tmp/vector-nango-audit-archive.tar.gz node integration/runtime/nango-metadata-broker.test.cjs
```

Results: wiring **3/3**, real sealed-broker **7/7**, zero skips, exit status 0. Syntax checks also passed for the composer, broker test, and helper. The archive is checked against SHA-256 `3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d` before extraction.

Earlier invocation without `VECTOR_TEST_ARCHIVE` failed with `ENOENT` because this additive proposal directory does not contain the repository's archive at its default path. The explicit archive path above resolved that fixture requirement. No test failure was hidden or converted into a skip.

The unchanged resolver previously passed the separate independent boundary suite, 16/16. That suite was not repeated for this wiring review.

## Limits

This review executed the actual extracted composer hook and emitted broker constructor, with the exact sealed broker. It inspected both full-composer entry paths and Docker instructions. It did not execute the complete composer with every repository dependency, run Docker, or test the image's pinned Node 22 runtime. The parent is separately checking the installed layout. No live account API request, provider connection, credentials access, repository mutation, or deployment was performed by the reviewer.

## Final Docker rebase addendum

**ACCEPT remains applicable after the bounded Docker rebase onto `b26bb6f0fc30e33b6f4c31e05608368a45fd00a4`.** This addendum supersedes the earlier Docker parent and proposed Docker hash above; all other acceptance limits remain unchanged.

The reviewer independently computed the Git blob hash of `rebase-baseline/Dockerfile` as `cc686fecf70258300214c12120f95044619d2029` and the final proposed Dockerfile SHA-256 as `bbca9e5add3135ad49fcff3725e6f992fa767777cbb858d0a0ac4757c2930029`.

A byte-preserving comparison found exactly nine inserted lines and zero removed or replaced lines. Removing exactly those insertions restores the fresh baseline bytes, including line endings. Therefore all new baseline gates are retained unchanged. The three insertion groups are the source test commands, the resolver copy before composition, and the installed test commands with their temporary-file cleanup.

The reviewer also rechecked that the composer SHA-256 remains `38e45d555be02b16165cc81073c2a70023b31c48f997e5651baaf88e12eeee0d` and the resolver SHA-256 remains `4a9959044cfc350b09b5f163a8032346c9c6d3f6b71836421303e4abab3fa15b`.

The author reran the affected wiring suite, with **3/3 passed, zero skips**, recorded in `evidence/final-rebased-wiring.log`; the reviewer read this result. No additional test suite was run during this final preservation review. This is the final review receipt for the frozen proposal.
