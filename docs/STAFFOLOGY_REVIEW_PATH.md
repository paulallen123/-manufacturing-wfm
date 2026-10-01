# Staffology non-deploying review path

## Retrievable source

The canonical-owner preparation commit is present in this repository's local object database as full commit `9c234fcb70ca67a709dbee6268a7e4c7a587b174` with tree `7eede0fa93cd7c958d7a5235f2109f5f7ba06dd2`. Reviewers can retrieve it locally with:

```sh
git show --stat 9c234fcb70ca67a709dbee6268a7e4c7a587b174
git diff c4c9d78..9c234fcb70ca67a709dbee6268a7e4c7a587b174
```

No remote is configured in this checkout, so this record does not claim that the commit was pushed or is remotely retrievable.

## Review without deployment

Review must use a local commit/diff or pull-request metadata on a non-release feature branch. Do not push to `main`, `release/staging`, `release/production`, or any deployment-bound ref. This repository has no `pull_request`, `pull_request_target`, `workflow_run` or `issue_comment` workflow trigger; canonical deployment workflows remain manual and fail closed. Creating review metadata does not authorize a workflow dispatch, Railway operation, preview service, deployment or provider request.

The existing CircleCI machine-executor container gate also accepts only non-deploying branches matching `review/staffology-*` in addition to its existing release branches. That job builds and exercises a disposable local image; it has no Railway credentials or deployment step. This is the approved remote review route when the local environment has no container engine.

The Staffology assembly remains `activationAvailable: false`. Review may run local/offline tests and the disposable container build only. It must not supply credentials, enable a provider client/worker, issue a hosted approval, or call Staffology.

## Current release gate

The exact container build command is `docker build --pull=false -t wfm-staffology-review .`. It must pass locally or in the CircleCI `release_runtime_validation` job before an exact hosted release-and-test approval request is prepared. In the current checkout Docker, Podman and Buildah are unavailable, configured package sources expose none of them, outbound binary download is denied, and no remote is configured to run the approved CircleCI review branch. The gate therefore remains **BLOCKED**, not passed, and no hosted approval request may be drafted from this state.
