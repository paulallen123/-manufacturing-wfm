# VECTOR metadata field checks — 1 November 2026

## Result and scope

This increment adds an explicit **Check fields** action to the existing VECTOR Integrations page for NetSuite and SAP SuccessFactors. The server projects profile status to the current authenticated tenant before returning it. The action calls the existing permission-checked, permit-controlled metadata preview endpoint and displays a bounded review summary. Metadata availability does not activate a connector, import records or establish live sync.

The code is an additive child of `cbc5bce85e8a380e89d3b1e670e86a73a50890c2` in the existing draft PR [#569](https://github.com/paulallen123/-manufacturing-wfm/pull/569). The observed canonical owner remains PR [#501](https://github.com/paulallen123/-manufacturing-wfm/pull/501) at `ca6e36b4efd1099b56250fb790943db4b533fee5`. Canonical admission and deployment remain outstanding. The commit containing this handoff binds the included source hashes and evidence; earlier reconciliation receipts retain their original historical scope.

## Source and independent acceptance

[metadata-ui-source-manifest.json](metadata-ui-source-manifest.json) identifies exactly eight source/test paths, their baseline blobs and frozen candidate digests. [metadata-ui-preservation.json](metadata-ui-preservation.json) and [metadata-ui-minimal.patch](metadata-ui-minimal.patch) describe the bounded edits.

The [independent review](independent-review.md) **accepts the exact eight-path increment**. It verified the frozen hashes, baseline bytes, tenant projection, existing status consumers and unchanged preview authority. Removing the metadata panel and its two hooks restores the original shell byte-for-byte. Existing Gusto, Staffology and intake panel bodies are preserved. The composer, Docker and Forge changes likewise preserve their unrelated baseline bytes.

The reviewer reproduced and then verified fixes for two lifecycle issues: an authorization denial retained an earlier profile's fields, and a rejected stale request retained its old panel. The final panel clears cached results/actions on current 401/403 and discards stale successes and failures without disturbing a replacement tenant's panel.

## Verification

All new local verification ran on Node.js **v24.22.1**.

| Check | Result | Evidence |
| --- | ---: | --- |
| Server tenant projection | 5 / 5 cases | Author and coordinator receipts |
| Actual composer page bundle | 13 / 13 cases | Author and coordinator receipts |
| Emitted status, installer and build wiring | 4 / 4 cases | Author and coordinator receipts |
| Existing Gusto, Staffology and intake regression files | 3 passing script entries | Author regression log; coordinator combined run |
| Installed projection helper | 5 / 5 replayed cases | Author receipt |
| Installed six-component Docker assembly bundle | 13 / 13 replayed cases | Author receipt |
| Independent privacy and lifecycle checks | 5 / 5 groups | Independent held-out log |
| Forge command selection | 19 prior commands plus 2 new suites; 6 injected failures rejected | Independent custody/dispatch log |

There are **22 focused source cases** and **18 installed-layout replays**. The coordinator reruns and independent groups are separately identified; repeated executions are not additional source cases. The combined coordinator runner reports six file entries, followed by direct execution that confirms the 5/13/4 case counts.

The [author receipt](metadata-ui-verification.json), [coordinator receipt](coordinator-verification.json), and [independent receipt](independent-review-receipt.json) retain exact commands, exits, hashes and limits. The expected baseline failure is retained in [baseline-red-receipt.json](baseline-red-receipt.json): the original page had no metadata review card despite valid profile status. Earlier fixture/invocation errors and the resolved product failures are classified in the author receipt and their logs.

The positive NetSuite UI case uses the actual hash-bound sealed broker, discovery normalizer and unchanged preview controller block. The controller SHA-256 is `b1712ec63456e24f6aacce13b6c03a47308ba58e3e283c55b928f3eeecb6b91a`. Provider transport, DNS, credentials, permit issuance and browser/DOM delivery are synthetic. SuccessFactors selection follows the same response contract; no live SAP account was queried.

The local installed proof executes the exact metadata composer hook and the actual composer/Docker bundle expressions. It does not run the complete Docker build, final sanitizer or an HTTP listener. The actual Docker build now selects the installed UI test after its final composition and sanitation stages.

### Reproduction

From a complete checkout at the containing commit, run:

```sh
node integration/runtime/provider-metadata-review.test.cjs
node ux-overlay/vector-provider-metadata.test.cjs
node scripts/nango-metadata-wiring.test.cjs
node --test ux-overlay/vector-gusto.test.cjs ux-overlay/vector-staffology-controls.test.cjs ux-overlay/vector-three-min.test.cjs
node evidence/vector-nango-setup-20261031/metadata-ui-20261101/independent-heldouts.cjs /absolute/path/to/checkout
```

The exact archive remains at the existing repository path and is hash checked by the existing test helper. The included `prepare-installed-proof.cjs` accepts explicit checkout and output-directory arguments; in a disposable checkout it can reconstruct the bounded installed layout for the replay commands recorded in the author receipt. It is an evidence driver, not an application entry point.

## Release and account boundary

[release-boundary.json](release-boundary.json) records the expected single parent, branch lease and protected blobs. Publication must use the same donor branch with `force=false`, and preserve the release marker, gate, gate tests, CircleCI configuration, sealed archive, resolver and provider adapter contract. An unchanged first-parent marker does not create release admission. The canonical owner's branch and Railway environment are outside this increment's write set.

Fresh Node 22 image validation, hosted application behavior, real signed-permit lifecycle and live provider access remain outstanding for this increment. The earlier independent Node 22 848-case receipt applies to parent `cbc5bce85e8a380e89d3b1e670e86a73a50890c2`; it is not recertification of this change.

The existing restricted Nango key remains stored in VECTOR's Railway service. Nango has four production definitions and zero authorized connections at the latest dashboard observation, while server metadata bindings remain absent. The increment adds no credential permission, paid service, account authorization or deployment. Provider accounts, trusted bindings, collection authority and canonical release admission are still required for live field checks.
