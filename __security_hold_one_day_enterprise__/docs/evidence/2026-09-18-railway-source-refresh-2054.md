# Railway source refresh evidence — 2026-09-18 20:54 BST

Purpose: force and verify a fresh source fetch for `feature/one-day-enterprise-implementation-v1` after Railway GitHub access was confirmed restored, without creating resources or weakening the candidate.

## Safety boundary

- No application/runtime code changed by this evidence work.
- No customer-proof/frozen release changed.
- No new Railway service, database, volume, domain, or paid resource created.
- No readiness flag or security control changed.
- Target services remain `wfm-one-day-enterprise-v1` and `wfm-integration-fabric-v1-proof` only.
- Functional candidate remains `6d391d319c378c60ac38cfa27540afee1f81cb1a`; subsequent commits in this chain are evidence/documentation only.

## Observed source/deployment state

1. GitHub branch access is healthy. The feature branch accepted evidence commit `24e932e43bea2a0feffdf1a92db8d0567fb091b3`.
2. `wfm-integration-fabric-v1-proof` is green on Railway deployment `8105241e-1f82-4317-8b4a-4d392730f833`, source commit `6d391d319c378c60ac38cfa27540afee1f81cb1a`.
3. An explicit Railway redeploy of `wfm-one-day-enterprise-v1` produced deployment `635b70ba-9d83-417d-b2df-38d894300731` and reached `SUCCESS`, but its deployment metadata still identifies source commit `9aff595bebaedd9bf77c84d93753f9de9fac6e89` rather than the current branch candidate.
4. This is expected Railway redeploy behaviour, not evidence of a new application defect: Railway documents that **Redeploy** reuses the existing commit and does not fetch a newer connected-GitHub commit. The required operation is a latest/specific-commit deployment.
5. The existing `release/24h-sell-readiness-20260918-r1` evidence branch was fast-forwarded, without force, to exact feature commit `24e932e43bea2a0feffdf1a92db8d0567fb091b3` to invoke the repository's already-existing exact-candidate deploy workflow. GitHub Actions run `35388950230` was created for that exact SHA.
6. Run `35388950230` failed before executing any workflow step: the sole job `105742532118` has conclusion `failure`, `steps=null`, and no job log blob. Therefore it did **not** run tests, build an image, use the Railway token, or mutate either Railway service. This is classified as CI runner/execution infrastructure failure, not a failed product gate.
7. The Railway management-agent fallback is currently unavailable because its configured usage limit is reached. No limit was increased and no paid resource was added.

## Readiness consequence

The integration proof service retains valid green cloud evidence for the functional candidate. The one-day service is healthy but **cannot yet be claimed to host the latest combined candidate**, because its current successful deployment provenance is still `9aff595b...`.

The combined candidate remains fail-closed/conditional until a latest-commit deployment of the one-day service is proven and the remaining authorised-provider and authenticated-browser evidence gaps are closed. No readiness flag is changed by this document.
