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


## Relationship to existing VECTOR systems

The engineering plane is deliberately a composition layer rather than a replacement for existing VECTOR capability:

- **Product Factory / Adaptive Intelligence** is the evolution and candidate-governance brain. Verified regressions become eval candidates, repeatable verified wins become skill/tool candidates, and repeated manual effort becomes an automation candidate. Release authority remains separate.
- **Tool Foundry** is the executable engineering-tool plane. It supplies immutable, versioned test/simulation/diagnostic/proof tools and composes them into pipelines.
- **T9 Trust Spine** remains the only route for governed customer-operational authority. Foundry tooling cannot bypass evidence, authority, Guardian, typed-action or independent-verification controls.
- **Northstar** remains isolated external simulation/customer emulation. It can supply sanitised evidence and disposable/read-only test material, but it does not share VECTOR runtime, data, secrets or deployments.
- **Railway proof services** are disposable hosted build/proof lanes. They prove exact source candidates but do not become the customer production runtime.
- **GitHub** remains the canonical source/history/review layer for all of the above.

This split gives VECTOR one evolution loop without creating one giant privileged runtime.

## Placement rule for every new internal capability

Before creating a new tool, classify it:

1. If it is source history, review, branching or release metadata, keep it in GitHub.
2. If it turns evidence into an eval/candidate or decides whether a product improvement deserves promotion, put it in Product Factory.
3. If it tests, simulates, diagnoses, measures or proves something repeatedly, implement it as a Foundry tool.
4. If it emulates an external customer/provider/device/browser environment, keep that emulator in Northstar and cross the boundary only with sanitised evidence or disposable test material.
5. If it could change a customer's operational state, it must use T9 authority controls rather than Foundry authority.
6. If none of the above applies, prefer an existing mature external primitive unless VECTOR-specific context creates a measurable advantage.

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
