# Canonical policy reconciliation preparation

This isolated canonical-target candidate preserves the complete linear #537 → #539 → #540 stack exactly once, then carries the complete reviewed #436/#541 policy delta. It repairs the explicit-tenant advisory-policy boundary while retaining the workforce-population, recursive-provenance, source-registry and confidence guards from the policy donor stack. No owner branch moved and no canonical adoption is asserted.

## Exact lineage and overlap decisions

- Canonical PR501: `61718e1862fa650136e1952f622c9d8dd4c22af8`.
- Inherited #537 `521affbc019fb2ef48b1e3740401613b16bf408a`, then #539 `dae48f82680635f6b5e94995ac2dc2a543c2f1b4`, then direct parent #540 `57907609bca28aa0401298db3089cb49bf1beb0f`, tree `4f007281eca1b080a7884165e1a6fc8775730ab3`. GitHub comparison reports ahead3/behind0 to canonical.
- Policy donor #541 `fe60c47a6c5cd9aa84a8103a7b0722ab87e90fd9` on #436 `c92d1321f1f88c6300b8600522dca06a078a9f7c`. Its country-pack module and test already equal parent #540 and are untouched. Eight other policy files and the new tenant test supply the complete nine-path delta. The older canonical-only V026 patch `73070fbb…` is not additionally applied.
- Fresh remote tree readback matched all 1,694 parent blobs and modes in the local reconstruction. Exactly ten existing source paths change and one focused test is added; every other parent blob/mode is retained. The source inventory records all old/new blobs. No donor workflow configuration is copied.
- Eight donor policy files had one redundant terminal newline each. Only that EOF byte was removed in each file; all other donor bytes match. `preservation.json` checks exact PR385 workforce admission and PR395 deepFreeze blocks/return calls, plus normalized donor equality. An initial exact-byte preservation script rejected the EOF-normalized files and supplies no accepted proof. Donor branches remain unchanged.
- Ordinary Forge and the existing Docker source policy command now explicitly select the V026 regression. The selector was absent in both parent commands. All prior selectors remain. Docker line endings retain the existing CRLF convention: default git diff-check reports that CR as trailing whitespace on the touched line; `git -c core.whitespace=cr-at-eol diff --check` passes. Policy EOF warnings are eliminated.

## Policy paths and selectors

| Policy path | Preserved donor behavior |
| --- | --- |
| `policy/runtime/authoritative-policy-source-registry.cjs` | Private allowlists, finite freshness, calendar and observation guards |
| `policy/runtime/authoritative-policy-source-registry.test.cjs` | Complete existing source-registry regressions |
| `policy/runtime/global-site-policy-preflight.cjs` | Workforce population validation plus exact tenant forwarding |
| `policy/runtime/global-site-policy-preflight.test.cjs` | Complete workforce population regressions |
| `policy/runtime/jurisdiction-policy-graph.cjs` | Recursive freezing plus explicit tenant scope validation/matching |
| `policy/runtime/jurisdiction-policy-graph.test.cjs` | Complete graph provenance and bitemporal regressions |
| `policy/runtime/regulatory-change-candidate.cjs` | Inert published candidate fields and confidence validation |
| `policy/runtime/regulatory-change-candidate.test.cjs` | Complete candidate mutation/confidence regressions |
| `policy/runtime/v026-tenant-policy-scope.test.cjs` | Nine focused tenant-scope/preflight regressions |

The only other source paths changed are `scripts/run-forge-ci.mjs` and `Dockerfile`, each adding this new focused test to its existing policy command. Parent binary blobs are inherited directly from the exact base Git tree and are not decoded/recreated. The original #540 freeze marker and CircleCI configuration retain exact bytes/modes. The new source SHA has no transferred CI or image success.

## Fresh local evidence

All runs use Node22.23.2. Suites overlap; totals are not additive.

| Check | Result |
| --- | --- |
| Exact parent tenant-isolation heldouts | 3/15 pass, 12 intended failures, exit1 |
| Exact fetched policy donor before EOF cleanup | 94/94, zero skips, exit0 |
| Final ordinary `node scripts/run-forge-ci.mjs` | 16/16 commands; 299/299 TAP, zero skips, exit0; all94 policy tests included |
| Final inherited frozen-admission/recovery/Docker-contract/V014/V088 selection | 45/45, zero skips, exit0 |
| Final independently authored tenant and donor-guard fixtures | 24/24, zero skips, exit0 |

The full-source run used local-only `TAR_OPTIONS=--no-same-owner` for archive extraction. It ran in a separate source copy; generated proof JSON, caches and runtime output were excluded from the publish tree. Test logs/commands and SHA-256 receipts are retained here. The failing baseline TAP and exact source patch are stored as deterministic lossless `.gz` files so raw diagnostic/context whitespace does not affect source hygiene; decompressed digests are recorded in `compressed-evidence.json`. Independently authored fixtures were re-executed by the reconciliation worker; this is not a new independent-agent source review or formal GitHub approval.

Reproduce the ordinary command using Node22.23.2. For retained heldouts, set `V026_SOURCE_ROOT` to this checkout and `V026_BASE_ROOT` to exact #436 policy source, then run `node --test docs/execution/vector-canonical-policy-reconcile-20261030/independent-*.test.cjs`. Tests use synthetic structured inputs; tenant fields do not authenticate policy or grant operational authority.

## Gate and ownership boundaries

Fresh GitHub readback confirms all three CircleCI contexts SUCCESS only on inherited #540 `57907609…` (jobs1228/1229/1230). Full hosted logs/artifacts and a complete exact-image receipt remain unavailable. Those statuses and historical donor image receipts do not transfer to this changed source. Neither #540 nor #541 has formal approval in the inspected state; canonical reviews are COMMENTED.

The frozen marker and CI configuration are unchanged. This successor is not newly frozen: ordinary source validation is eligible, frozen core is expected to reject the unchanged marker, and the chosen integration branch is outside the existing runtime filter. The owner must review the actual new source and intentionally renew the existing frozen proof path before exact image/security/recovery admission. No filter expansion, bypass, or inferred image success is introduced.

V005 preflight, corrected V023 Staffology lifecycle, V086 assembly, V080 UI and other accepted backlog remain separate owner work; their disposable union evidence is not silently included or promoted. PR501 remains the sole canonical integration/release owner. Formal review, exact clean build/image/archive/security/recovery, approved policy/site bindings, trusted authenticated consumers, durable intended-role hosted readback, applicable provider proof and customer acceptance remain open. No merge, Railway/customer/provider deployment, policy/tenant/personnel/provider mutation or readiness claim is made.
