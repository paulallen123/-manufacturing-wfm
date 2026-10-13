# Asset Intelligence Projection source admission

Evidence time: 2026-10-13 07:56 UTC. Strongest state: **DESIGNED / theory falsified for direct port**. No product implementation or customer proof is claimed.

## Requirement, source and ownership

The `asset-intelligence-projection` row of `release/research-convergence-ledger.json` derives from PR #230. It calls for a source proven, read only projection into the existing Digital Twin and integration fabric without a second source of truth. The historical prototype is `implementation/runtime/asset-intelligence-projection.cjs` on `feature/vector-research-alignment-20260923` at `07bc5218c183049a8d7ab884b15cca6ef38375ec`.

The ledger assigns existing orchestrator, product evolution, frontier, integration fabric and trust proof release engines. Read only remote ref inventory found no `asset-intelligence` or `asset-projection` named active branch. The October product base inspected here does not contain the prototype. GitHub issue #265 remains open and assigned to the repository owner; full discussion and live chat/lease ownership could not be verified. This isolated design result makes no claim to canonical integration ownership.

## Exact base and files

Base: `90ad90fcf60adaca9abacdd4ad14bf392f95e585`. Changed files: this evidence file and `release/research-convergence-ledger.json`. No product source, source schema, release ref, deployment, or runner changed.

## Result and tests

Direct port is falsified. The PR #230 projection groups machine, automation, material, WIP, inventory, supplier capacity, energy, tooling, facility, work order, order, product, quality event and cash commitment nodes. All 14 are absent from `implementation/runtime/implementation-digital-twin.cjs` `NODE_TYPES`. Its `createTwinRevision` rejects `machine` as `Unsupported twin node type: machine`; a direct projection would therefore require inventing a second revision producer or admitting nodes outside the current authority.

`node --test implementation/runtime/implementation-digital-twin.test.cjs`: 4 passed, 0 failed. A synthetic Node probe of the exact base counted 14 unsupported asset types and confirmed the `machine` rejection. No test failure occurred; the design hypothesis failed against the canonical schema.

Safe next design: have the canonical Digital Twin and integration fabric owners decide which source records are authoritative, their tenant/site identity, source revision and timestamp rules, and whether to add vetted node types to `createTwinRevision` or map them through an existing authoritative read model. Preserve the current digest, provenance, edge integrity and tenant checks. Theory tests must then cover normal source mapping, stale/conflicting source records, and cross-tenant or fabricated provenance before product implementation.

Independent review: **PENDING**. Canonical integration: **PENDING**. Exact candidate deployment: **NOT RUN**. Hosted/customer proof: **NOT RUN**. The row remains blocked with this explicit route; no source schema is widened by this package.
