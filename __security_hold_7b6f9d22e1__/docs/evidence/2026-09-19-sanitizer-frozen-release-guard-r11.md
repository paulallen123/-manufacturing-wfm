# Sell-readiness evidence — frozen release guard (2026-09-19)

## Scope

This evidence records a sell-readiness control defect and the non-regressive correction applied to `feature/one-day-enterprise-implementation-v1`.

## Defect reproduced

The first `Sanitize sealed Vector runtime` workflow successfully transformed a disposable extraction of the sealed runtime, but its commit step then globally replaced the frozen runtime SHA across tracked text files, staged all changed files, and attempted to push them back to the feature branch. GitHub rejected the push because the token did not have workflow-update permission. The failed attempt changed no remote repository content.

That behaviour was unsafe for the current programme because it could have changed the frozen `0.6.76` customer-proof artifact metadata and its dedicated Railway proof workflow if broader write authority had been granted.

Reproduction references:

- failed workflow run: `35426380528`
- failed job: `105852956634`
- source feature commit: `d106e92267fc32413bb1ba4ab833545c2a7f315b`
- attempted disposable sanitized digest: `6c3410c17172fe73f02af12d45847f00ae1a5131ffe6cf5d67b02469047b900b`
- attempted sanitized size: `534086` bytes
- frozen manifest digest remained: `3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d`

## Safe correction

The correction was developed on isolated branch `fix/sanitizer-frozen-release-guard-20260919-r11`, reviewed through PR `#144`, and merged as `2dd11cf35fe29d5f86f17a470960105bf051f510` only after the replacement proof passed.

The corrected workflow:

1. has `contents: read` only;
2. checks out without persisted credentials;
3. verifies the original sealed artifact still matches `DEPLOYMENT_MANIFEST.json`;
4. applies the presentation retirement transform only to temporary disposable copies;
5. repeats the transform and requires the same deterministic digest, proving idempotence;
6. requires a clean Git worktree after proof execution;
7. reruns the Vector-only repository guard;
8. performs no repository, customer-proof artifact, Railway resource, production, readiness-flag, or security-control mutation.

Proof references:

- isolated repair commit: `0f045edff3558c367fd33307d5ced3eb84c680f5`
- PR: `#144`
- repair proof workflow run: `35426766043` — `success`
- merged feature commit: `2dd11cf35fe29d5f86f17a470960105bf051f510`
- post-merge transform-verification workflow run: `35426801527` — `success`
- post-merge Vector-only UI guard run: `35426803265` — `success`

## Release boundary

The frozen customer-proof release was not modified or redeployed by this repair. This change only removes an unsafe mutation path and strengthens proof discipline. It does not change the existing claim boundary: real provider acceptance and real customer zero-human implementation remain separate sell-readiness gates.
