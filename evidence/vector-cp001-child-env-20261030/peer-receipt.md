# Independent CP-001 proof-child environment review

Verdict: PASS. No blocking or material defect found in the reviewed change.

Reviewed candidate: `/workspace/scratch/2ea1ba0f2164/cp001-proof-unblock-20261030/candidate`, based on canonical #501 source `61718e1862fa650136e1952f622c9d8dd4c22af8` according to the parent-provided verified inputs. Review did not alter the candidate, live configuration, tenants, signer, provider, or customer state.

Independent heldout suite: `heldout.test.cjs`; **10/10 on Node v22.23.2 and 10/10 on Node v24.22.1**. Raw outputs: `heldout-node22.tap`, `heldout-node24.tap`.

The suite runs actual local Node processes at both intercepted installer and proof-child spawn boundaries, using only fictional env values and disposable files. It confirms exact survival of 37 approved proof/browser/transport env keys and exclusion of 247 unapproved keys from a 284-key fixture. Those excluded keys include provider and worker tokens, password/passkey material, Node and loader preloads, obsolete browser eval inputs, unknown credentials, malformed/case variants and Railway metadata. It checks no synthetic private/forbidden sentinels appear in launcher or process output. It also confirms preflight snapshots resist asynchronous input mutation, preflight and installer failures stop subsequent boundaries, child exit codes propagate, signal handlers and temporary source files are cleaned up, and the canonical signed browser client accepts the projected ephemeral Ed25519 key and explicit five-actor scope.

Projection cost was approximately 70–80ms for 25,000 projections against 50,000 unknown env keys in repeated local runs; a Proxy confirms the projection does not enumerate unknown input keys. This is a local microcheck, not a hosted browser performance claim.

Exact source/bundle identity checks passed:

| Artifact | SHA256 |
| --- | --- |
| Compressed four-file proof bundle | `da77ee240dc635f19b29a2d771ff52a856ad98e9ccbe06436e96ac4a63201687` |
| Generated start command including final newline | `a0a95c03001650c011d654f039cdd3c7b9b0ad92cf508fecd25b8872d276ae20` |
| `scripts/current-candidate-role-browser-proof.mjs` | `5d5921f54b3e501f70004d324036e3c5fbd336b1f04550cb0ec390434252d903` |
| `scripts/current-candidate-role-browser-proof-server.mjs` | `9f945ad2e768ad0645b493015f03fd85022e79b5c1f51038dcb485d6191b9e06` |
| `scripts/vector-proof-result.mjs` | `6feddbe9a318eae12f79e0374d0bfa13fdace67fd610a6e26abd6a0c4a09205e` |
| `security/runtime/proof-runner-auth.cjs` | `0701e4d5d01a211bde865dce2256b9892475f95ae27a415a02132700f1d4fa5b` |

`generated/bundle.json` and all four embedded source files are byte-identical to the provided baseline and each embedded file matches the candidate's local source bytes. Bundle provenance remains `ca05f1017c1e10f9b164c58a044d2cd4159d4ea3`. The generated command exactly contains the candidate launcher and the same canonical payload, with the expected manifest length/hash.

Scope limit: tests establish environment minimization and local process-boundary behavior. Package retrieval and Playwright module lookup are replaced with local fixtures; no hosted execution, browser rendering, signer-public-key match, live provider/customer proof, or complete operating-system sandbox claim is made. Trusted allowlisted transport settings retain their intended transport authority.
