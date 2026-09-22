# Northstar Manufacturing Group — VECTOR Testing Company

Northstar Manufacturing Group is a fictional manufacturer used to test, stress, demonstrate and learn from VECTOR.

It is **not VECTOR**, is not a customer tenant, and grants no production authority.

## Separation rule

Northstar owns:
- synthetic people, sites, shifts, production demand and costs;
- synthetic source systems and integration behaviour;
- disruption/failure injection;
- expected outcomes and scenario truth;
- test evidence and regression scenarios.

VECTOR owns:
- integration ingestion and reconciliation;
- tenant/role/auth boundaries;
- workforce state and Digital Twin;
- decision/simulation logic;
- approval and execution authority;
- payroll/time/absence workflows;
- observed product outcomes.

Northstar may send synthetic data to a dedicated VECTOR test tenant and may read bounded test evidence back. It must never:
- connect to a customer or production tenant;
- possess production credentials;
- override VECTOR policy or approval authority;
- directly edit VECTOR databases;
- mark simulated savings as realised customer ROI.

## Operating modes

1. `LOCAL_SIMULATION`
   Northstar runs entirely independently and produces expected events/outcomes.

2. `VECTOR_SHADOW`
   Northstar sends synthetic events to a dedicated read-only/shadow VECTOR test path and compares VECTOR recommendations with scenario truth.

3. `VECTOR_TEST_TENANT`
   Northstar drives a dedicated fictional VECTOR tenant end-to-end. Consequential writes remain bounded to that test tenant and normal VECTOR authority controls.

Production/customer targets are prohibited.

## Northstar evolution loop

`operate -> inject disruption -> observe VECTOR -> compare expected vs observed -> create evidence receipt -> convert failures to permanent regression -> evolve Northstar complexity -> rerun`

The Testing Company gets harder over time. VECTOR gets better by passing a growing body of deterministic scenarios.
