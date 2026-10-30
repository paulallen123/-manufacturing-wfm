# Reviewed next-wave source union

This isolated source candidate starts at frozen [#552](https://github.com/paulallen123/-manufacturing-wfm/pull/552) commit `7ced0fe91742928235fe3be042766eec2911ed90`, tree `cb3d255b3786af31d300cba8240d9661c4c2450e`. Its independently reviewed 24-path source snapshot is `8d015d4844f7e40d7a0001bbcee7634c059b1517`. The final commit also adds only this compact evidence packet; every source/test/config blob stays identical to that reviewed snapshot. Canonical #501, frozen #552 and donor refs are unchanged.

| Package | Exact donor commit | Adopted scope |
| --- | --- | --- |
| V095 #543 | `9dc5621cefea5fc5ad82d74afa77eb474e4a91f3` | Assessor and 3 tests, including original #524 inherited test |
| V081 #553 | `9d1490bb000007b6453aba82482357842a54797a` | Reporting UI, lifecycle test and mapping harness |
| Manifest #554 | `1695ed8e1b09a7bc5533f326144a84e892b27d16` | Fixed21-artifact helper/test, mandatory CI step and shared Forge entry |
| V123 repair #557 | `688f7ed12a545d828b9326f6dde5934185b627fa` | Guarded engine/test plus 4 durable-ledger paths, with signed-zero fix |
| V054 #559 | `36a6be67c2fd2d3c8baee782f842d9787e74925f` | Consumed-permit boundary and regression |
| V108 #560 | `7205a8a79e1f926efb1fc73aaae2f8a8ae0a1f18` | Test-only expired-receipt/reopen fixture with real router host schema |
| V113 repair #561 | `a170a894b4958c303e5cc9d3f1a00faa155ace87` | Episode, proof and proof tests with custody/inert-input/chronology guards |

Exact donor evidence remains in those commit-linked PRs; historical evidence blobs are not copied. `source-inventory.json` records all 24 changed source paths, parent/final Git blobs, SHA256, byte length, modes and donor provenance. The only donor data normalizations remove two terminal LF bytes each from inherited `adaptive-intelligence/engine.mjs` and `engine.test.mjs`; code is unchanged. The V113 whitespace fix comes from the donor itself. Docker and Forge are explicit shared selector compositions. No inherited parent path is deleted.

Forge adds exactly 12 test arguments, preserving every prior command/flag/path, including V026/V086/V005/V080/V023. Docker adds 9 source arguments, the V108 test COPY argument and one installed selector line. Each suite runs once per intended context; V054 remains covered by the complete Staffology source glob. The existing lifecycle core/router aliases stay intact. All405 original CRLF and 11 LF-only Docker endings survive; the new installed line adds one CRLF. `selectors-dependencies.json` records effective admission and package decisions.

| Fresh local check on source snapshot `8d015d48` | Result |
| --- | --- |
| Author Node 22 ordinary Forge | 837/837, 16 commands, zero skips |
| Root independent Node 22 ordinary Forge | 837/837, zero skips |
| Exact affected Docker adaptive source command, locally executed | 1196/1196, zero skips |
| Exact Docker policy/manifest source command, locally executed | 155/155, zero skips |
| Declared installed COPY layout: episode/proof/Autopilot/V108 | 115/115, zero skips |
| Fresh full Staffology composition, 29 separate terminal test invocations | 340/340, zero skips |
| Independent combined affected / cross-lane / declared COPY layout | 596/596; 15/15; 115/115, zero skips |

Counts overlap. `combined-receipts.json` preserves exact commands, source tree, log hashes, environment preparation, individual Staffology terminal accounting and independent-review attribution. Compressed logs contain final Forge/COPY output and all 29 Staffology terminal outputs plus the prior incomplete aggregate. The first aggregate exited 0 without a terminal TAP summary; it is not counted as a pass. No source was edited during these checks.

Reproduce Forge with Node 22.23.2 on PATH and `TAR_OPTIONS=--no-same-owner node scripts/run-forge-ci.mjs` (the TAR setting is local archive preparation). Docker source argv are in the combined receipt. Materialize declared `/tmp/wfm-tests` COPY instructions in order, keeping the lifecycle core/router aliases, then invoke the four affected installed suites listed there. This was local layout execution, not a Docker build. Staffology was rebuilt from this exact source with `STAFFOLOGY_RUNTIME_MODE=full`, a disposable private evidence directory and synthetic `WFM_BUILD_SOURCE_SHA` of 40 `a` characters; sourceCommit remains null. Cached passkey dependencies matched the committed lockfile and installed package version/integrity/resolved entries; this does not establish fresh registry provenance. Then run each of the 29 recorded test-file commands against that new runtime. Provider responses are synthetic preload/injected clients.

The frozen marker is byte-identical: blob `b2c6f3fd9535d10d4379b9424558345e5d341a9d`, SHA256 `41e9cc74d4338dbbf22afd86f8c74c15ef342a573e40daa2246c13a50aa7d87c`, 10,974 bytes. The source commit does not renew freeze admission and has no transferred CI success. The previous frozen #552 all-success contexts apply only to `7ced0fe91742928235fe3be042766eec2911ed90`. A separate reviewed marker-only commit is required before new frozen admission; existing proof steps/filters remain mandatory.

V095 has no runtime consumer/COPY. V123 durable storage remains source-only opt-in with no default path, volume or consumer. V054 retains an already-consumed approval before refusing retry; an existing dispatch marker already prevented duplicate dispatch. V108 changes only synthetic test schema/seeds and preserves the real router bridge. Public checksums do not authenticate protected actors, tenants, provider or finance evidence. Manifest output is unsigned, records local image identifiers and fixed artifact hashes, and does not attest test counts, registry digest or hosted readiness. Actual exact-head CI/image/archive/security/recovery/artifact availability, authenticated browser journeys, durable-store custody and customer proof remain open. No merge, deployment, external provider write or release promotion is authorized by this packet.
