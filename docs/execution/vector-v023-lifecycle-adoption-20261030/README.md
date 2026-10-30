# V023/V048: corrected Staffology lifecycle donor on exact PR545

This isolated adoption draft reconciles the complete four-file PR512 lifecycle repair onto PR545 `2d0f4e41e3b0463386b2887f39afa064068f9166`, tree `b6e21c4afa9880c651fe0898235cd4695ce4bfca`. It also includes the two previously independently reviewed missing-status guard expansions and adds their explicit mapper/bridge regression tests. There is no change to PR512, PR535, canonical PR501 or PR545's refs. PR512 retains domain ownership and PR501 retains sole canonical integration/release ownership.

## Observable behavior and scope

The old source discarded provider `hasLeft` and treated any employment end date as Former. The corrected mapper preserves `hasLeft` in revision-bound employment data; the bridge classifies Former from explicit status/leaver evidence, rejects contradictory evidence and retains the existing application-side delete hold. No date-versus-clock inference is added.

An end date with both status and leaver authority absent was still admitted by original PR512. Both existing guards now reject that unresolved case before staging. The new grouped tests cover absent/null bridge evidence, absent/null leaver authority at the mapper, unchanged input records, zero staging callbacks on refusal and retained no-end-date behavior. Exactly four product/test paths change: `integrations/staffology/{canonical-runtime-bridge.cjs,canonical-runtime-bridge.test.cjs,staffology-adapter.cjs,staffology-adapter.test.cjs}`. Relative to PR545: 93 insertions, 4 deletions. The two production files match the prior corrected source hashes from the V023 owner handoff; every other byte of the complete PR512 donor is retained, with two additional tests in its existing test files.

The protected operation profile, principal resolver, one-shot authority, dispatch/UNKNOWN/recovery/readback code, payroll semantics, provider transport, Docker, CI selectors, source seals and freeze marker are unchanged. This lifecycle change creates no approval, readiness or provider activation. The existing delete/application hold is unchanged, including its requirement for a separately reviewed employee-change workflow.

## Explicit unresolved owner decision

Independent coordinator `/root` requested a check of **missing status + explicit `hasLeft:false` + future end date**. A pure mapper/bridge observation confirms that original PR512 and this corrected candidate identically retain the end date and false flag in acquired revision-bound data, produce an upsert, and omit `employment_end_date` from its staged row; the existing application guard allows it. No clock comparison occurs. The receipt is `evidence/missing-status-explicit-false-observation.json`.

This is retained donor behavior, **not accepted live provider semantics or customer policy**. The Staffology owner must decide whether that case should retain current handling, preserve a separate scheduled change or fail closed, using authoritative provider/customer requirements. This draft does not invent that decision or claim complete effective-dated joiner/mover/leaver support. Keep this limitation visible during review; provider/customer acceptance is open.

## Fresh supported-runtime verification

Node22.23.2, same two focused test files throughout:

| Source under test | Result | Meaning |
| --- | --- | --- |
| Exact PR545 modules with donor tests plus new regressions | 56/60, 4 intended failures, exit1 | Reproduces original lifecycle loss and missing-status gaps |
| Original complete PR512 source with same tests | 58/60, 2 intended failures, exit1 | Isolates the missing-status edge in the donor |
| Corrected complete four-file composition | 60/60, 0 fail/skip, exit0 | Focused regression green |
| Full affected Staffology selection, composed local runtime | 335/335, 0 fail/skip, exit0 | 28 test files, including local HTTP/SQLite/restart with replaced provider responses |

The coordinator independently inspected the four-file delta and reran focused 60/60 on Node22.23.2, zero skips. The 335-test runtime result is the author's fresh execution, not an independent rerun or formal release approval. Counts overlap. All four Node syntax checks and the exact four-path `git diff --check` passed.

The verified source index before materialization writes exact tree `b6e21c4a`, matching remote PR545. A separate checkout was used for all changes and generated output. Complete PR512 remote blobs matched local donor bytes. The source-identities receipt records all four before/donor/after Git blobs and SHA256s. The local runtime contains the corrected bridge/adapter bytes and was assembled by the unchanged composer. Passkey dependencies were reused only after matching the declared lock SHA256 `8a21dada89673eb721a2200c4e64444b4d583a7df5df5d0add52d3ca2546229d`; no install or lockfile change. `TAR_OPTIONS=--no-same-owner` is local preparation only.

Full affected command after local composition:

```sh
CANONICAL_SOURCE_DIR="$PWD" WFM_RUNTIME=/private/local-runtime \
STAFFOLOGY_RUNTIME_MODE=full STAFFOLOGY_PRIVATE_EVIDENCE_DIR=/private/synthetic-evidence \
WFM_BUILD_SOURCE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
node --test --test-concurrency=1 integrations/staffology/*.test.cjs integrations/staffology/independent/*.test.cjs scripts/staffology*.test.mjs
```

The all-`a` value is an explicit synthetic fixture binding, not a claimed source commit. Composition provenance records `sourceCommit:null`; the immutable Git donor identifies the reviewed source delta separately. No admitted image was built, no seal was replaced and no prior CI/image status transfers to this draft. The strict HTTP test executes a **simulated** provider POST through its preload, then local persistence/readback; it does not contact Staffology or authorize an actual payroll operation. Private fixture directory contents were not published.

## Ownership, proof limits and next action

Fresh issue527/open-PR/ref checks showed prior V023/V048 workers terminal and no competing lifecycle writer in the visible records. External chats/jobs/leases are not visible; no exclusive external lease is claimed. PR545 explicitly kept corrected V023 separate before this draft. No canonical or donor ref moved.

V023/V048 remain INTEGRATION/review-and-owner-decision pending. V053/V055 remain BLOCKED: no protected grant, actual provider dispatch/acceptance/readback, hosted business action, personnel mutation, deployment, admitted image or customer acceptance is established. The test fixture does not supply operating authority.

Next, PR512/domain owner resolves the explicit-false/missing-status semantic decision and reviews the complete corrected four-file package. The sole integrator reconciles this draft with current PR545/other accepted donors, independently reviews the resulting exact SHA and reruns affected and full image/archive/security/recovery gates. Any source change reopens prior proof. Authorized provider/customer evidence and intended-role durable fresh-login/audit proof remain separate gates.
