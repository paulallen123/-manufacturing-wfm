# Manufacturing WFM Product Constitution

This repository is building a manufacturing operations and economic operating system, not a collection of disconnected WFM features.

## Product North Star
Create a system that understands the factory, recommends the best operational action, can execute approved actions safely, and proves the financial and operational outcome.

## Non-negotiables
1. **Vector UI only.** New customer-facing work must use the current role-first Vector experience. Retired UI paths must not be extended.
2. **No duplicate implementations.** Reuse or replace existing capability; do not create parallel product paths for the same job.
3. **Outcome before screen.** Every metric must answer “so what?”, and every recommendation must state expected operational and financial impact when evidence permits.
4. **Evidence before claim.** Product, integration, security, savings and readiness claims require an evidence level and reproducible receipt.
5. **Fail closed.** When identity, permissions, deployment provenance, safety, payroll integrity or evidence is uncertain, block the action or claim.
6. **Autonomous by default.** Implementation, integration, testing, support and optimisation should complete without human intervention where safe; policy-required human approval remains explicit.
7. **Factory Graph first.** New domains map to canonical entities and relationships instead of creating isolated data silos.
8. **One action layer.** Recommendations, workflows, automations and AI actions use the same policy, audit and rollback framework.
9. **Real savings ledger.** Separate realised, projected and at-risk value; prevent double counting; retain source evidence.
10. **Scale gate.** Critical workflows must be testable at 10,000 employees / 50 sites and realistic manufacturing event volumes.
11. **Cloud portable.** Product runtime must be containerised and avoid unnecessary provider lock-in; managed cloud services may be adopted behind interfaces.
12. **Security and privacy by design.** Least privilege, secrets isolation, minimised personal data, immutable audit evidence and explicit retention rules are mandatory.
13. **Integration truthfulness.** Each connector has an evidence tier: catalogued, spec-verified, sandbox-authenticated, tenant-authenticated, production-observed.
14. **No silent regression.** A previously proven journey, role, integration or control must remain gated by automated regression evidence.
15. **Single deployable identity.** Build once, identify immutably, promote the same artefact through environments.

## Core platform primitives
- Factory Graph
- Digital Twin
- Integration Fabric
- Decision/Action Engine
- Policy & Approval Engine
- Savings / Outcome Ledger
- Autonomous Implementation Engine
- Autonomous Support & Recovery
- Role-first Vector UX
- Evidence & Release Control

## Release rule
A feature is not “done” because code exists. It is done when the intended user journey, security boundary, scale behaviour, deployment provenance and evidence receipt have all passed their relevant gates.
