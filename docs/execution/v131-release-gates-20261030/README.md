# V131 release gates — owner action packet

Status: proposed, not applied. No protected-branch, release, provider, or customer-completion claim.

Fresh GitHub branch summaries show both canonical integration and release branches unprotected, with required checks off and empty; repository rulesets are empty. The connected user reports admin=true, but the installation returns 403 Resource not accessible by integration for protection details, and exposes no protection/ruleset write tool. Effective administration access is the missing capability.

## Bounded CI repair

[Draft PR534](https://github.com/paulallen123/-manufacturing-wfm/pull/534), donor8cace91e816f3c42c29abd0b4540cc799ac03c2b, parent61718e1862fa650136e1952f622c9d8dd4c22af8 changes exactly three source files. The original command halts a required job green when the freeze trigger is unchanged. The repair refuses that admission before heavy work, while preserving every source/runtime proof step and the existing valid freeze format.

Fresh local proof:11/11 real-Git fixture tests,0skips, Node24.22.1; Bash syntax and YAML parse pass. The unchanged-trigger test fails against the extracted baseline because original gate exit0 does not satisfy required exit1. Independent Node22 review is pending. The donor deliberately keeps the trigger unchanged, so CI refusal on this donor is expected and no hosted full-proof success is claimed.

Canonical owner next action: review/compose PR534, renew the authentic freeze trigger on the final composition, run fresh exact-CIRCLE_SHA1 source and runtime proofs, and independently inspect complete receipts. Green context names alone do not establish executed proof on historical candidates.

## Proposed administrative action

Use an authorized GitHub connection/tool with repository Administration write permission. Administration read is also needed for independent readback. [Official API contract](https://docs.github.com/en/rest/branches/branch-protection#update-branch-protection).

The adjacent branch-protection.json requires the two observed CircleCI contexts, an up-to-date branch, one independent approval after the latest push, stale-review dismissal, administrator enforcement and resolved review conversations; force pushes and deletion are disabled. It preserves merge-commit compatibility. This is an exact proposed policy for owner acceptance; no approver or application ID is invented.

After fresh preflight confirms no new policy would be overwritten, apply the same JSON to these two exact endpoints using the authorized administration tool:

- PUT /repos/paulallen123/-manufacturing-wfm/branches/test%2Fvector-empty-organisation-regression-20261020/protection
- PUT /repos/paulallen123/-manufacturing-wfm/branches/release%2Fvector-customer-ready-candidate-20260925/protection

GitHub CLI equivalents, to be run only by that authorized administrator from this packet directory:

```bash
gh api --method PUT 'repos/paulallen123/-manufacturing-wfm/branches/test%2Fvector-empty-organisation-regression-20261020/protection' --input branch-protection.json
gh api --method PUT 'repos/paulallen123/-manufacturing-wfm/branches/release%2Fvector-customer-ready-candidate-20260925/protection' --input branch-protection.json
```

An approval must come from an authorized GitHub reviewer other than the latest pusher. Agent self-approval is not a substitute. CODEOWNERS enforcement is not proposed because this packet has not established an applicable CODEOWNERS mapping.

## Mandatory independent readback

GET each branch summary, each protection endpoint, protection/enforce_admins and repository rulesets. Record the exact current heads. Require protected=true, both exact contexts present, strict=true, enforce_admins.enabled=true, required approval1 with require_last_push_approval=true and dismiss_stale_reviews=true, resolved conversations, no force push, no deletion and no unapproved bypass. Inspect the returned checks app_id values; this packet does not assert a verified CircleCI application binding.

Read the final candidate's combined statuses and complete provider receipts: both source/runtime proofs must have actually executed on that exact SHA with no skipped/stale result counted as PASS. The Railway vector-hardening-proof status is fixture-host health and is not a substitute for these checks or authenticated customer proof. No GitHub Actions/check runs existed at source61718 during this readback.

If the write or readback is denied, retain the blocked state. Do not substitute direct pushing, force merging, removing requirements, credential extraction or a weaker context name.
