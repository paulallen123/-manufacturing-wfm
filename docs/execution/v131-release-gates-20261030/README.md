# V131 ordinary integration and frozen release checks

Status: owner-ready proposals, not applied. Both canonical branches remain unprotected in the recorded readback. No protected-branch, release, provider, or customer-completion claim.

## Reviewed owner proposals

- [Draft PR534](https://github.com/paulallen123/-manufacturing-wfm/pull/534): donor8cace91e816f3c42c29abd0b4540cc799ac03c2b, parent61718. Both frozen proof jobs now refuse missing, stale or malformed freeze authority before heavy work. Exactly three files changed. Author Node24 and independent root Node22 suites11/11,0skips; original unchanged-trigger regression red retained.
- [Stacked draft PR538](https://github.com/paulallen123/-manufacturing-wfm/pull/538): donor892609622ace380969da46c7c47bd3a6ab79fd4d, parentPR534@8cace. Exactly one config file adds23 lines for an independent always-running ordinary source job. It checks exact Node22.23.2/CIRCLE_SHA1, records source/blob receipts, executes the existing admission11-test suite and unchanged full run-forge-ci.mjs. No freeze gate, dependency, or branch/path filter blocks this job. Existing frozen jobs and scope remain unchanged.

Local full source command:16 validation/test commands,225/225 TAP tests,0skips, exit0 on Node22.23.2; admission11/11. All1,538 materialized baseline source hashes match61718;99 omitted baseline files are docs/evidence/inventory only. Local tar extraction used TAR_OPTIONS=--no-same-owner because managed root ownership restoration is unavailable; that preparation override is not proposed in CI.

Independent full ordinary shell execution also passed: admission11/11, then all16 source validation/test commands and225/225 TAP tests,0skips on Node22.23.2, with unchanged trigger (private Git fixtureb63a434c442154f88334f93282feeca23823212c). Local TAR_OPTIONS preparation only, same as author.

Independent heldouts10/10 verify the actual ordinary shell on a real Git fixture with an unchanged trigger, all11 real admission fixtures, source failure47 through tee, admission failure containment, missing/wrong SHA and wrong runtime refusal, and frozen job/trigger/gate preservation.

## Actual platform observation, exact scope

At exact892609, GitHub emitted ci/circleci: forge_integration_validation and then reported SUCCESS at [CircleCI build1225](https://circleci.com/gh/paulallen123/-manufacturing-wfm/1225), updated2026-10-30T01:35:22Z. An independent verifier, root and code author read this result. Remote config bloba70b04440189706c1e6b9afbd8fd041fb382c33c exactly matches verified local bytes.

The same donor's frozen forge_core_validation is FAILURE at build1224, expected because its trigger is unchanged. Ordinary validation ran independently of that refusal. Vercel also reports a separate failure; no aggregate all-checks-green claim is made. CircleCI full logs were not downloaded; hosted per-test counts are not asserted from status readback.

These statuses belong only to892609. They do not transfer to PR501@61718, PR537, a future integration composition, either canonical branch, any hosted service or customer proof.

## Exact proposed branch policies

The two branches need different required contexts so ordinary work remains possible:

| Branch | JSON input | Exact required contexts |
|---|---|---|
| test/vector-empty-organisation-regression-20261020 | integration-branch-protection.json | ci/circleci: forge_integration_validation |
| release/vector-customer-ready-candidate-20260925 | branch-protection.json | ci/circleci: forge_core_validation and ci/circleci: forge_runtime_validation |

The ordinary context name is now verified by actual platform output. The release contexts were independently read at source61718. Frozen jobs require authentic trigger renewal and fresh complete source/runtime proof on the final release composition. Never require freeze-only contexts for ordinary integration PRs.

Both JSONs propose strict/up-to-date checks, one independent approval after latest push, stale-review dismissal, administrator enforcement, resolved conversations, and blocked force pushes/deletion. Merge-commit compatibility is retained. No app ID or approver is invented; CODEOWNERS enforcement is not proposed without an applicable mapping. See the [official API contract](https://docs.github.com/en/rest/branches/branch-protection#update-branch-protection).

Canonical owner first reviews/composes PR534 and PR538 on one exact integration candidate and reruns the ordinary job there; renew the authentic marker and rerun complete frozen source/runtime proofs for release. No existing donor status is proof of that future composition.

## Missing administrative capability

User metadata reports admin=true, but the connected installation returns403 Resource not accessible by integration for protection details, and exposes no protection/ruleset write tool. An authorized Administration-write tool/connection plus Administration-read readback is required. No credential extraction or alternate route is attempted.

After fresh preflight confirms no policy would be overwritten, the authorized administrator may apply the distinct accepted payloads from this packet directory:

```bash
gh api --method PUT 'repos/paulallen123/-manufacturing-wfm/branches/test%2Fvector-empty-organisation-regression-20261020/protection' --input integration-branch-protection.json
gh api --method PUT 'repos/paulallen123/-manufacturing-wfm/branches/release%2Fvector-customer-ready-candidate-20260925/protection' --input branch-protection.json
```

## Independent enforcement readback

GET both branch summaries, both protection endpoints, each protection/enforce_admins and repository rulesets; record exact current heads. Require protected=true, strict=true and each branch's own exact contexts, admin enforcement, required approval1 with latest-push approval and stale-review dismissal, resolved conversations, blocked force pushes/deletion and no unapproved bypass. Inspect returned checks app_id values; this packet does not assert verified CircleCI app provenance.

Read complete exact-final-candidate proof receipts independently. A historical green context, a halted/skipped job, an ordinary-only source success or Railway fixture-host health cannot substitute for release runtime proof or authenticated customer workflows.

If write or readback is denied, retain the blocked state; do not weaken requirements or claim enforced policy.
