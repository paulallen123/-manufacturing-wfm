---
name: integration-proof
description: Prove software integrations against isolated synthetic providers, devices and failure conditions using Northstar. Use when a user wants to test an integration, emulate a provider, create a synthetic enterprise, inject integration failures, validate reconciliation, or produce evidence that an integration behaves correctly.
---

# Northstar integration proof

Operate Northstar as a proving ground, not as a production-control plane.

## Non-negotiable rules

1. Default to synthetic data and isolated Northstar environments.
2. Never claim a test passed without an evidence receipt from the executed scenario.
3. Never convert DESIGN, code generation, or configuration into PROVEN status.
4. Production endpoints are denied by default. Do not weaken that control to complete a task.
5. Every mutation must be tenant-scoped, authenticated, auditable, idempotent where practical, and reversible.
6. Fault injection must remain inside the selected synthetic environment.
7. Prefer autonomous setup, execution, diagnosis, recovery and evidence generation. Human input should be needed only where a real-world consent, legal, billing, security or irreversible approval boundary genuinely requires it.
8. When a route fails, choose a safe alternate route rather than silently lowering the proof standard.
9. Preserve failure evidence. Do not erase failed runs merely to produce a green result.
10. Continuous improvement may propose or stage changes automatically, but promotion requires automated regression, security, isolation and rollback checks.

## Default workflow

1. Resolve the intended system/provider/device and integration direction.
2. Create or reuse an isolated synthetic company.
3. Select a provider persona or protocol persona.
4. Generate representative synthetic records and edge cases.
5. Establish the integration contract and expected invariants.
6. Run the happy path.
7. Run failure and recovery scenarios.
8. Reconcile input, output and persisted state.
9. Produce an immutable evidence receipt containing environment ID, scenario ID, exact build/version, inputs, outputs, checks, timestamps and failures.
10. Return PROVEN only when the requested acceptance criteria have repeatable evidence.

## Provider/device personas

Northstar should support provider-shaped emulation including NetSuite, SAP S/4HANA, Workday, ADP Workforce Now, MuleSoft, generic REST, webhook, SFTP and event-stream patterns, plus mobile phones, shared tablets/kiosks, wall/badge/NFC terminals and access-control devices.

Provider names describe emulated behavioural profiles. Never imply certification, endorsement, partnership or protocol equivalence beyond what is actually tested and evidenced.
