# VECTOR staged source preflight — 2026-10-20

## Requirement and source

Issue #265 requires one exact serving SHA for final customer proof. `release/proof-lane-policy.json` requires exact candidate binding and treats deployment commit metadata as the source of truth. This bounded preflight checks the Railway staged source patch before a canonical owner considers accepting it.

## Ownership and conflict

Open PR title/body searches for staged source, source patch, source pin and pending patch, plus remote branch searches, found no focused owner of this exact source-patch comparison. PR #81 classifies proof-service admission and staged-only configuration more broadly; this package changes no PR #81 file and creates no writer, runner, controller or deployment. The single canonical release/integration owner retains adoption and release authority.

## Exact base and files

Base: `48dce8f697825c8cd5f99b3e5aeea3953647f8c2` (canonical customer-ready candidate branch). New files: `scripts/vector-staged-source-preflight.mjs`, `scripts/vector-staged-source-preflight.test.mjs`, and this evidence record. The frozen runtime, deployment manifest and release policy are unchanged.

## Result and tests

Pure read-only assessor compares service/environment identity, successful deployment, one staged non-destructive source-commit change, the prior serving commit and the expected candidate commit. It returns `BLOCKED`, `NO_STAGED_PATCH` or `EXACT_PATCH`; all states carry `releaseAuthorized:false` and never accept/deploy a patch. Initial TDD run failed because the module did not exist. Focused tests passed 4/4 after implementation; they cover the current stale staged target, exact patch, unrelated/destructive/applying/incomplete/drifted changes and no patch. No provider secret or tenant data is used. Final core proof results are recorded in the PR.

## Current control-plane observation

Railway service `cded4ff7-24b1-4aaa-a7e2-67f143583bc2`, environment `eed9f097-610a-416e-83b9-6bc7bdb3eeef`, has successful deployment `057e19a2-7d49-4390-8705-63e71ea79a89` serving `90ad90fcf60adaca9abacdd4ad14bf392f95e585`. Staged patch `b453aa80-4763-4a08-a4f5-d5d27534b2c8` targets `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`. It is not the head of this isolated package or any later merged candidate. This observation is a point-in-time control-plane read, not a deployment proof.

## State and next action

Review and canonical integration pending. No deployment or hosted/customer proof. The canonical owner must independently review this pure assessor, obtain the candidate SHA from trusted exact-build metadata, reconcile the existing staged patch, and run the full exact-candidate release and hosted proof gates. Do not use `EXACT_PATCH` as release approval. Production approval and customer-ready claims remain unchanged.
