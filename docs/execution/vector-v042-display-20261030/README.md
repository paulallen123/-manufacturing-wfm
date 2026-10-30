# V042 — preserve unknown leave balances in the employee display

When Personal returns a missing or unknown balance, the employee leave screen currently converts it to 0.0 hours. This display-only repair shows **Not verified**, preserves genuine numeric zero, and renders an escaped needs-review source note using the existing amber warning style.

## Scope and exact source

This isolated donor is based directly on #501 `61718e1862fa650136e1952f622c9d8dd4c22af8`, tree `3b7c62f3903f6b778afaa89fef8ccd568051733d`. The only existing production file changed is `ux-overlay/vector-workflows.js`; the added `ux-overlay/vector-leave-balance-display.test.cjs` is a standalone Node test with no third-party dependencies.

Workflow baseline: Git blob `6001bfafc1fd226c753402a4282b83e617ccc61c`, SHA256 `fe6174224ad4213fc0220579b2d1bdda6371a8e03f2cb58251b6568610bb11e2`.
Workflow donor: Git blob `a109ef3e0bb0b01b2800e8273a4b5e427e04fed6`, SHA256 `7540abc8b0efc30443ebbf595a3ced9780d38e9fd389c7bacf40702942d18e88`.

The change adds finite primitive number formatting and one review-note expression in leavePage. Request/approval handlers, authenticated readback, backend, entitlement, carryover and policies are unchanged. Existing #220/#271 domain owners and sole #501 canonical integration/release owner retain control. This draft does not change #501, frozen #552 `7ced0fe91742928235fe3be042766eec2911ed90`, the staged wave, an archive or a live tenant.

## Provenance and independent review

The isolated transplant reuses the exact [initial display patch](https://github.com/paulallen123/-manufacturing-wfm/pull/501#issuecomment-6517058374), SHA256 `295c47246da4e7c809eac2567014f46b9bcf27c502f77604bbab226d894b28ad`, followed by the [amber patch](https://github.com/paulallen123/-manufacturing-wfm/pull/501#issuecomment-6517343817), SHA256 `9bf4ed1051e41ceff37d8265634f163df500e5d42d99444786b443f971dffcfd`. Both apply cleanly directly to the original workflow with context offsets. leaveAmount is self-contained; LF.personal, escape, leavePage and vw-warning CSS already exist. No reference to the queued V068/V071/V039/period-guard handlers is introduced.

The historical full-chain successor SHA256 `71b785e8f04703be3be9ed15fbdcf9b4ad9046dd567a702a75c9d24627c92953` is a different source identity. Its reported whole-source Git blob returned404 during reconciliation. This donor is reconstructed from the published patch blocks and has its own exact identity; prior browser/image counts do not transfer.

The regression comes from the same amber handoff's published adversary SHA256 `6614a4bc22f2cfb9f8808da051cc6daf65e061bf783feec543749eb999b40296`. Only its source-discovery prelude is adapted: a normal invocation loads colocated production source, and optional V042_WORKFLOW/V042_WORKFLOW_SHA inputs support pinned fail-first checks. All behavioral assertions remain unchanged. Assertions exercise actual workflow public output through a VM with fictional personal responses; NaN/Infinity are deliberate mock adversaries, not JSON backend claims.

The coordinator reviewed the source diff and reported independent xhigh peer **ACCEPT**: Node22 independent13/13, published adversary2/8→8/8 and affected51/51, with source/comment provenance checked and no material supported-JSON defect found. Raw peer artifacts were not supplied, so those are reported review results, not attached execution receipts. The donor's own final logs are attached below.

## Fresh final checks on Node v22.23.2

| Check | Outcome | Attached receipt |
|---|---|---|
| Syntax of final workflow | exit0 | syntax-node22.log |
| Packaged adversary against exact #501 baseline | exit1,2pass/6fail,0skip | baseline-node22.tap |
| Packaged adversary against final donor workflow | exit0,8/8,0skip | candidate-node22.tap |
| Existing workflow/action-queue tests on frozen #552 plus display donor | exit0,51/51,0skip | frozen552-compatibility-node22.tap |

The51-test result is **frozen #552 local source compatibility**, not a full exact #501 runtime or image check. The test files were independently fetched from #501 (blobs `5d8ec2ca2e40603ed6ee9156e3b0e6491d56d930` and `c83b7ff79979972789c30fd01b28d8f4ad986f9f`) and match frozen #552; the broader runtime dependencies differ. The proof fixture used a previously prepared dependency cache with byte-identical declared package-lock SHA256 `8a21dada89673eb721a2200c4e64444b4d583a7df5df5d0add52d3ca2546229d`; no network install. Cache/lock checks are not new registry authenticity proof. Logs retain the runtime's experimental proxy/SQLite warnings.

From the donor checkout on Node22:
```sh
node --check ux-overlay/vector-workflows.js
node --test ux-overlay/vector-leave-balance-display.test.cjs
```

To repeat fail-first, preserve the baseline file from exact parent61718 in an external temporary path and invoke:
```sh
V042_WORKFLOW=/absolute/path/to/parent-vector-workflows.js V042_WORKFLOW_SHA=fe6174224ad4213fc0220579b2d1bdda6371a8e03f2cb58251b6568610bb11e2 node --test ux-overlay/vector-leave-balance-display.test.cjs
```
The expected fail-first outcome is2/8,exit1. The standalone regression command is documented explicitly; no CI selector, freeze marker or release gate is changed by this donor.

## V042 remains BLOCKED

V042's original scope is entitlement, accrual, carryover and balances. [Earlier reconciliation](https://github.com/paulallen123/-manufacturing-wfm/issues/527#issuecomment-6510774361) already set BLOCKED with research NO/SKIP_REPEAT_RESEARCH. [Same-year local API/SQLite proof](https://github.com/paulallen123/-manufacturing-wfm/pull/501#issuecomment-6515994352) establishes fictional opening/reservation/approval behavior, not complete accrual/carryover or customer correctness.

The unchanged [published year-boundary fixture](https://github.com/paulallen123/-manufacturing-wfm/pull/501#issuecomment-6510766953), SHA256 `67d95c9a112a64119c1f0a0b7ce05b51a8ea6393f7ea6ac041e51be1f5f1e2ee`, freshly reproduced1/3 on Node24: a fictional January2027 request uses a2026-only10-hour opening, stays unreserved in that old budget and can be approved. Its expected refusal depends on the reviewed future-booking/applicable-opening contract; no legal or carryover rule is invented or changed here.

Authoritative effective-dated rules, actual opening balances/source reconciliation, accrual/carryover/expiry, future booking, employee applicability and actor/site authority remain customer/domain-owner gates. Final selected-source acceptance, exact-base Node22/image/security/recovery and authorised intended-role hosted/customer proof remain open. This draft is not customer completion, deployment, provider acceptance or proof of the earlier queued workflow chain.
