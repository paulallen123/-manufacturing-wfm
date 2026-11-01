# Nango credential integration proposal

This package adds a server-side Nango credential resolver to VECTOR's existing provider metadata broker for NetSuite and SAP SuccessFactors. It uses the supported runtime composer to install the resolver and supply the broker's existing `credentialProvider` callback. Provider metadata requests continue through the existing direct transport and its origin, DNS and collection-permit checks.

**Status:** implemented and independently reviewed as a source proposal for the existing VECTOR release. It has not been deployed or tested against live provider accounts. Nango account configuration and activation are separate from this source proposal; see [the account setup record](nango-account-setup.md).

## Exact source basis and ownership

The final patch is based on integration PR [#501](https://github.com/paulallen123/-manufacturing-wfm/pull/501), refreshed head `b26bb6f0fc30e33b6f4c31e05608368a45fd00a4`, branch `test/vector-empty-organisation-regression-20261020`. Implementation began on `61718e1862fa650136e1952f622c9d8dd4c22af8`; after the parent task observed the branch advance, the Docker addition was reapplied to the new exact source. The composer and sealed archive were unchanged between these refs.

| Source | Verified Git blob / digest |
| --- | --- |
| `scripts/compose-vector-local-runtime.mjs` original | Git blob `72552d85e6533d732cd229892338b6bb65d6f2a0` |
| `Dockerfile` refreshed original | Git blob `cc686fecf70258300214c12120f95044619d2029` |
| `artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz` | Git blob `0c8bb0251d207ec0af0808dd2627360a946a2cb3`; SHA-256 `3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d` |

The archive is unchanged. Tests extract and verify that exact archive; the supported hook modifies an extracted runtime only. The original source bytes are identifiable by the Git blobs above. `evidence/vector-nango-setup-20261031/Dockerfile-rebase.json` records that removing only the nine added Nango lines restores the complete refreshed Dockerfile byte for byte. All of the new parent revision's build gates are preserved.

The canonical release base observed during the audit was `release/vector-customer-ready-candidate-20260925` at `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`. PR #501 remains its existing integration owner. Provider helper PR [#142](https://github.com/paulallen123/-manufacturing-wfm/pull/142) was open/draft at `b9698ec0816ba6286a29af3174987bc77a9602c3`; its newest visible comment was a terminal #556 handoff. These observations do not establish the absence of an external writer lease. Neither owner's branch was changed. No applicable `AGENTS.md` was found in the inspected repository trees or workspace ancestry. The existing `docs/execution/STATE.md` and lane register [#527](https://github.com/paulallen123/-manufacturing-wfm/issues/527) remain authoritative for integration sequencing; this package does not supersede them.

## Reviewable source changes

The implementation changes these eight source and test paths:

| Path | Change |
| --- | --- |
| `integration/runtime/nango-credential-provider.cjs` | New resolver and optional metadata-profile loader |
| `integration/runtime/nango-credential-provider.test.cjs` | New focused resolver tests |
| `integration/runtime/nango-metadata-broker.test.cjs` | New tests through the real sealed broker |
| `test-support/sealed-nango-broker.cjs` | Exact archive / installed broker verification helper |
| `scripts/nango-metadata-wiring.test.cjs` | New tests of the actual composer hook and emitted broker constructor |
| `scripts/compose-vector-local-runtime.mjs` | Adds and records the resolver, imports it, supplies the existing broker callback; both current assembly paths call the hook |
| `Dockerfile` | Copies the source before composition; adds source and installed-module checks without removing existing gates |
| `scripts/run-forge-ci.mjs` | Adds the three Nango source suites to ordinary CI validation, preserving all prior checks and failure handling |

`independent/` contains the independent review and held-out suite. `evidence/nango-verify-installed-layout.cjs` is a review driver, not a runtime entry point. Account setup records, technical documentation and test receipts accompany these eight implementation paths.

The exact original broker constructor in the extracted `server.cjs` is:

```js
providerMetadataBroker=PMB.createBroker({profiles:providerMetadataProfiles,permitVerifier:providerCollectionPermitRuntime.verifier,permitProvider:providerCollectionPermitRuntime.permitProvider})
```

The composer supplies one additional option:

```js
credentialProvider:NangoCredentialProvider.createForMetadataProfiles({profiles:providerMetadataProfiles,env:process.env})
```

The hook fails on missing or duplicate source anchors and on repeated application. It does not replace the broker, its provider transport, collection permits, the provider adapter contract, the Gusto authorization flow, or Staffology authority rules.

## Runtime configuration contract

`createForMetadataProfiles` reads two **server-only** environment settings:

- `WFM_NANGO_METADATA_BINDINGS_JSON`: a JSON array of reviewed tenant/profile-to-connection mappings.
- `WFM_NANGO_API_KEY`: a Nango environment API key capable of retrieving connection credentials. After explicit approval of the scope, destination and restricted temporary transfer, the key was stored in the existing customer service's Railway configuration on 1 November 2026. Presence was verified with values redacted; no secret is included in this package.

Absent or empty bindings, including `[]`, return `null` before reading a key and preserve the existing broker environment-token mode. Once nonempty bindings are configured, missing keys or incomplete/mismatched profiles are configuration errors. There is no fallback from an enabled but invalid Nango connection to a legacy token. This makes a partially configured deployment fail closed; do not set the bindings until the complete reviewed configuration is ready.

Every configured metadata profile must have exactly one mapping. This complete-coverage requirement follows from the broker's single callback seam. Mixed Nango and legacy profiles in the same configured broker are not supported by this proposal.

Each mapping has exactly these keys; these values are fictional examples:

```json
[
  {
    "tenant": "example-tenant",
    "profileId": "example-netsuite-metadata",
    "provider": "netsuite",
    "system": "NetSuite",
    "credentialRef": "WFM_BROKER_TOKEN_EXAMPLE_NETSUITE",
    "integrationId": "netsuite",
    "connectionId": "example-nango-connection",
    "expectedConnectionConfig": { "accountId": "1234567_SB1" }
  }
]
```

The tenant, profile, provider, system and credential reference must match the existing server metadata profile. `credentialRef` is the existing opaque profile reference; this loader does not read a provider token under that name. Bindings must come from trusted server provisioning, never from a browser request. Duplicate local profiles and duplicate remote integration/connection pairs are rejected.

The actual Nango connection must have both exact server-provisioned tags:

```json
{
  "vector_tenant_id": "example-tenant",
  "vector_profile_id": "example-netsuite-metadata"
}
```

Those tags are checked in addition to the connection ID, integration ID, provider and provider-specific configuration; they do not replace the existing VECTOR tenant and collection-permit checks.

| VECTOR broker provider | Nango provider | Expected connection configuration | Credential fields |
| --- | --- | --- | --- |
| `netsuite` | `netsuite` | Exact `accountId`, also checked against the VECTOR account and allowed REST origin | `type: "OAUTH2"`, `access_token`, `expires_at` |
| `successfactors` | `sap-success-factors` | Exact `apiServer` hostname and `companyId`; hostname must match the VECTOR allowed origin | `type: "TWO_STEP"`, `token`, `expires_at` |

VECTOR's existing broker uses `successfactors` as its provider key, while the wider integration hub uses `sap-successfactors`; the mapping above is intentional. SAP ERP OData (`sap-odata-oauth2-cc`) and Gusto definitions are outside this resolver's supported provider set. Their definition creation is not an authenticated account connection or a completed product adapter.

## Credential boundary

The resolver calls only:

```text
GET https://api.nango.dev/connections/{connectionId}?provider_config_key={integrationId}&refresh_token=false
```

It accepts only the exact HTTPS origin `https://api.nango.dev`, refuses redirects and an unexpected final response URL, and does not force token refresh. The default request deadline is 10 seconds, including response consumption; declared and streamed responses are limited to 256 KiB. The response must be valid UTF-8 JSON, be the documented bare connection object, match the approved binding, and contain an empty error list.

Provider tokens must have the documented credential type and field. Their expiry must be a real UTC ISO timestamp more than 30 seconds and at most seven days ahead when response parsing finishes. Missing or malformed expiry is rejected; no expiry is invented from `raw.expires_in` or local read time. No token cache, connection enumeration, logs, raw error bodies or secret-bearing exception causes are added. The callback returns only `{accessToken, expiresAt}`.

Nango's connection response does not include an environment identifier. Using the correct production environment key remains a provisioning responsibility; the resolver does not claim to infer that from response fields.

The provider HTTP request still goes directly from VECTOR through the existing broker. The Nango call supplies credentials only, so the broker's direct-origin and DNS evidence remains meaningful. Tests use synthetic transports and do not certify real provider reachability.

## Verification on the final source

Runtime used locally: Node.js `v24.22.1`. Final logs are under `evidence/vector-nango-setup-20261031/`; its `verification-manifest.json` records commands, source hashes and results.

| Check | Result | Scope |
| --- | ---: | --- |
| Focused resolver suite | 64 / 64 | Ownership, tenant/profile/context, token type, expiry, malformed responses, origin/redirect restrictions, deadlines, response limits, sanitized failures, disabled/invalid loader modes |
| Real sealed broker suite | 7 / 7 | NetSuite and SuccessFactors collection; permit-before-credential ordering; no-credential refusal; positive disabled legacy-token collection; wrong tenant/permit; ownership failure without fallback; private-IP refusal |
| Actual composer hook suite | 3 / 3 | Installed bytes, emitted constructor, disabled/enabled modes, drift refusal, both assembly paths and Docker copy/test settings; rerun after the Docker rebase |
| Independent held-out boundary suite | 16 / 16 | Separately authored adversarial credential-boundary cases |
| Hook-installed module replay | 71 / 71 | Repeats the resolver and sealed-broker suites against the module actually copied by the new hook, with exact installed broker hashes |

There are **90 distinct passing test cases** across the authored and independent suites; the additional 71 are a replay against the installed layout. There are no skipped cases. The resolver source and installed module both have SHA-256:

```text
4a9959044cfc350b09b5f163a8032346c9c6d3f6b71836421303e4abab3fa15b
```

Run from a complete repository checkout, which includes the verified archive:

```sh
node integration/runtime/nango-credential-provider.test.cjs
node integration/runtime/nango-metadata-broker.test.cjs
node scripts/nango-metadata-wiring.test.cjs
node independent/nango-boundary-heldout.test.cjs
node evidence/nango-verify-installed-layout.cjs
```

In a complete repository checkout, the broker helper defaults to the existing `artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz` path. The installed-layout driver extracts that hash-bound archive, runs the exact new hook, verifies copied bytes, and points the tests at the installed files. It does not execute the full composer or start the server. All provider and Nango responses are synthetic. The permit verifier in the broker suite is an explicit test fixture, so these tests do not establish a real signed-permit lifecycle.

The independent reviewer accepted the bounded proposal; see `independent/nango-wiring-review.md`. Early fixture preparation failed on a sandbox-disallowed child-process `tar` call, then on unhandled PAX timestamps. The final helper uses no subprocess and verifies the exact archive, its known regular entries and broker hashes. All recorded final runs use the corrected helper. An additive checkout without the repository archive must supply `VECTOR_TEST_ARCHIVE` pointing to the exact verified archive; no second archive is included in this proposal.

## Remaining activation gates

The complete runtime composer, full Docker build, pinned Node 22 image, hosted server, live API use of the key, real Nango response and real provider metadata collection have **not** been verified by this local task. Existing #501 build, independent verification and deployment gates still apply. Existing provider-oracle issues outside this credential seam are not resolved or recertified.

Four production integration definitions were saved under Nango's Free plan, with zero authenticated provider connections and no live sync. The restricted production key's sole stored scope was verified. Following explicit user approval of restricted temporary staging, the Railway connector saved `WFM_NANGO_API_KEY` only to the existing `vector-customer-ready-candidate` service with `skipDeploys=true` and `staged=false`. Fresh read-back reported `exists=true`, `valuesRedacted=true`, and `sealed=false`; this is stored configuration, not proof that the running application uses the key. `WFM_NANGO_METADATA_BINDINGS_JSON` is absent.

The earlier automatic-review rejection and unsuccessful Railway browser alternative are resolved historical transfer obstacles. The main-side temporary file and directory were removed in `finally`; the synchronised browser-side copy was separately deleted afterwards. Both directories were independently verified absent, and the clipboard was verified empty. No secret was displayed, logged or committed. The [account setup record](nango-account-setup.md) and [non-secret installation receipt](../../evidence/vector-nango-setup-20261031/backend-installation-receipt.json) identify the exact destination, write, read-back and cleanup facts.

No deployment was triggered, and the existing proof-service staged patch was unchanged. The customer service's historical latest recorded deployment attempt remained the failed 23 October attempt; this write did not cause a new failure. This source proposal is still unmerged, with canonical admission outstanding. Provider account authorisation, trusted tags and complete bindings, existing collection permits, release review and deployment are still required before enabling the callback and verifying live metadata collection.

## Ordinary CI coverage follow-up

The initial proposal's ordinary integration CI job did not select the new Nango tests. A reviewed three-line addition to `scripts/run-forge-ci.mjs` now selects the resolver, real broker and wiring suites. The 16 existing command definitions and their order are preserved. Fresh local execution passed 64 resolver cases, 7 broker cases, 3 wiring cases and all 11 existing freeze-gate cases on Node 24.22.1. Independent dispatcher review passed 19 command dispatches and 57 injected child-process failures. Exact source and result hashes are recorded in `evidence/vector-nango-setup-20261031/forge-followup/nango-forge-admission-receipt.json`.

The frozen-candidate marker, gate and CircleCI configuration are unchanged. The core CI job on the initial proposal reported failure, while source inspection proves its freeze marker was unchanged; exact failed-job logs were unavailable, so this is not a claim about the observed log message. A successful ordinary integration job does not admit this proposal as a frozen release. The existing canonical owner must review and admit the complete source through the established image/release process.

## Primary API references

- [Nango GET connection API](https://nango.dev/docs/reference/backend/http-api/connections/get): exact endpoint, response object, refresh behavior and credential response.
- [Nango environment API keys](https://nango.dev/docs/reference/backend/http-api/api-keys): environment scope and credential-reading permissions.
- [Nango backend SDK connection credentials](https://nango.dev/docs/reference/backend/backend-sdk/node#get-a-connection-with-credentials): OAuth2 access token and ISO expiry response.
- [Nango provider definitions](https://github.com/NangoHQ/nango/blob/master/packages/providers/providers.yaml): NetSuite and SAP SuccessFactors provider names, account/host/company configuration and two-step token mapping.
- [Nango authentication types](https://github.com/NangoHQ/nango/blob/master/packages/types/lib/auth/api.ts): `OAuth2Credentials`, `TwoStepCredentials` and public Date-to-string conversion.

These external contracts were inspected during this task. Nango master documentation is not a release pin; a real approved connection still needs a bounded end-to-end check before activation.
