# Mandatory runtime artifact identity manifest proposal

The current job retains image inspection and proof files in a best-effort always-capture step. Image inspection failure is suppressed there, and no mandatory sanitized identity inventory confirms which evidence files were retained. This separate proposal preserves all existing proof checks and adds a success-only manifest step after capture and before cleanup/artifact storage. It refuses incomplete or inconsistent evidence and emits fixed file hashes, source SHA and local Docker image IDs. It is an unsigned content manifest, not an issuer signature, registry digest or replacement proof gate.

## Exact isolated lineage

Sole source parent: PR552 non-frozen source `8e0251cd659365f236c589895dd76fa6db9b597d`, tree `2767d1b597e5cf90eccf843782fe5dc7e03e3da5`. All 1,728 source blob bytes were verified before isolated edits; local generated proof files were excluded. Frozen PR552 `7ced0fe91742928235fe3be042766eec2911ed90` and canonical PR501 `61718e1862fa650136e1952f622c9d8dd4c22af8` remain untouched. The source owner explicitly retained the frozen frame while this proposal stayed separate.

Four source paths change: `.circleci/config.yml`, `scripts/run-forge-ci.mjs` and the new manifest CLI/test. Deleting only the seven CI insertion lines and one ordinary Forge selector reproduces the exact source-parent bytes. All existing commands, workflows, source-job structures, proof checks, Dockerfile and marker remain. No deployment or new provider operation exists.

The new always-capture line records the running container's resolved image ID. The normal-success manifest step then requires 21 nonempty regular files, refuses symlinks, verifies three exact source files, runtime/container image identity, fixture-only runtime identity and unique headers, exact client Node/source/packaging scope and retained HTTP/nonroot receipts. Its output copies no private JSON, logs, environment or provider/personnel values: only fixed relative paths, byte counts, SHA256 hashes and validated identity fields. `signed`, `registryDigestAttested`, `testCountsVerified`, `providerAuthority` and `hostedCustomerProof` remain false.

## Fresh verification

Node22.23.2: final tests with unchanged CI wiring **14/15, exit1** (mandatory manifest wiring absent); proposal **15/15, exit0**; complete ordinary Forge **16 commands, 460/460** (5+175+280), zero skips. Root independently inspected the proposal and reran **15/15**. Missing/empty files, wrong source/image/headers/identity/client receipts, root UID, symlink paths and replacement output all refuse. Private fixture sentinels never enter the output. Syntax, diff-check, YAML parse and preserved-structure checks pass. CircleCI CLI/schema validation is unavailable because the official CLI is not installed. Counts overlap; these are synthetic artifact fixtures and local source checks, not Docker execution or evidence of a built image.

```sh
node --test scripts/runtime-artifact-manifest.test.mjs
TAR_OPTIONS=--no-same-owner node scripts/run-forge-ci.mjs
node --check scripts/runtime-artifact-manifest.mjs
node --check scripts/runtime-artifact-manifest.test.mjs
git diff --check
```

Local TAR_OPTIONS only handles archive ownership and is absent from CI configuration. Exact compressed logs and hashes are retained in receipt.json.

## Current artifact-access gate and minimal ask

Exact source8e0251 has ordinary CircleCI1269 SUCCESS/core1267 FAILURE and no runtime status. GitHub check-runs and Actions runs for source8e0251 and historical PR54057907609 are zero. Frozen7ced has ordinary1272/core1270 SUCCESS and runtime1271 PENDING at the retained observation; historical PR540 has ordinary1228/core1229/runtime1230 SUCCESS. Statuses are not image contents or digest evidence.

Fresh direct navigation to [historical runtime job1230](https://circleci.com/gh/paulallen123/-manufacturing-wfm/1230) shows CircleCI's expired-session login. No authentication method or credential was selected. There is no connected CircleCI read tool, installed CircleCI/gh/Docker executable ; neither CIRCLE_TOKEN nor CIRCLECI_TOKEN variable is present in this executor. Inspected repository workflows do not supply artifacts for these SHAs; no release/deploy workflow was invoked.

Minimal owner input: authorize an existing CircleCI session or connector with project/job/log/artifact read access to `paulallen123/-manufacturing-wfm`, specifically historical jobs1230/1228/1229 and current1271/1270/1272 after completion. Existing account sign-in can use the secure browser authentication flow; no raw credential is needed in chat. Trigger/write/deploy capability is unnecessary. Retrieve the complete `forge-runtime-proof`, `forge-source-proof` and `ordinary-integration-proof` sets; verify exact source files, build/TAP/security/recovery/identity receipts and local image inspection.

This proposal cannot recover historical PR540 artifacts, alter current frozen proof, or make synthetic fixtures attest a new image. The owner must separately review/adopt the source change, renew a genuine freeze for that resulting SHA and run complete image/security/recovery admission. Formal approval, canonical adoption, actual runtime artifact access, hosted/provider/customer proof and readiness remain open.
