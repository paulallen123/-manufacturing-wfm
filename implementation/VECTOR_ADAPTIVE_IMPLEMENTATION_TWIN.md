# Vector Adaptive Implementation + Implementation Digital Twin

Status: DEVELOPMENT
Base: fix/vector-onboarding-provisioning @ 318409c3e794b4ed6cb2b9016c2d258768b0582b

## Objective

Extend the existing Vector implementation journey without creating a competing UI, runtime, architecture, or release path.

The customer experience becomes:

contract signed -> adaptive scope -> tenant environment -> system discovery -> approval -> validation -> configuration -> role learning -> scenario proof -> live-data reconciliation -> readiness

and remains continuously adaptive after go-live.

## 1. Adaptive implementation journey

The existing adaptive scoping graph becomes the implementation journey's question engine.

Rules:
- Ask only unresolved questions that materially affect configuration, testing, dependencies, risk or customer decisions.
- Reuse only current, authoritative, unambiguous evidence.
- Never silently infer high-risk payroll, security, access, compliance or destructive decisions.
- Invalidate answers made obsolete by an upstream change.
- Every accepted answer produces a machine-actionable CONFIG, TEST, DEPENDENCY, RISK, DECISION or explicit NO_OP effect.
- Small customers receive short sensible-default journeys; global customers retain hierarchy, regional overrides and phased rollout.
- Preserve the existing blue-and-white Vector implementation UI. No second onboarding UI.

### Single source of truth closure

Implementation readiness must derive integration readiness directly from the autonomous integration hub rather than requiring a separately maintained source-systems status.

Expected mapping:
- DETECTED / CONFIRMED -> implementation integration work visible, not complete.
- AUTHORIZATION_REQUIRED / REAUTH_REQUIRED -> customer/admin action required.
- VALIDATING / DEGRADED -> in progress / needs review.
- ACTIVE with required authoritative scopes and successful reconciliation -> source-systems evidence eligible to PASS.
- A regression immediately removes PASS and updates the implementation journey.

Learning readiness continues to derive from the adaptive learning engine.

Integration or configuration changes that affect a role must create delta-learning assignments through the existing adaptive learning engine. Completion must flow back into implementation/readiness evidence.

### UI behaviour

The Implementation screen is the live control surface. Backend state changes must update:
- current implementation stage;
- integration cards;
- customer decisions;
- training progress;
- test/readiness status;
- overall readiness.

Use immediate event-driven refresh where safely available, with the existing periodic refresh retained as a recovery fallback. Do not rely on manually ticked completion boxes.

After environment provisioning, remain in the Implementation journey and show the environment as ready. Provide an explicit Open workspace action instead of automatically removing the customer from implementation context.

## 2. Vector Implementation Digital Twin

Create a tenant-scoped, evidence-bearing implementation twin. It is not a second operational data store and must reference authoritative records rather than copy secrets or unrestricted source data.

Minimum graph:

Tenant
  -> legal entities
  -> sites
  -> departments / lines
  -> people / roles
  -> systems
  -> integrations / source authority
  -> policies / configuration
  -> competencies / training
  -> tests / evidence
  -> readiness gates

Every node/edge must carry:
- tenant;
- stable identifier;
- source/provenance;
- observed/effective time;
- confidence or verification state where applicable;
- revision/digest;
- lifecycle state.

### Change-impact engine

For each verified change:
1. compare the new evidence with the current twin revision;
2. calculate affected configuration, integrations, roles, training, tests and readiness gates;
3. classify actions as safe-auto, approval-required or blocked/fail-closed;
4. simulate safe changes before mutation;
5. present a concise impact card in Vector;
6. execute only within existing authority boundaries;
7. re-run affected tests;
8. update training only for affected roles;
9. preserve evidence and new twin revision;
10. roll back or fail closed if proof fails.

Examples:
- New site -> inherit regional template, identify local decisions, create site tests and role training.
- Payroll provider change -> invalidate source authority/mapping evidence, require authorisation, reconcile payroll before readiness returns.
- New shift pattern -> simulate coverage/payroll impact and retrain affected managers.
- Integration schema drift -> mark affected mapping/readiness as degraded, preserve unaffected evidence, revalidate only impacted paths.
- New feature -> generate delta learning only for affected roles and require relevant proof before enablement.

## Evidence and release gates

Do not claim production readiness from source tests alone.

Required proof:
- adaptive questionnaire branches correctly for representative 1-person, 100-person and 10,000-person/50-site profiles;
- saved scope/twin state survives refresh and new login;
- integration approval visibly changes the Implementation UI and authoritative readiness state;
- ACTIVE -> DEGRADED regression visibly reverses readiness;
- integration/configuration change assigns only affected delta learning;
- learning completion updates readiness;
- twin revisions are tenant isolated, append-auditable and deterministic;
- stale client revisions fail closed;
- browser proof uses the approved Vector UI;
- no retired UI or parallel architecture is introduced.

## Value metrics to capture

Measure rather than assume:
- questions avoided through authoritative prefill;
- customer minutes required;
- implementation elapsed time;
- manual implementation touches;
- percentage of configuration safely auto-applied;
- integrations discovered / connected / validated;
- training assignments automatically generated;
- affected-role training precision;
- change-to-revalidated-ready time;
- human support interventions;
- failed/rolled-back autonomous changes.

Customer financial savings remain unclaimed until observed with customer evidence.
