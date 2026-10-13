# Loss-prevention source admission — 2026-10-13

## Requirement and ownership

Research convergence row `loss-prevention-workforce` points to historical PR #214. Its actual source requirement is advisory fire/property-protection impairment recovery with mandatory temporary-control staffing, current competence, approved restoration and protected production commitments. The prior ledger summary described scrap/yield instead; this proposal corrects that mapping without treating the historical discussion as a new feature.

PR #214 owns the underlying prototype. A current open-PR search for loss-prevention headcount, negative evidence age and the module path found no active correction. This bounded source-admission correction is stacked on PR #214, so it does not create a second product or canonical integration writer. The sole canonical owner must decide adoption.

## Exact package

- Prototype base: `9a63c4ac1547ee96db5b0a2f1dd643bc885916eb` (`frontier/loss-prevention-workforce-v1`); local reviewed patch: `c94a479d7e9372a283cd7ae5b484eed5a56b9f6c`.
- Draft stacked PR: #427, remote head `02c52a8f36f3571710552f4f105a8ac2fb7354d4`. Its source and test blob hashes matched the local reviewed commit (`6d47eb2fbf03e134d91faaac7e94a7ef7d747f6c`, `77e7c5339b55846795c8dbeb0d7abe883d76e315`).
- Source patch files: `src/frontier/loss-prevention-workforce.mjs`, `test/frontier/loss-prevention-workforce.test.mjs`.
- Ledger proposal base: exact candidate `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`; files: `release/research-convergence-ledger.json`, this evidence record. No candidate runtime file is changed by the ledger proposal.

## Result and verification

The prototype now rejects negative, missing or nonfinite source ages and invalid explicit age limits; fractional policy headcounts; nonfinite derived person-minute results; and duplicate or anonymous same-site worker identities claiming distinct coverage. It preserves the advisory boundary and existing accepted scenario.

New regression tests failed before the fixes: initial focused run 6 pass/2 fail for negative age and fractional headcount; later overflow test 8 pass/1 fail; later duplicate-identity test 9 pass/1 fail. Final `node --test test/frontier/loss-prevention-workforce.test.mjs`: **10 pass/0 fail** on local Node 24. `node --check src/frontier/loss-prevention-workforce.mjs` and `git diff --check`: pass. Independent read-only reviewer found overflow and duplicate-identity defects during review, then found no remaining blockers after their fixes.

## Release state and next action

**TESTED isolated.** Review complete; PR #427 is draft and stacked on open PR #214. No canonical integration, exact-candidate deployment, hosted exercise or customer proof occurred. The current Railway candidate still serves an older source SHA, and the staged candidate refresh remains under sole release-owner control. The owner should reconcile #214 and #427 into the one candidate, rerun tests on its exact tree, then use approved release controls and a hosted/customer-like impairment scenario before advancing the status. The prototype still requires authoritative customer/site PTW, EHS, engineering and policy evidence; synthetic tests cannot establish that authority.
