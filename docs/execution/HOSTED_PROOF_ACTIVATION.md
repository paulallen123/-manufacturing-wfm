# Hosted proof activation packet

Observed 2026-10-26T01:24:42.772Z; integration owner /root, same PR501. Parent checkpoint f0ac066b667a320ad385f6dd437caaccc11345c4. No persistent executor.

## Verified readiness
Exact admitted source b4a2582c59ccf1c2618274b16e569870fd9b3517 remains SUCCESS on isolated deployment b39f0232-0a2e-44e4-a50b-2a32203924c2. That service serves an identity receipt, not the application. Existing hardening proof service 48ee3ceb-9cfc-4399-b3a1-3628e3603815 still has no volume and no staged changes. Current proof-runner f84fe27d-af17-451c-b164-54dfef6b6a4b is unchanged, latest deployment 60f21e99-b8e9-4873-bb1f-5f32ddd37a5c from October17.

Exact source preflight blob 80668b6f9c1e10d97501ca41e50ca59c684778ee requires nine variables. Railway exposes seven corresponding names; VECTOR_PROOF_AUTH_PROFILE and VECTOR_PROOF_ACTORS_JSON are absent. Values of present variables were not accessed or validated. No remote preflight/session executed. The existing wrapper conditionally expects PROVEN before role checks; the new signed client is documented as PARTIAL auth/navigation only. Reconcile actual configured script and wrapper contract before activation; do not change PARTIAL to PROVEN to satisfy the wrapper. No whole-journey claim follows from either status.

## Concrete bounded change requiring owner input
Reuse only project43367a88-2233-4c6b-9018-0ce234dd73ca/environment eed9f097-610a-416e-83b9-6bc7bdb3eeef, hardening proof service48ee and existing proof runnerf84. Obtain explicit hardening-service handoff and approval for one isolated500MB /data volume and its metered cost; use a new synthetic database, never customer volume/data. No new database subscription, service/controller or production release.
Railway docs rechecked this observation: https://docs.railway.com/guides/clickhouse-analytics#size-the-volume lists $0.15/GB-month of used volume storage. 0.5GB is about $0.075/month storage only, not an all-in quote or spending cap. Existing compute/egress charges remain separate; remaining account budget unknown. Confirm permitted incremental run budget before a chargeable run.

Approve a synthetic-only proof identity cohort (manager, employee, payroll_admin, director in one test tenant; a manager in a different test tenant) with corresponding server allowlist. Configure actual identities/bindings through secure facilities; no invented customer identities or customer-role expansion. Set profile signed, validate existing signer locally in protected runner, and bind exact deployed SHA/deployment/tenant/run/configuration digest. No secrets in chat. Credentials or signing keys must not be copied from customer services.

Image promotion remains a technical gate: the b39 digest is known but its pullable registry reference/access is not established. Never invent a registry URL or call a new build the same image. Inspect approved provider mechanisms; if rebuilding is necessary, independently admit and identify the new artifact before proof. Maintain release/proof-lane-policy requirements.

## Verification and rollback
Before applying, inspect the complete service-scoped patch and current ownership. Preserve hardening36ce7d6b configuration and any required proof data before mounting /data, since a mount can hide existing files. Keep customer service untouched. Verify actual non-root application bootstrap, exact serving identity, signed login/negative roles, refresh/restart persistence and isolated recovery; record screenshots/traces and exact artifact. Revoke test sessions/allowlist on completion. Retain isolated volume until evidence and data retention decisions are explicit; do not delete it automatically. Application rollback does not undo data writes.

## Next executable action
Resolve the bounded handoff/budget/synthetic-identity authorization, then configure and verify the existing proof service through normal controls. Independent current-source review/backlog work remains eligible; no duplicate builds or CircleCI login required. Full product/provider/customer proof remains incomplete.
