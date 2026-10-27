# Existing VECTOR signed-browser runner activation packet

Prepared and independently reviewed, **not activated**. Existing PR501 owner `/root`; verifier `/root/runner_package_review`. Application target stays at `4ed5eb3668452a0229469b8e1d426e84eea18187`. This packet changes no application source and creates no service or release lane.

Project `43367a88-2233-4c6b-9018-0ce234dd73ca`, environment `eed9f097-610a-416e-83b9-6bc7bdb3eeef`, existing runner service `f84fe27d-af17-451c-b164-54dfef6b6a4b`. Keep its current Playwright image `mcr.microsoft.com/playwright:v1.63.0-noble`; do not enable its obsolete inline proof children alongside the canonical server.

## Reproduce preparation

From a checkout whose four canonical source files still match the pinned hashes:

```sh
node docs/execution/proof-runner-activation/prepare.cjs .
node --test docs/execution/proof-runner-activation/launcher.test.cjs
```

The generator refuses changed source bytes. It writes `generated/start-command.txt`, `generated/bundle.json` and `generated/manifest.json`. The committed command is shell-quoted, contains no credentials, embeds compressed exact source and verifies all four files before writing. It uses a fresh private temporary directory, installs only pinned Playwright1.63.0 with scripts disabled, fails on install/browser mismatch and starts the unchanged canonical server. The npm subprocess has a120-second forced-termination budget. Actual registry install/browser image compatibility is still untested in Railway.

## Apply only after these facts exist

1. Normally apply the separate target-service patch `564dacd1-ce0f-46f0-bc4c-bb5fd2629422`. It now has five changes: four source fields and the previously missing `WFM_CANDIDATE_SHA=4ed5eb3668452a0229469b8e1d426e84eea18187`. Only target service `48ee3ceb-9cfc-4399-b3a1-3628e3603815` is affected. The corrected saved command is `/usr/local/bin/vector-entrypoint.sh node security-runtime/bootstrap.cjs`. Redeploy reuses the old deployment configuration and does not test this correction. Do not bypass the prior rejected apply.
2. Verify actual startup logs show volume ownership and UID-drop markers, healthy application, mounted durable DB and `/api/runtime-identity` reporting exact4ed5, `build-file-matched`, `fixtureOnly:true`, `productionApproved:false`. Neither successful image build nor saved configuration proves this.
3. Enable the existing staging signed-auth route only with a verified public key matching the protected existing private signer. Do not export the signer. Verify the five synthetic persisted users, real implementation run and applied tenant configuration. See `runner-prerequisites.md`. Do not fabricate those values or use manual database grants.
4. Supply the canonical runner inputs: signed profile; five actor mappings; actual expected source/deployment/tenant/run/configuration; independently derived JS/CSS/workflow digests; both strict flags true. The launcher checks target, source and presence; the unchanged client performs semantic and live identity checks. Presence is not evidence.
5. Capture the old runner configuration for rollback in approved protected storage, without copying secrets. Replace only this existing runner's start command with the prepared command through normal approved controls. Review the complete environment patch before applying; do not accidentally commit unrelated changes. Keep `/health` as liveness and `/ready` as truthful readiness. Do not repeatedly launch jobs or change the image to work around missing prerequisites.
6. Observe actual installation, process, browser and source-binding results. `PARTIAL` is successful scoped auth/navigation only; readiness remains503 and business journey flags remain false. Signed screenshots/traces are not yet durably retained; capture/redact those through an approved evidence mechanism before claiming reviewable full browser proof.

## Evidence and limits

Final package review accepted; author+independent17/17, canonical auth/wrapper+launcher49/49 (overlap), separate runtime identity9/9. The initial author12-test run had one assertion mismatch because a deliberately oversized duplicate triggered the decompression bound before file-set validation; corrected fixture, unchanged validation logic, final12/12. Original output retained.

Evidence is under `evidence/vector-runner-preparation-20261027/`. These are synthetic local tests, not live npm installation, hosted browser, provider or customer proof. No paid resource, customer service, credential or provider write was changed. No active deployment or persistent worker exists at this checkpoint.
