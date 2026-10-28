# Existing VECTOR signed-browser runner preparation

Prepared for review, **not activated or deployed**. Existing PR501 owner `/root`; bounded preparation task `/root/help_runtime`. The four canonical bundled proof scripts are sourced from remotely verified `ca05f1017c1e10f9b164c58a044d2cd4159d4ea3`. `SOURCE`, `runnerSource` and the `VECTOR_PROOF_RUNNER_SOURCE` log identify those four scripts, not the refreshed launcher itself. The launcher and embedded bundle are identified separately by `generated/manifest.json` → `startCommandSha256`. The four canonical proof scripts have the same SHA256 values as the earlier packet and are bundled without edits. This update creates no service or release lane.

The currently intended, reviewed application target is also `ca05f1017c1e10f9b164c58a044d2cd4159d4ea3`; that is **not a serving claim**. At preparation, the integration owner's latest deployment observation still identified source `7fa8…`. Reconcile actual deployment and source before activation. A documentation successor does not automatically move the application target or runner configuration.

Preserve project `43367a88-2233-4c6b-9018-0ce234dd73ca`, environment `eed9f097-610a-416e-83b9-6bc7bdb3eeef`, runner service `f84fe27d-af17-451c-b164-54dfef6b6a4b`, target service `48ee3ceb-9cfc-4399-b3a1-3628e3603815`, target URL `https://vector-hardening-proof-production.up.railway.app/` and image `mcr.microsoft.com/playwright:v1.63.0-noble`. Do not run the obsolete inline proof children alongside the canonical server.

## Two separate bindings

`SOURCE` and the four pinned file hashes establish which reviewed runner code is executing. `WFM_EXPECTED_CANDIDATE_SHA` identifies the exact application deployment that code is permitted to examine. They are different facts: updating runner preparation or documentation must not silently select a new product release. The earlier equality check incorrectly coupled them and retained stale `4ed5…` provenance.

The target SHA remains a mandatory, explicit, lowercase 40-hex nonzero value from reviewed deployment configuration. There is no default to `SOURCE`, no discovery from the live response and no automatic rewrite of either value. A correct-looking live response cannot select its own expected target. The canonical client retains its independent deployment, tenant, run, configuration, asset and action-affordance checks.

## Reproduce preparation

From a checkout whose four canonical source files match the verified hashes:

```sh
node docs/execution/proof-runner-activation/prepare.cjs .
node --test docs/execution/proof-runner-activation/launcher.test.cjs docs/execution/proof-runner-activation/preflight.test.cjs
```

The generator validates the four exact source hashes and produces `generated/start-command.txt`, `generated/bundle.json` and `generated/manifest.json`. The shell-quoted command embeds compressed, hash-bound source and no credentials. It materializes files into a private unique directory only after successful preflight.

Before materialization, npm installation, signer-module loading or child-server startup, the launcher makes one unauthenticated GET to `/api/runtime-identity`. It sends no cookie, authorization header or signer data. Redirects are rejected; the complete fetch and streamed body share a five-second deadline and an 8 KiB maximum. HTTP failure, wrong content type, bad JSON, timeout, redirected response, excess size or stream failure stops startup.

The response must match the configured target SHA exactly, `sourceBinding: "build-file-matched"`, `fixtureOnly: true`, `productionApproved: false` and `pilotReady: false`. The target is never replaced with the returned SHA. This early check only establishes a prerequisite; it does not replace later canonical proof or make a readiness claim.

After preflight, installation remains pinned to Playwright 1.63.0, with scripts disabled and a 120-second forced-termination budget. The installer receives a minimal environment for executable paths, home/temp, locale, trusted CA and proxy transport; it receives no proof signer, actors, customer bindings, provider credentials or `NODE_OPTIONS`. Its cache stays in the disposable directory. The proof child retains the frozen, validated runtime environment it requires. Temporary package/source files are removed on completion or failure. Live registry/image compatibility remains unverified by this local preparation.

## Required before activation

1. Reconcile current ownership, saved target configuration and staged changes; use existing approved release controls. Do not revive an old patch ID or bypass a rejected apply. Independently verify startup, non-root UID, durable volume, health and exact serving identity for the reviewed target.
2. Retain the existing protected signer/public-key match, persisted synthetic actors and tenant/run/applied-configuration requirements. Do not export secrets, grant identities manually or change access as part of this preparation. The historical `runner-prerequisites.md` remains a source of the canonical contract, not evidence of present deployment state.
3. Review explicit target/source/deployment/tenant/run/configuration and independently derived asset digests. Signed profile and both strict asset/action flags remain mandatory. Presence checks are not proof of valid credentials or customer readiness.
4. Capture the existing runner configuration for rollback in approved protected storage. Only then review and apply the existing runner's prepared start command through normal controls. No activation was performed by this work.
5. Observe actual browser and source results. `PARTIAL` still means scoped signed authentication/navigation only. `/ready` remains 503 for PARTIAL; whole-product and end-to-end readiness remain false. No change was made to canonical proof-result semantics. Retained, redacted screenshots/traces and genuine provider/customer proof remain separate requirements.

## Evidence and limits

The refresh tests use synthetic identities, local HTTP, fetch stubs and fake npm processes. They verify rejection before materialization/install/child startup, installer environment isolation, malformed and oversized responses, deadlines, source/target separation, unchanged bundle bytes and cleanup. They do not contact Railway, install real packages, activate authentication, read protected secrets, sign production requests or prove a customer environment. Independent review and exact integrated verification are owned by `/root`.
