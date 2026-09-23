# VECTOR Engineering Plane

## Purpose

VECTOR keeps GitHub as the authoritative source-control and collaboration system while building a private engineering plane for VECTOR-specific testing, simulation, diagnosis, proof and reusable automation.

The objective is not to recreate GitHub. The objective is to make repeated VECTOR engineering problems become permanent internal capabilities.

## Responsibility split

### GitHub remains authoritative for
- Git history and immutable source identity.
- Branches, pull requests and review.
- Release history and source recovery.
- Human-readable change discussion and approvals.

### VECTOR Engineering Plane owns
- Versioned internal tool registry.
- Test, regression and invariant tools.
- Simulation and failure-model tooling.
- Diagnostic and proof tooling.
- Tool composition into reusable pipelines.
- Tamper-evident tool-run receipts.
- Evidence-backed tool evolution proposals.

### Northstar remains isolated
Northstar stays a separate simulation/customer-emulation product. It does not share VECTOR runtime, database, secrets, deployments or CI/CD. VECTOR Engineering Plane may consume sanitised evidence or disposable/read-only test material only.

## Safety boundary

The initial engineering plane is deliberately stronger than a normal internal script collection:

- It cannot register production as an execution environment.
- It cannot execute in production.
- It cannot be registered to consume raw customer data.
- It cannot directly write external/customer systems.
- Tool versions are immutable.
- Proposed tools cannot execute.
- Shadow tools cannot perform persistent mutation.
- Certification requires independent governance, evidence and an exact source commit.
- Tool evolution is proposal-only; no tool can self-register or self-certify a revision.

Consequential customer/runtime actions remain behind VECTOR T9 trust, authority, Guardian and typed-action controls rather than being smuggled through engineering tools.

## Tool lifecycle

`PROPOSED -> SHADOW -> CERTIFIED -> DEPRECATED`

A new idea begins as a proposed tool contract. Independent evidence moves it into shadow. Repeated proof plus an exact source commit is required before certification. Old tools are deprecated rather than silently changed.

## Continuous evolution loop

1. Detect repeated friction, failure or manual work.
2. Preserve the evidence and exact context.
3. Decide whether to adopt an existing capability or create a VECTOR-specific tool.
4. Add a new immutable tool version.
5. Run it in shadow against CI/proof/staging data.
6. Measure accuracy, false positives, time saved and failure modes.
7. Independently certify only if the evidence earns it.
8. Compose the tool into reusable pipelines.
9. Convert new failures into regression cases or a new tool revision proposal.
10. Deprecate obsolete tools.

## Initial built-in tools

The first safe tool set is intentionally small:

- `vector.contract.check@1.0.0` — deterministic release/configuration contract validation.
- `vector.regression.compare@1.0.0` — baseline vs candidate metric regression checks with explicit tolerance.
- `vector.scenario.assert@1.0.0` — deterministic isolation/safety/release scenario assertions.

They execute only in shadow initially. More tools should be added only when they remove repeated engineering work or materially improve proof quality.

## Anti-sprawl rule

A one-off script does not automatically become a platform tool. A durable tool must have an id, semantic version, owner, purpose, lifecycle, environment scope, mutation class, tests and evidence. New versions replace old behaviour; they do not mutate history.

## Next expansion targets

The next high-value adapters are:
- browser and hosted journey proof;
- integration contract/replay testing;
- deterministic customer-environment fixtures;
- performance/load envelopes;
- security and tenant-isolation assault packs;
- deployment/runtime identity verification;
- failure diagnosis -> proposed regression/tool generation;
- reusable proof-pack assembly.

Those capabilities should reuse GitHub/Railway/other mature primitives where they are structurally better, while keeping VECTOR-specific execution intelligence and evidence inside the engineering plane.
