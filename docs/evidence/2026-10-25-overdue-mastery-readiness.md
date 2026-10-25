# Overdue training mastery and readiness — 2026-10-25

## Requirement and source

Issue #202 requires training and progression, skills/certification validity and critical-skill coverage. The existing adaptive learning engine reports tenant mastery and privileged readiness. Its `planForUser` already surfaced expired mastery in the due list, but `recomputeAssignment` kept the row `MASTERED`; `summaryForTenant` therefore counted an overdue competency as mastered and could preserve a readiness claim. This is a runtime correction to an existing capability, not a new training engine or qualification source.

## Ownership and conflict

Open PR title/body searches for refresh due mastery, overdue mastery, training progress, refresh overdue, and the exact engine filename, plus remote branch checks, found no focused owner. Related role and training PRs own different packages. Canonical integration/release ownership is unchanged. The isolated branch changes no provider, route, role grant, writer, runner, controller or deployment configuration.

## Exact base and files

Base: `release/vector-customer-ready-candidate-20260925@48dce8f697825c8cd5f99b3e5aeea3953647f8c2`.

- `learning/runtime/adaptive-learning-engine.cjs`
- `learning/runtime/adaptive-learning-engine.test.cjs`
- `docs/evidence/2026-10-25-overdue-mastery-readiness.md`

The final branch commit may update `artifact/vector-proof-freeze.trigger` only for non-deploy exact-head CI.

## Implementation and verification

When a `MASTERED` assignment reaches `due_at_ms`, a read transitions it to `REFRESH_DUE` unless that operation records a fresh independent success. The original mastery timestamp and append-only evidence remain intact. User and tenant mastery/readiness totals then exclude the overdue row. The user's next learning list orders earlier due items first. Fresh independent task or observed success can restore mastery and set a later refresh date under the existing scoring rules. No new permission, certification, or employee action is granted.

The new regression was red: focused suite 17/18, with the overdue row still `MASTERED`. An intermediate run was 19/20 because the existing next-three list did not prioritize the overdue refresher. After both fixes, affected adaptive learning/training twin tests passed 20/20 and the full learning runtime suite passed 115/115 on Node 24.19.0. Local FORGE core reported `VECTOR_FORGE_CORE_CI=PASS`; syntax and diff checks passed. CircleCI exact head, Docker image, hosted and customer proof are pending. Synthetic SQLite fixture only; no customer or payroll state changed.

## Review, integration, deployment and proof

Built and tested in an isolated branch. Independent review, canonical merge, exact-image release gates, staging deployment and hosted readback remain pending. Existing competency mastery is application learning evidence, not externally authenticated trade certification. The canonical owner should review the status transition and its readiness consumers, merge after exact checks, and prove a synthetic overdue-to-refresh-to-renewal journey on one serving SHA. Production approval and customer-ready claims remain unchanged.
