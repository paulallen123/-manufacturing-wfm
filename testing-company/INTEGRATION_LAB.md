# Northstar Integration Lab

## Purpose

Northstar is a separate fictional manufacturing company used to prove that VECTOR can safely integrate with heterogeneous customer estates.

The prototype is integration-first.

Northstar supplies realistic workforce, payroll, production, access, skills and finance data. The Lab exposes that data through multiple transport/protocol behaviours and verifies VECTOR ingestion, output, reconciliation and recovery.

## Prototype flow

`Northstar source system -> protocol emulator -> canonical mapping -> VECTOR test bridge -> VECTOR result/output -> Northstar reconciliation -> evidence receipt`

VECTOR remains the product under test. Northstar remains the synthetic customer.

## Integration families

The first prototype covers:

1. REST / OpenAPI
   - push and pull
   - OAuth-style expiry
   - pagination
   - 429 / Retry-After
   - schema version changes

2. OData
   - metadata discovery
   - filtered pulls
   - server-side paging
   - changed entity shape

3. SOAP / XML
   - WSDL-style operation envelope
   - namespace/version drift
   - SOAP fault semantics

4. Webhooks
   - signed event delivery
   - duplicate/replay
   - out-of-order events
   - retry acknowledgement

5. SFTP / files
   - CSV / JSON / XML batches
   - checksum
   - partial files
   - duplicate file
   - quarantine and replay

6. Database / CDC
   - snapshot pull
   - incremental cursor
   - duplicate sequence
   - connection interruption
   - schema drift

7. Kafka / event stream
   - partitions
   - offsets
   - duplicate delivery
   - consumer restart
   - poison message / dead-letter route

8. MQTT / plant event
   - topic mapping
   - retained/stale message
   - disconnect/reconnect
   - read/subscribe only by default

9. Middleware / iPaaS
   - MuleSoft-style relay
   - transformed fields
   - retry/error envelope
   - source provenance preservation

## Data domains

Every integration family can be exercised using:
- workers;
- contracts;
- shifts;
- time and attendance;
- absence;
- qualifications and skills;
- payroll inputs and outputs;
- production events;
- access events;
- agency labour;
- cost/value evidence.

## Proof

Each run returns an evidence receipt containing:
- company revision;
- integration family;
- direction: Northstar -> VECTOR, VECTOR -> Northstar, or round trip;
- source payload digest;
- canonical mapping digest;
- fault injection;
- delivery/retry/reconciliation result;
- duplicate/loss count;
- authority boundary;
- VECTOR source identity where actually connected;
- claim boundary.

A local protocol simulation is never labelled a live provider integration.
A VECTOR health probe is never labelled an authenticated round trip.
An authenticated fictional-tenant round trip is never labelled a customer/production certification.

## Separation

Testing Company code and state remain outside VECTOR runtime.

The Lab may use VECTOR's published integration contracts, but VECTOR does not depend on Northstar for normal operation.
