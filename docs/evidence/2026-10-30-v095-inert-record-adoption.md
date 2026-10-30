# V095 exact repair adoption candidate

The order-start assessor could validate one value from a changing accessor and return another revision or source hash. This candidate adopts the exact inert-record repair previously reviewed in [PR524 comment 6512290514](https://github.com/paulallen123/-manufacturing-wfm/pull/524#issuecomment-6512290514), plus its authored and independently authored regression cases.

The pure helper now snapshots own enumerable plain-data descriptors before validation and output. It rejects proxies, accessors, symbol keys, hidden fields, arrays and custom prototypes without invoking their getters or proxy traps. Plain JSON, frozen records, null-prototype records and literal `__proto__` data remain supported. The source authentication, cause, cost, schedule and execution authority flags remain false.

## Source and ownership

- Original lane: #527 V095, output-gap/order-start/material-availability assessments. Stage remains INTEGRATION; this advances the order-start repair from a comment packet to a product-code adoption candidate.
- Exact parent: PR524 `0aed12cdcd99d51156a23ed7fdce5fc38d62f19e`, original source Git blob `1362425dc36075d6463f840d2ed9affae3ce5930`.
- New source SHA-256 `a040782ca4e0a4bdb2d10261eb560e9162200fc39af5e4589f2fd94c6b201ff5`, identical to the previously reviewed candidate.
- Existing PR524 owner retains its branch, and PR501 retains canonical integration/release control. This separate branch targets PR524's owner branch. Fresh PR524 comments and exact-filename PR search found no newer resolution or overlapping source writer; external leases and chats are not observable.
- No root or applicable operations/docs AGENTS.md was present in the inspected exact parent.
- Reused original four authored checks unchanged. The seven previously independent heldouts change only their module import from a scratch/env path to the colocated source. This packaging session did not perform a new independent review or spawn a reviewer.

## Fresh checks

Runtime: Node `v24.22.1`. From each separate baseline/candidate source directory:

```sh
node --test --test-reporter=tap operations/runtime/order-start-variance.test.cjs operations/runtime/order-start-variance-inert.test.cjs operations/runtime/order-start-variance-inert-heldouts.test.cjs
```

| Source | Exit | Pass | Fail | Skip | TAP SHA-256 |
|---|---:|---:|---:|---:|---|
| Exact PR524 baseline | 1 | 5 | 8 | 0 | `561ad394228a375bc799123f15779da7aa59c93bcd0e9432176f9b2845008da7` |
| Exact accepted candidate | 0 | 13 | 0 | 0 | `c63513b3de626c86e7d0eaef29d2f4ecb83b9073e848552a681559e97c703115` |

The baseline failures cover accessors, changing revisions/hashes, proxies and hidden/symbol data; valid-input and chronology controls pass. Original donor tests are unchanged. Candidate syntax checks pass. `git diff --no-index --check` emits no whitespace findings; exit 1 means the source files differ.

Earlier independent Node22 results are preserved in the linked handoff: baseline heldouts 2/7, candidate combined 13/13. Those are historical evidence, not a fresh Node22 run on this commit. Node22 and Docker are unavailable in this session; no broad operations/image/security/recovery run is claimed.

Setup failure retained: the first local reconstruction stopped because an old scratch baseline had an extra terminal newline and failed exact Git blob equality; dependent test launches then had no directory. The source was fetched from the exact remote parent, its Git blob verified, and only the corrected exact-byte runs above count.

## Remaining acceptance

The PR524 owner must review and adopt this repair and tests; the canonical owner must reconcile output-gap/material-availability siblings and bind the real consumer to authenticated current ERP/MES records and tenant/site/role authority. Run affected exact-current-base and Node22 regressions, combined image/security/recovery gates, then authorized hosted persistence/audit/readback. Ordinary JSON provenance is still caller-supplied; rejecting active objects does not authenticate source records. No integration, deployment, provider/tenant write, customer acceptance, cost saving or customer-ready claim follows from these tests.
