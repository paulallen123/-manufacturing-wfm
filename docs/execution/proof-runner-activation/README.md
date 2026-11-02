# Existing VECTOR signed-browser runner preparation

Prepared for review, **bound to published code and blocked from hosted activation**. PR501 retains canonical integration/release authority. `SOURCE`, `runnerSource` and `sourceCommitBinding` identify immutable commit `0aa1a27a5fef154a63fbb4ad4a82ee3b90e4b36d`. Each of the four declared file hashes was checked against that commit's actual GitHub blob before generation; the pinned files are unchanged. `reviewedBaseSha` retains the historical PR558 parent `76c5f4d32910d6cac6d347cfff9917dd93301ffb` and is not a formal approval of this binding. Exact file, bundle and command hashes bind the regenerated artifacts. The launcher still rejects unpublished, malformed and all-zero source bindings before identity fetch, materialization, SQLite loading, npm or child startup; preparation now rejects an unbound source before reading inputs or writing artifacts. Source-format validation alone is not proof of commit contents, review, activation authority or customer readiness.

This repair selects no application target. The historical ca05 application target is not current release authority or a serving claim. Reconcile the canonical owner's exact reviewed deployment and source before activation. A documentation successor does not move the application target or runner configuration.

Preserve project `43367a88-2233-4c6b-9018-0ce234dd73ca`, environment `eed9f097-610a-416e-83b9-6bc7bdb3eeef`, runner service `f84fe27d-af17-451c-b164-54dfef6b6a4b`, target service `48ee3ceb-9cfc-4399-b3a1-3628e3603815`, target URL `https://vector-hardening-proof-production.up.railway.app/` and image `mcr.microsoft.com/playwright:v1.63.0-noble`. Do not run the obsolete inline proof children alongside the canonical server.

## Two separate bindings

`SOURCE` and the four pinned file hashes identify the published runner-code bytes in this prepared artifact. `WFM_EXPECTED_CANDIDATE_SHA` independently identifies the exact application deployment the code is permitted to examine. Its value remains unset here; updating runner preparation or documentation does not select or approve a product release.

The target SHA remains a mandatory, explicit, lowercase 40-hex nonzero value from reviewed deployment configuration. There is no default to `SOURCE`, no discovery from the live response and no automatic rewrite of either value. A correct-looking live response cannot select its own expected target. The canonical client retains its independent deployment, tenant, run, configuration, asset and action-affordance checks.

## Reproduce preparation

From a checkout whose four canonical source files match the verified hashes:

```sh
node docs/execution/proof-runner-activation/prepare.cjs .
node --test docs/execution/proof-runner-activation/launcher.test.cjs docs/execution/proof-runner-activation/preflight.test.cjs
node --test scripts/current-candidate-role-browser-proof.environment.test.mjs docs/execution/proof-runner-activation/source-binding.test.cjs
```

The generator validates the four exact source hashes and produces `generated/start-command.txt`, `generated/bundle.json` and `generated/manifest.json`. The shell-quoted command embeds compressed, hash-bound source and no credentials. It materializes files into a private unique directory only after successful preflight.

Before materialization, npm installation, signer-module loading or child-server startup, the launcher makes one unauthenticated GET to `/api/runtime-identity`. It sends no cookie, authorization header or signer data. Redirects are rejected; the complete fetch and streamed body share a five-second deadline and an 8 KiB maximum. HTTP failure, wrong content type, bad JSON, timeout, redirected response, excess size or stream failure stops startup.

The response must match the configured target SHA exactly, `sourceBinding: "build-file-matched"`, `fixtureOnly: true`, `productionApproved: false` and `pilotReady: false`. The target is never replaced with the returned SHA. This early check only establishes a prerequisite; it does not replace later canonical proof or make a readiness claim.

After preflight, installation remains pinned to Playwright 1.63.0, with scripts disabled and a 120-second forced-termination budget. The installer receives a minimal environment for executable paths, home/temp, locale, trusted CA and proxy transport; it receives no proof signer, actors, customer bindings, provider credentials or `NODE_OPTIONS`. Its cache stays in the disposable directory. The proof child receives a separate frozen allowlist: explicit signed profile/signer/actor/source/deployment/tenant/run/configuration and strict asset/action bindings, `PORT`, `PLAYWRIGHT_BROWSERS_PATH`, and the same transport settings. It excludes unrelated provider/implementation authority, password/passkey inputs, obsolete inline proof scripts, `NODE_OPTIONS`, `NODE_PATH`, dynamic-loader inputs and unknown variables.

The browser launch has a third explicit environment boundary. Chromium receives only string-valued `PATH`, `HOME`, `TMPDIR`, `TMP`, `TEMP`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ`, `SSL_CERT_FILE`, `SSL_CERT_DIR`, uppercase/lowercase `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` and `NO_PROXY`. It receives no signer, password, actor/tenant/run/source/configuration or asset bindings, Node/loader hooks, provider/worker credentials or unknown variables. The proof Node process retains signing authority for its existing signed assertion contract. These environment projections are not an operating-system sandbox; the operator must review the parent service's protected authority and trusted transport settings. Temporary package/source files are removed on completion or failure. Live registry/image compatibility remains unverified by this local preparation.

## Required before activation

1. Resolve the unpublished source binding through canonical review, regenerate/read back the pinned bundle and start command, and rerun exact integrated image/security/recovery gates. Reconcile current ownership, saved target configuration and staged changes through existing release controls. Independently verify startup, non-root UID, durable volume, health and exact serving identity for the reviewed target.
2. Retain the existing protected signer/public-key match, persisted synthetic actors and tenant/run/applied-configuration requirements. Do not export secrets, grant identities manually or change access as part of this preparation. The historical `runner-prerequisites.md` remains a source of the canonical contract, not evidence of present deployment state.
3. Review explicit target/source/deployment/tenant/run/configuration and independently derived asset digests. Signed profile and both strict asset/action flags remain mandatory. Presence checks are not proof of valid credentials or customer readiness.
4. Capture the existing runner configuration for rollback in approved protected storage. Only then review and apply the existing runner's prepared start command through normal controls. No activation was performed by this work.
5. Observe actual browser and source results. `PARTIAL` still means scoped signed authentication/navigation only. `/ready` remains 503 for PARTIAL; whole-product and end-to-end readiness remain false. No change was made to canonical proof-result semantics. Retained, redacted screenshots/traces and genuine provider/customer proof remain separate requirements.

## Evidence and limits

The browser regression suite uses ephemeral Ed25519 keys and fictional credentials. It executes the runner through the Playwright launch seam, substitutes a local Playwright module there, and inspects a local Node OS child's environment. Existing affected suites use local HTTP/SQLite, fetch stubs and fake npm processes. Downstream launcher tests rebind only an isolated test copy with a fictional source. Negative cases retain unpublished and missing-source rejection; a separate check executes the exact generated published command with an offline identity response and confirms target mismatch stops before materialization or installation. These fixtures are not environment overrides or production bypasses. They do not contact Railway, install real packages, activate authentication, read protected secrets, render Chromium or establish exact Playwright image compatibility. Independent binding/artifact review and integrated image/security/recovery verification remain required before activation.
