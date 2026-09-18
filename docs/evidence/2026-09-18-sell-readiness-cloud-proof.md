# Manufacturing WFM sell-readiness cloud proof — 2026-09-18

Candidate basis: `feature/one-day-enterprise-implementation-v1` at code commit `6d391d319c378c60ac38cfa27540afee1f81cb1a`.

## Railway proof

Existing service `wfm-integration-fabric-v1-proof` deployment `8105241e-1f82-4317-8b4a-4d392730f833` completed successfully from the private GitHub branch after a fresh source fetch. No new Railway resource was created and the frozen customer-proof service was not changed.

Deterministic admission gate: 63 tests passed, 0 failed. The current lifecycle matrix covers clocking, absence, overtime approval, agency assignments, starter/transfer/leaver effective dating, retro changes, integration outage/recovery, idempotency, append-only evidence and tenant isolation. Integration-security tests cover PKCE/signed state, token redaction, same-origin pagination, malicious next-link rejection, least-privilege discovery gating and safe provider errors. Role-learning tests cover least privilege, role-generated plans, independent mastery evidence, teach-back, targeted refreshers and tenant isolation.

Exact cloud scale proof status: PASS. Scale: 10,000 employees, 50 sites, 100,000 punches, 40,000 timecards. Independent payroll reconciliation: expected 15,180,000; projected 15,180,000; unexplained variance 0. A deliberate 20-unit corruption was detected exactly. Hostile-data controls detected duplicate employee IDs, orphan managers, missing organisational structure and malformed punches and blocked unsafe auto-application.

Runtime admission confirmed the service listening on `0.0.0.0:3000`. Runtime states `Fixture/demo data only. Production approved: false.` This evidence therefore does **not** claim a live payroll/HCM/ERP provider connection or a customer production implementation.

## Remaining proof boundary

Live authenticated external-provider sandbox evidence remains open because no authorised provider-specific sandbox credentials are currently present in the proof-service configuration. Full hosted role-based browser journeys in the new role-first UI also remain an open sell-readiness proof. Readiness flags must remain unchanged until those boundaries are genuinely cleared.

## Reproducibility

Evidence source is the Railway build/deploy logs for deployment `8105241e-1f82-4317-8b4a-4d392730f833`, plus the exact Git code identity above. No production/customer mutation occurred during the cloud-scale proof.
