# Independent successor combined-consumer proof review

Bounded review-only successor from readiness455 to final470 `e3db198ef59d3d27e2213ee46e854b56843b0a4b`, retaining continuity457 and the unchanged consumer tests. No product source edits, source-owner takeover, external writes, DB/provider use, or CI/jobs started. Historical 455/457 consumer RED receipts and earlier review remain untouched. Sole Continue customer proof integration/release ownership retained.

Fresh independent verification on Node v24.19.0:

```sh
cmp agency-union/test/frontier/agency-work-start-combined-consumer.test.mjs agency-consumer-470/test/frontier/agency-work-start-combined-consumer.test.mjs
node --test agency-consumer-470/test/frontier/*.test.mjs
sha256sum agency-consumer-470/src/frontier/*.mjs agency-consumer-470/test/frontier/*.mjs
git hash-object agency-consumer-470/src/frontier/*.mjs agency-consumer-470/test/frontier/*.mjs
```

Consumer cmp exits0, proving unchanged assertions; selected suite exits0:35/35 pass (continuity11, readiness16, combined consumer8), zero failures/skipped/cancelled/todo. These include positive finite/null coverage controls, insufficient whole-assignment coverage denial, all three previously RED malformed expiries denied before continuity evaluation, both prior overlength defenses, donor malformed/unknown conflict controls, second-read invalidation, compatibility controls and no-write boundaries.

Read-only GitHub fetch at exact470 head independently returns source blob `87d9f2d15d1491036c434ed8dbddbef689e428f3` and readiness test blob `5a5be6c0a92356c076abb070108b623a820c345e`, matching independently recomputed local Git blob hashes. Continuity source/test remain exact457 blobs `1d29f27d3d47babf6e97ba3b3dac1593ea68bb79` / `7a899f99564af45fd9dda237d4f1b5fba2e35556`.

| File | SHA-256 |
| --- | --- |
| src/frontier/agency-work-start-readiness.mjs | 694240e5de319dd22efa72ecb77bb9cd45af5913eb03c44d41b10585719ada62 |
| test/frontier/agency-work-start-readiness.test.mjs | 0f1ffdf4ce173728fe037296df9bf5cf45a2897fe2b16cb58103e04f966dfa9d |
| src/frontier/agency-identity-continuity.mjs | c67f7bfa2b3e6132b2825518bf12fff40eea85ac5ac2580673b95e6d80a7dcbe |
| test/frontier/agency-identity-continuity.test.mjs | 369e54ac4ddf20f1236c10f3ff1639c648d4fde74cf07a3d7ee0c5a27143b8c2 |
| test/frontier/agency-work-start-combined-consumer.test.mjs | 4ae6e1e546bbd97e4c426fe61c48b1742ed974d0350d91463c0e6f0870b9e2b7 |

Unchanged consumer Git blob is `d2ef1b2ef5a044312f91bbb335dcb730344b8bdd`. Fixture uses actual exported adapters and imported evaluator with synthetic query returns. No actual DB type/constraint enforcement, provider provenance authentication, persistence, runtime image, hosted acceptance or customer readiness is established. Historical three failures were preexisting malformed-result normalization under455/457, not introduced length-repair regressions; successor green establishes only the bounded defensive consumer contract with470.

Approve the bounded successor loader pin update and proof harness. Final updated primary loader changes only the two readiness tuples from455 to470; immutable continuity457 pins and all loader logic remain unchanged. Historical fixture’s copied loader retains455 intentionally and is not the successor loader. Reviewed unchanged workflow retains read-only token permission, immutable Actions dependencies, Node22.23.2, fresh temporary fixture preparation, donor-suite and real consumer-suite steps with unsuppressed native failures.

Fresh loader checks:

```sh
python3 agency-union/scripts/prepare-agency-consumer-fixture.py --existing agency-consumer-470
python3 agency-union/scripts/prepare-agency-consumer-fixture.py --existing agency-union
diff -u agency-consumer-470/scripts/prepare-agency-consumer-fixture.py agency-union/scripts/prepare-agency-consumer-fixture.py
```

First command exits0 with four exact pinned blob identities and unchanged consumer hash. Second intentionally checks the old455 fixture and exits1 with `ValueError: Pinned source blob mismatch`. Separate in-memory runpy probes confirm both arbitrary wrong bytes and actual old455 readiness source are rejected by the470 source pin. This checks obsolete-source rejection, not merely a self-consistent manifest. No network loader branch was executed by reviewer; source inspection confirms response metadata plus independent Git blob byte verification before temporary-file writes.

Final primary loader Git blob `b9fd37d92f78efa55c846c4ceef152f703fa0f67`, SHA-256 `40e936ca9f7d9b278d329e5bd931802cfe6e3591cd0863680b31120e72d1b490`. Unchanged workflow Git blob `00a27fa1ccf2442c02ca114f71b6e4e095b39d93`, SHA-256 `c219ae0a80d1b2e89b73b1764921d0756b529cb0c5c67e96a94d8f405bdbfd02`.

Approval concerns the successor proof artifact and observed local35/35 only. No supported Node22/full-image CI, canonical adoption, release, hosted or customer readiness is inferred. Historical RED reports are preserved as evidence for their exact455/457 inputs; they are not relabeled green.
