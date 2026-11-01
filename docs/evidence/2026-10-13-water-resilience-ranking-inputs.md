# Water resilience input and outcome repair — 2026-10-23

## Requirement, ownership and exact base

The accepted L13 `water-resilience-orchestration` row originates in Frontier PR #218. It ranks already-feasible production and staffing plans by restriction exposure, scarcity-weighted water, tariff cost and lateness, and reconciles predicted versus observed water outcomes. The four-file repair remains within the accepted PR #410 fence:

- `frontier/water-resilience-orchestration/water-resilience-orchestration.mjs`
- `frontier/water-resilience-orchestration/water-resilience-orchestration.test.mjs`
- this evidence record
- `release/research-convergence-ledger.json`

The predecessor is PR #410 head `8270d680df281acfa9ea90484d3abc4d064498cf`; the canonical target observed for this repair remains `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`. This does not authorize canonical, deployment, tenant, provider, payment or OT mutation.

## Reproduced failure evidence

The committed predecessor passed its existing synthetic suite: `node --check` on runtime and tests passed, and `node --test frontier/water-resilience-orchestration/water-resilience-orchestration.test.mjs` returned **26/26 pass** on local Node v24.19.0. That passing suite did not establish hostile-input safety.

Formal exact-head review `5552706867` reported **0/16** held-out cases passing. It demonstrated that caller accessors could change values after validation, caller-owned iterators and `plans.map` could hide rows or forge a candidate, coercible duration/date/measurement values were accepted, and outcome evidence was not bound to recommendation, tenant, site, source or freshness.

Fail-first regressions reproduced those classes through the public exports. The focused command with eight named tests returned **0/8 pass, 8 fail** against the predecessor implementation. A subsequent authoritative-financial-value regression returned **0/1 pass, 1 fail** because `null`, `false`, `[]` and `''` were converted to an accepted null realised cost. Independent review of the first repair then found permissive slot defaults and incomplete source/causal binding; five focused public-entry regressions reproduced those remaining classes at **0/5 pass, 5 fail** before the second repair. One final fail-first assertion also caught malformed financial-authority values being silently downgraded; it returned **0/1 pass, 1 fail** before exact boolean validation was added.

## Bounded implementation

Version `water-resilience-orchestration-v0.2.0` now:

- copies only own enumerable data properties from ordinary records and dense ordinary arrays;
- rejects proxies, accessors, symbols, hidden/extra fields, sparse/inherited elements and caller-supplied traversal methods before scoring;
- traverses engine-owned snapshots by index and performs deterministic stable merge sorting on an engine-owned result list without invoking caller methods or locale-sensitive collation;
- rejects malformed authoritative water source, restriction and reserve controls even on unused slots, and requires primitive finite non-negative water, tariff, scarcity, penalty, duration and authoritative outcome values;
- parses only real canonical UTC instants, rejecting rolled dates and coercible freshness settings;
- binds accepted/rejected decisions and operational, observed and financial evidence to the recommendation, tenant and site, with exact role-specific source references, bounded freshness and causal recommendation → decision → evidence ordering;
- freezes returned evidence so downstream code cannot mutate an admitted result.

The compatibility deliberately retained by earlier accepted tests is narrow: raw string identifiers remain distinct; finite numeric worker references and numeric-string slot aliases remain supported; omitted/null scarcity weight still defaults to 1 and omitted/null tariff to 0; absent restriction, reserve, preferred slot and lateness penalty retain their existing defaults, but malformed present values fail closed. The historical absent-water-source default is superseded by the explicit-source repair below. The implementation remains advisory and performs no recipe, permit, staffing, payroll, production or control-system action.

## Verification and evidence class

From repository root on local Node v24.19.0:

- `node --check frontier/water-resilience-orchestration/water-resilience-orchestration.mjs`: pass.
- `node --check frontier/water-resilience-orchestration/water-resilience-orchestration.test.mjs`: pass.
- `node --test frontier/water-resilience-orchestration/water-resilience-orchestration.test.mjs`: **38/38 pass, 0 fail/skip/todo**.
- `node -e "JSON.parse(require('fs').readFileSync('release/research-convergence-ledger.json','utf8'))"`: pass.
- `if rg -n '[[:blank:]]+$' <four-file fence>; then exit 1; fi`: pass (no trailing whitespace). The isolated scratch checkout has no `.git` directory, so `git diff --check` itself was unavailable and is not claimed.

This is **built and tested in isolation**. It is not yet independently verified on the resulting Git object, reconciled into the canonical release, executed in the final Node 22 image, deployed/enabled, or customer-proven. The synthetic suite does not authenticate utility, meter, MES, ERP, water-quality, permit, recipe or workforce evidence and does not prove savings.

## Exact next owner action

After an independent exact-artifact review, the accepted canonical owner should reconcile this four-file candidate against the current release head, execute its unchanged tests in the final Node 22 image and shared mandatory suites, admit only that exact source/artifact, then obtain a fresh intended-role advisory journey backed by authenticated water-policy, meter, MES and applicable financial receipts through durable state, fresh login and audit. No readiness or measured-benefit claim is admissible before that chain completes.

## Explicit water-source admission repair — 2026-11-01

The starting donor is `6fb242a6428489c972d028aa5552728c9d336ae9`, module Git blob `4aa585662ccfc06fc977d51b9d4d891ab5e0b94e`, existing test blob `27cff1d3900967631a1124869d61fa752a084251`. The accepted PR #330 contract requires every unique policy slot to declare its water source, including unused slots. The corrected finding at PR #410 comment `6511567645` concerns an **omitted property**; a present `undefined` value already fails strict snapshot validation.

The bounded repair removes the implicit fresh-water fallback and checks every engine-owned slot immediately after slot-key/duplicate/nonempty admission. Omitted sources return frozen `blocked / water_source_missing` with the normalized slot key. Present undefined, null, blank and nonstring values retain `water_slots_invalid`. The existing own-data snapshots, numeric/time validation, explicit-source compatibility, ranking, outcome identity and advisory boundaries remain unchanged. Source/test changes are confined to this module and its existing test; the original test file is preserved as a byte-for-byte prefix.

Primary fail-first evidence on Node v24.22.1: the original source plus four appended public-entry regressions yielded **42 tests, 40 pass / 2 fail**, exit 1. The two failures demonstrate missing-source admission and multi-plan ranking; positive explicit-source and malformed-value controls pass. This is separate from the independent verifier's plain-data baseline of **8 tests, 5 pass / 3 fail**. Results overlap and must not be added.

Final local and independent verification results are recorded in the current PR review/issue receipt. These remain source-level synthetic tests. No utility policy, reserve, meter, operational or financial authority is created by this repair, and no image, canonical adoption, deployment, OT action or customer proof is inferred. The existing sole integrator must reconcile the exact reviewed successor and the remaining consumer/source/image/customer acceptance requirements.
