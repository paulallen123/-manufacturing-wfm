# WFM canonical release control

This repository uses three long-lived control refs and disposable feature branches.

- `integration/canonical` is the only integration line.
- `release/staging` records the approved staging candidate. `main` is a deployment mirror of that exact SHA because the existing successful Railway service is already bound to the repository default branch.
- `release/production` is the only source for canonical production.
- Feature, UX, research, security and proof branches may move quickly and may have preview deployments, but previews are never release authority.

## Promotion contract

1. Develop on a short-lived branch.
2. Validate in an isolated preview/proof lane.
3. Merge the reviewed change into `integration/canonical`.
4. Advance `release/staging` to one exact integration commit.
5. Advance `main` to the **same SHA**; `main` is not an integration branch.
6. Existing Railway service `3bea5411-cebb-4878-adcc-766f5fd58cc7` (legacy display name `wfm-concept-fidelity-preview`) is the canonical staging executor and follows `main`.
7. Verify Railway reports terminal SUCCESS for that exact SHA.
8. Only after staging evidence is green may `release/production` advance to the **same commit SHA**.
9. Rollback moves the release refs/mirror to the last known-good SHA; no ad-hoc rebuild from another branch is release authority.

## Speed rules

Parallel experimentation is encouraged. Release serialization is deliberate: only one canonical staging/production promotion can be in flight at a time. This keeps innovation parallel while making customer-facing state deterministic.

## Temporary infrastructure

Preview/proof services are disposable. The target TTL is 24 hours after they stop being useful, and they should be removed after the relevant PR is merged or closed. Existing historical services are not deleted as part of this change; cleanup happens only after the canonical lane is proven.

## GitHub Actions

GitHub-hosted Actions are supplementary evidence, not the sole release gate. Current repository evidence has shown zero-step / no-runner failures. Railway is the execution/proof engine for the canonical hosted lane, while GitHub remains source control and review history.

Legacy workflows that pin an older SHA are proof-only and must never auto-deploy the canonical staging or production services.

## Existing Railway naming

The canonical staging authority is identified by service ID, not its legacy display name. Renaming is cosmetic and is deliberately deferred rather than creating another service or consuming additional Railway resources.
