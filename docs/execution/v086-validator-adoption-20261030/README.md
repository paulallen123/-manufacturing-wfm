# V086 Staffology assembly validator adoption

The composer emits actor-scoped operation status with its configuration error. The validator still expects the older flat operation status. This proposal adopts the exact independently reviewed one-line correction from [PR292 owner handoff](https://github.com/paulallen123/-manufacturing-wfm/pull/292#issuecomment-6512267605), adds eight regression controls using a freshly composed server and the validator's actual assertion, and selects those controls in existing ordinary Forge and Docker source admission.

The direct base is PR545 at `2d0f4e41e3b0463386b2887f39afa064068f9166`, tree `b6e21c4afa9880c651fe0898235cd4695ce4bfca`. All 1,694 prior PR540 blobs and all 30 PR545 changed/new blobs were verified against GitHub before the isolated rebase. No AGENTS.md is in the source tree. PR292 at `9e6565decaf439fc44f72719c1b473a206684d2d` retains Staffology ownership; PR501 at `61718e1862fa650136e1952f622c9d8dd4c22af8` retains sole canonical integration/release ownership. Their branches and the frozen PR540 are unchanged. Fresh PR/title/source-path and issue527 checks found the earlier validator handoff unadopted and prior work terminal. The separate policy owner confirmed no validator overlap.

## Fresh Node 22.23.2 evidence

- Full validator on exact PR545 source: exit 1 at stale status assertion. The raw local AssertionError contains generated server text, so only its bounded failure reason and SHA256 are retained.
- New regression on PR545: exit 1, **6 pass / 2 fail / 0 skip**. It demonstrates rejection of the current generated report and acceptance of obsolete flat status.
- Same regression with exact correction: exit 0, **8/8**, zero skips. Seven mutations reject absent/wrong/null actor, absent/wrong configuration binding, absent integration status and obsolete flat status. This exercises the source-shape assertion and does not prove runtime authority.
- Full corrected validator: exit 0, `STAFFOLOGY_CANONICAL_ASSEMBLY=PASS`; all existing checks and 15 selected Staffology scripts remain. Nested TAP is captured by the existing validator, so no nested per-test count is claimed.
- Full existing Forge source command: exit 0, **307/307** (5 + 175 + 127), zero skips. The actual Docker source-policy test command, extracted from Dockerfile and executed locally under Node22: exit 0, **116/116**, zero skips. Counts overlap. This is source-command execution, not a Docker build.
- Syntax checks and `git -c core.whitespace=cr-at-eol diff --cached --check` exit 0. Default Git whitespace checking reports the preserved Docker CR as trailing whitespace (exit 2). Removing only the new selector from each admission command reproduces exact PR545 bytes; its V026 selector and Docker CRLF count remain intact.
- Initial test preparation used the absent-output composer mode without installed passkey dependencies (0/8). Preparation was corrected to the extracted-output caller contract used by the validator. That failure is retained separately in the receipt and excluded from behavioral evidence.

Commands using Node22.23.2:

```sh
node --test scripts/validate-staffology-canonical-assembly.test.mjs
TAR_OPTIONS=--no-same-owner node scripts/validate-staffology-canonical-assembly.mjs
TAR_OPTIONS=--no-same-owner node scripts/run-forge-ci.mjs
node --test scripts/validate-staffology-canonical-assembly.test.mjs resilience/research-convergence-theory-simulator.test.cjs policy/runtime/country-policy-pack-registry.test.cjs policy/runtime/jurisdiction-policy-graph.test.cjs policy/runtime/global-site-policy-preflight.test.cjs policy/runtime/authoritative-policy-source-registry.test.cjs policy/runtime/regulatory-change-candidate.test.cjs policy/runtime/v026-tenant-policy-scope.test.cjs security/runtime/runtime-identity.test.cjs
```

`TAR_OPTIONS` was local archive-ownership preparation and is absent from repository runtime/CI configuration. The test explicitly extracts with `tar --no-same-owner`. Existing zero-cost CI invokes the full validator. Its new regression is selected in ordinary Forge and Docker admission; the whole validator command is not duplicated because the new gate composes the actual server and runs the live assertion while Docker already runs the broad Staffology suites.

Compressed logs retain exact raw bytes with hashes in receipt.json. The frozen marker and CircleCI configuration are unchanged: a new commit requires a separately reviewed genuine freeze renewal before full frozen image proof. This draft is not formal approval, owner acceptance or canonical integration. No provider, tenant, image, deployment or live configuration change occurred. Authenticated mapping/paging/freshness/provider evidence, exact image/security/recovery and hosted/customer proof remain open; V086 is not complete.
