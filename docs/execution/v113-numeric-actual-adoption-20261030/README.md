# V113 numeric observed-actual adoption

Verified observed actuals must be finite primitive numbers. The current donor coerces null, numeric strings, booleans, arrays and boxed numbers, allowing synthetic inputs to be labelled verified financial/learning evidence. This narrow proposal adopts the [reviewed actual-number guard](https://github.com/paulallen123/-manufacturing-wfm/pull/335#issuecomment-6512199875). Explicit numeric zero remains valid; simulation remains unverified.

## Exact source and ownership

Direct base: existing PR335 at `5c3c5e37f4ae97cb17920e8e64deaa3bc324453d`, tree `eb895dd535187868cc9e2b4c96308f51fa517599`. The original handoff targeted canonical blob `bfe001bc`; this adoption instead applies the same numeric guard on the existing owner's digest-consumption donor, preserving that entire digest check byte-for-byte. Only `operations/runtime/decision-outcome-proof.cjs` and its existing `.test.cjs` change, plus this evidence. No AGENTS.md is in the donor tree. Exact donor source/test/episode dependencies were read from GitHub and verified before isolated tests; this was a partial test materialization, not a full source/image run.

Existing PR335 owner retains the outcome-proof branch. PR501 remains sole canonical integration/release owner at `61718e1862fa650136e1952f622c9d8dd4c22af8`. Current PR/title and #527 checks found earlier V113 work terminal and the numeric repair unadopted; no competing active source writer surfaced. The integration union owner confirms this older-base donor is outside its frozen union scope.

## Fresh tests

The original seven donor tests are retained as an exact byte prefix. The previously reviewed three authored and seven independently authored cases are appended inside lexical blocks; only the independent suite's module selector becomes the local module path for portable ordinary CI. Existing Forge and Docker already select this test entrypoint, so no orphan test or shared CI selector is introduced.

Node22.23.2: donor plus regressions **13/17, exit1**; candidate **17/17, exit0**; exact adjacent donor decision-episode suite plus candidate proof suite **22/22, exit0**, all zero skips. Counts overlap. Root independently reviewed the narrow final diff and reran **22/22**. Syntax and `git diff --check` pass.

```sh
node --test operations/runtime/decision-outcome-proof.test.cjs
node --test operations/runtime/decision-episode.test.cjs operations/runtime/decision-outcome-proof.test.cjs
node --check operations/runtime/decision-outcome-proof.cjs
node --check operations/runtime/decision-outcome-proof.test.cjs
git diff --check
```

Exact compressed raw logs and hashes are retained in receipt.json. This is synthetic in-process evidence and a draft source adoption proposal. It establishes no authoritative financial reference or real saving.

## Existing blockers remain

The [existing PR335 review](https://github.com/paulallen123/-manufacturing-wfm/pull/335#issuecomment-5557022984) records P1 active-object TOCTOU and upstream outcome receipt custody, plus P2 timestamp chronology and shallow receipt freeze. They are not repaired by this finite-actual guard. Caller-supplied references are still not authenticated independent finance sources, and verified-learning flags in synthetic fixtures do not establish customer evidence.

V113 remains BLOCKED. Existing owner must resolve those findings and bind genuine independent baseline/result/finance evidence at an actual consumer. The sole integrator must reconcile onto the current source, obtain formal review and exact image/security/recovery admission, then authorized hosted audit/readback. No canonical adoption, image build, merge, deployment, provider/tenant write, realised customer saving or customer-ready claim.
