# VECTOR Universal Data Gateway

## Purpose

VECTOR must not depend on a prospect already owning an integration-friendly HCM, ERP, payroll, MES or access-control platform.

The Universal Data Gateway makes **integration a route selection problem, not a go/no-go prerequisite**. Every supported route produces the same canonical data contract, so workforce, payroll, scheduling, cost, compliance and Factory Autopilot logic do not need separate implementations for every transport.

## Supported customer situations

| Situation | Primary route | Operating principle |
|---|---|---|
| Modern API/webhook exists and is approved | Native API / webhook | Use the existing Autonomous Integration Hub |
| Source is inside a private customer network | VECTOR Edge Bridge | Read-only customer-side bridge; outbound only where allowed |
| Legacy system can produce scheduled exports | Automated file / SFTP exchange | Scheduled export, checksum, completion marker, idempotent ingest |
| Customer can only export manually | Secure assisted upload | Human supplies file; VECTOR automates validation/mapping/reconciliation afterwards |
| Site is isolated or air-gapped | Air-gapped VECTOR Edge | Local canonicalisation, local audit, signed import/export evidence |
| No safe machine/file interface exists but UI access is explicitly approved | Controlled read-only automation | Last-resort, read-only, auditable, revocable automation |
| Customer has no source system | VECTOR-native system of record | VECTOR becomes authoritative from day one |
| Essential historical data cannot be accessed at all | VECTOR minimum-data gap capture | Capture only minimum missing facts; never invent inaccessible history |

## Decision order

VECTOR chooses the safest route that preserves the required business outcome:

1. If no source system exists, use **VECTOR-native**.
2. If the environment is air-gapped or zero-egress, use **Air-gapped VECTOR Edge**.
3. If an approved API is available and data may cross the approved boundary, use **Native API**.
4. If customer-side compute is available, use **VECTOR Edge Bridge**.
5. If automatic export exists, use **Automated file/SFTP**.
6. If only manual export exists, use **Secure upload**.
7. If explicitly approved and no safer option exists, use **Controlled read-only automation**.
8. Otherwise use **VECTOR minimum-data gap capture** and keep dependent capabilities fail-closed until required facts are supplied.

The route can later evolve without changing the downstream VECTOR model. A customer can begin with secure upload, progress to SFTP, then move to an API without re-implementing scheduling, payroll or workforce rules.

## Canonical contract

Every ingestion route must preserve:

- stable source identity: \`sourceSystem + sourceId\`
- entity type
- observed timestamp
- source update/version information where available
- payload
- permissions / ACL metadata
- deletion/tombstone semantics
- content hash for change detection
- traceability back to source and ingestion evidence

VECTOR does **not** fabricate IDs, historical facts, permissions or deletion events when a source cannot provide them.

## Proof model

A route is one of:

- **PLANNED** — route selected, not yet authorised for use
- **ACTIVATED** — route approved and configured
- **PROVEN** — every route-specific proof requirement has PASS evidence at the required confidence

Examples of required proof include authorization, schema reconciliation, tenant isolation, checksum/idempotency, deletion propagation, offline package integrity, read-only source boundaries, reconnect/replay, and explicit customer approval for controlled UI automation.

Implementation readiness consumes only a **PROVEN** route. This prevents a configured-but-unverified integration from being treated as operationally ready.

## Security non-negotiables

- tenant isolation remains unchanged
- planning APIs never accept plaintext source credentials
- customer-side bridges are read-only against source systems
- controlled browser/desktop automation is last-resort and requires explicit approval
- permissions are preserved into VECTOR; missing ACLs default to restrictive handling
- payroll/compliance records are never silently mutated because an integration transport failed
- inaccessible historical facts remain visibly unresolved
- all integration events are append-only audit events

## Relationship to one-day autonomous implementation

The existing \`source-systems\` implementation requirement now means **authoritative data route**, not necessarily an external system.

A proven Universal Data Gateway route can therefore satisfy the source-data gate when:

- VECTOR is the native system of record;
- a file/edge/fallback route is proven; or
- a conventional integration is proven through the existing hub.

This keeps the one-day implementation target valid for customers with no HCM/ERP, customers with closed legacy systems, and customers with strict network constraints.

## Current implementation

Runtime:
- \`integration/runtime/universal-data-gateway.cjs\`
- \`integration/runtime/autonomous-integration-hub.cjs\`
- \`implementation/runtime/one-day-enterprise-engine-core.cjs\`

Tests:
- \`integration/runtime/universal-data-gateway.test.cjs\`

API surface:
- \`GET /api/integrations/autonomous/universal/catalog\`
- \`POST /api/integrations/autonomous/universal/plan\`
- \`POST /api/integrations/autonomous/universal/activate\`
- \`GET /api/integrations/autonomous/universal/status\`
- trusted worker: \`POST /api/integrations/autonomous/universal/evidence\`
- trusted worker: \`POST /api/integrations/autonomous/universal/validate-envelope\`

## Hosted proof still required

The control plane and deterministic route selection are built and unit-tested. Release status must remain below **PROVEN** until the active hosted candidate demonstrates:

- route selection from the authenticated UI;
- persistence after refresh/new login;
- at least one real fallback transport end-to-end;
- tenant isolation;
- reconciliation and deletion handling;
- failure/reconnect behaviour;
- implementation readiness consuming the proven route;
- exact deployed release identity and durable storage.
