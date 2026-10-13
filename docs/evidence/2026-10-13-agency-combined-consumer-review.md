# Independent agency combined-consumer review

Scope: reservation #2656155505912, review-only new joint consumer proof over unchanged PR455 and PR457 source bytes. Existing module owners retain source/test ownership; sole Continue customer proof owner retains integration/release. This review neither repairs product nor establishes customer readiness. No source/test edits, external mutations, CI dispatch, DB connection, DDL, provider calls, or business writes were performed. Only the requested review report was created locally. Review runtime: Node v24.19.0, 2026-10-13 UTC.

## Conclusion

The two repaired modules compose on legitimate synthetic authority/continuity evidence and preserve their no-write output boundaries. I independently reproduced the combined suite's three malformed-expiry failures. These are actual existing JavaScript normalization behaviors at the caller/query-result boundary, not introduced regressions from PR455, PR457, or their composition. Under a trusted PostgreSQL adapter contract returning actual typed timestamp values or null, the three malformed string fixtures are outside that contract and do not establish a reachable production defect. A stronger claim requires the schema/parser contract and a reachable producer demonstrated separately. A diagnostic proof harness may preserve these REDs, with that qualification; it must not treat the two length repairs as faulty merely because they leave unrelated baseline behavior intact.

For malformed strings `not-an-instant` and empty string, `safeAuthorityRow` maps supplied expiry to null, which means unrestricted coverage and produces the same authority fingerprint as explicit null. The impossible-date string normalizes to finite `2027-03-02T12:00:00.000Z`; it does **not** become unrestricted null. The author subsequently corrected the shared title to “must withhold advisory readiness”; that final title accurately captures the proposed defensive contract. No supplied malformed expiry test demonstrates a mutation grant: all returned write flags remain false.

## Exact bytes and provenance

Workspace is a detached package, not a Git checkout. `git hash-object` independently confirms the four supplied overlay blobs. Read-only GitHub `compare_commits` confirms both heads are ahead 1, behind 0, with merge base canonical `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`; their source/test paths are disjoint. PR455 head is `1396eb5123cbfd7a5b5dc82c95b3cd86e8531072`; PR457 head is `8534ffd507d1e1cf3027aa7853ae53115e46deef`.

| Path under agency-union | Git blob SHA-1 | SHA-256 |
| --- | --- | --- |
| src/frontier/agency-identity-continuity.mjs | 1d29f27d3d47babf6e97ba3b3dac1593ea68bb79 | c67f7bfa2b3e6132b2825518bf12fff40eea85ac5ac2580673b95e6d80a7dcbe |
| src/frontier/agency-work-start-readiness.mjs | 397d676319d56393d2b62a8ce8fdc2d73ef0aa87 | f7c027768586f5af7d0f35ab7e415ab48d678d4d9044e302e4258d14a4b07bbc |
| test/frontier/agency-identity-continuity.test.mjs | 7a899f99564af45fd9dda237d4f1b5fba2e35556 | 369e54ac4ddf20f1236c10f3ff1639c648d4fde74cf07a3d7ee0c5a27143b8c2 |
| test/frontier/agency-work-start-readiness.test.mjs | ca9e82abba0be31e6010340096fa5aa713ed6155 | b174cb62739c430912fdf82b0909999852920bd177a27d5fbdaf1ad5a4dfeb11 |
| test/frontier/agency-work-start-combined-consumer.test.mjs | d2ef1b2ef5a044312f91bbb335dcb730344b8bdd | 4ae6e1e546bbd97e4c426fe61c48b1742ed974d0350d91463c0e6f0870b9e2b7 |

Read-only GitHub `fetch_file` at canonical48d returned work-start source blob `b8f1d640c2c81801c941a77609ed8fa51c438d1d`. Its `ms`, `iso`, and `coverageUntil` normalization expressions are identical to PR455, confirming pre-existing behavior. PR455 changes original-length identifier handling; PR457 changes observation/provenance original-length handling. Neither changes timestamp parsing.

## Commands and results

From `/workspace/scratch/11d7df70bc11`:

```sh
node --version
sha256sum agency-union/src/frontier/*.mjs agency-union/test/frontier/*.mjs
git hash-object agency-union/src/frontier/*.mjs agency-union/test/frontier/*.mjs
node --test agency-union/test/frontier/agency-identity-continuity.test.mjs agency-union/test/frontier/agency-work-start-readiness.test.mjs agency-union/test/frontier/agency-work-start-combined-consumer.test.mjs
```

Result: Node v24.19.0; exact hashes above; full selected run exits 1 with 28 tests, 25 pass, 3 fail, zero skipped/cancelled/todo. Original tests: 20/20 pass. New combined consumer tests: 5/8 pass, failing exactly the three supplied malformed expiries with `workStartReady:true`.

I also ran a separate `node --input-type=module` stdin probe importing both exact local modules. It used new REVIEW-* identifiers, independently constructed sorted assignment/provenance hashes, SQL snake_case rows, native `Date` timestamp values, fresh synthetic query closures, and no `evaluateContinuity` injection. Every query asserted no INSERT/UPDATE/DELETE/CREATE/DROP/ALTER/CALL tokens. Every result asserted all four write flags false and ranking impact none.

| Independent probe | Adapter normalized coverage | workStartReady | Evaluator query count |
| --- | --- | --- | --- |
| Native Date at assignment end | 2026-10-05T14:00:00.000Z | true | 3 |
| Explicit SQL null | null | true | 3 |
| Valid ISO at assignment end | 2026-10-05T14:00:00.000Z | true | 3 |
| Native Date short of whole assignment | 2026-10-05T07:00:00.000Z | false | 1 |
| not-an-instant | null | true | 3 |
| Empty string | null | true | 3 |
| 2027-02-30T12:00:00.000Z | 2027-03-02T12:00:00.000Z | true | 3 |
| Explicit null, provenance removed | null | false | 2 |

Finite too-short reason: `work_start_current_assurance_does_not_cover_assignment`. Missing-provenance reason: `identity_continuity_authenticated_provenance_missing_or_mismatched`. Bad string/empty/null shared fingerprint `f5603b26e9e51dafeca8e226c6fc4c43`; impossible date had distinct finite fingerprint `d4c9e26d5dbcfbbae715de793ea593c6`.

## Fixture independence and limits

The new tests invoke actual exported reader adapters, and the work-start evaluator imports its actual continuity evaluator; they do not inject a canned passed continuity decision. The assignment/provenance hashes follow the public evidence construction rather than reading private evaluator output. Baseline successful control plus failed overlength worker/observation and expired controls show a nontrivial composed path. Both authority reads return structured clones and call order is asserted for the positive case.

The synthetic query callback always returns its fixture without enforcing SQL WHERE clauses, row types, actual DB constraints, transaction snapshot consistency, or parser behavior. New fixtures use camelCase aliases accepted by the adapter rather than actual snake_case SQL field names. My separate snake_case/native-Date probes cover that representation gap but still do not establish actual DB/provider trust. The minIndependentSources=1 operational-credential positive is legitimate for that explicit synthetic policy; it is not direct identity or real production policy proof.

The malformed tests assert readiness first, so their no-write and no-continuity assertions do not execute after the expected failure. My independent probes checked no-write outputs on those actual readiness-true paths. The expiry `2026-10-05T07:00:00Z` is after evaluation time but before assignment end: this is insufficient whole-assignment coverage, not expiry before now.

No product source repair, final-image proof, canonical adoption, deployment, hosted acceptance, real worker clearance, or release approval is claimed. The proof-only pinned-source harness is approved within the bounded scope below. The defensive malformed-result contract remains unadmitted pending the source owner’s schema/type/parser/producer decision.


## Final pinned workflow/loader review

Reviewed `agency-union/.github/workflows/agency-combined-consumer-admission.yml` and `agency-union/scripts/prepare-agency-consumer-fixture.py`. Approved as a proof-only harness: source engines are fetched at immutable heads, response metadata and independently recomputed Git blob hashes must match all four pins, only a fresh temporary fixture is written, and current PR consumer tests are copied into that fixture. Relative imports resolve to the pinned real modules. Token permission is read-only. Node is pinned to 22.23.2; Actions dependencies use commit pins. Existing paired suites and new consumer tests run in separate steps with native process exit failures and no suppression/continue-on-error. PR triggers are scoped to the new test, loader, and workflow; manual trigger is present. The test is intentionally the PR artifact under review rather than a separately hardcoded consumer blob; the loader records its SHA-256 in its manifest.

Fresh commands:

```sh
python3 agency-union/scripts/prepare-agency-consumer-fixture.py --existing agency-union
sha256sum agency-union/.github/workflows/agency-combined-consumer-admission.yml agency-union/scripts/prepare-agency-consumer-fixture.py agency-union/test/frontier/agency-work-start-combined-consumer.test.mjs
git hash-object agency-union/.github/workflows/agency-combined-consumer-admission.yml agency-union/scripts/prepare-agency-consumer-fixture.py agency-union/test/frontier/agency-work-start-combined-consumer.test.mjs
node --test agency-union/test/frontier/agency-identity-continuity.test.mjs agency-union/test/frontier/agency-work-start-readiness.test.mjs
node --test agency-union/test/frontier/agency-work-start-combined-consumer.test.mjs
```

Loader local validation exits 0 and records exactly the four supplied pins. A separate `runpy.run_path` probe invoked `verify(b'wrong source', expected)` and confirms `ValueError: Pinned source blob mismatch` (no file writes). Final original suites exit 0, 20/20 pass. Final combined consumer suite exits 1, 5/8 pass, exactly three malformed-expiry failures retained, with zero skipped/cancelled/todo. Workflow live network fetch, supported Node22 execution and actual GitHub CI were not run in this independent review; this is source review plus local Node24 verification, not CI receipt.

| Final harness file | Git blob SHA-1 | SHA-256 |
| --- | --- | --- |
| .github/workflows/agency-combined-consumer-admission.yml | 00a27fa1ccf2442c02ca114f71b6e4e095b39d93 | c219ae0a80d1b2e89b73b1764921d0756b529cb0c5c67e96a94d8f405bdbfd02 |
| scripts/prepare-agency-consumer-fixture.py | c280a488a3ef3b9857b026b2057d7f2712ced9aa | 2dd3e8710c79837f089a24eb420b5d097d495bee95f1906ffd561cb4a979cf00 |

The earlier consumer title-only bytes were SHA-1 `01aace5ef97ced6f62cce847f5a7e6e9b73f6dfc`, SHA-256 `65f1799865f101a46fddf821b79ae056d6e6d6d37ad0a28358f0308855974e18`; those are historical only. The table above records the final rerun consumer bytes. Source bytes and existing suite bytes remained exactly pinned throughout.
