# Bounded lane01 twin projection design

Frozen source identity: f32ca1a2672d47dcff8ef6cd1c3d71c77cf60560. No proven or convergence base is admitted (both null). Isolation: work/lane01-twin; unchanged copies of the frozen TwinRevision contract and its four existing tests under baseline/. No work/src edits.

Source candidate PR205: evolution/factory-evidence-kernel-20260920-1146@65fc59dadba377bce5fc68a88dc536261a5e68be. Reviewed buildFactoryGraph, buildOperationalHistory and buildEngineeringMemory.

Disposition of whole source: REJECT for this batch. buildFactoryGraph accepts independent entity/relation/event collections, uses its own wider type registry and retains nested references. buildEngineeringMemory accepts independent records. Neither binds a tenant nor a canonical twin revision. They cannot become a second operational graph or state/authority owner.

Valid reusable subparts: pure typed traversal; event-time versus observed-time replay and lateness; engineering revision lineage and supplied-token/vector similarity. They will be adapted behind a single read-only projection module. No persistence, network, SQL, providers, routes, action dispatch, readiness mutation, mastery award, authority grant, planner or savings computation.

Public contract:
- projectTwinGraph({tenant, revision}) accepts only a complete canonical TwinRevision. Before normalisation: reject cross-tenant nodes/edges. Reconstruct using frozen createTwinRevision and require exact content/revision digest identity, rejecting missing/malformed revision, duplicate nodes, unsupported node types and tampered data. Read results contain detached, deeply frozen canonical types/nodes/edges, sourceTwinRevision and executionAuthority NONE. relatedAt filters edge/node provenance known time and half-open effective/validTo interval.
- projectOperationalHistory({tenant,revision,lateAfterMs}) extracts operational events exclusively from revision.nodes[].data.operationalEvents. Each event remains attached to its canonical node identity; no independent entity graph input. Require nonempty id/kind, valid occurrence time, valid sourceRef and observedAt, source provenance not known before node provenance. Reject duplicate event IDs and event observation before occurrence. eventsInWindow excludes records learned after knownAt; incidentBundle refuses an anchor unknown at that time (original module leaked anchor metadata). Lateness and context only, no causal claim.
- projectEngineeringMemory({tenant,revision}) extracts engineering facets exclusively from canonical evidence nodes data.engineeringRecord. Record ID is canonical node ID. Require partId/revision/provenance, node known time and record observedAt. Supplied tokens/vectors/material/process only; no OCR/CAD extractor. Reject dangling, cross-part or cyclic lineage eagerly. Similarity filters both query and candidates by knownAt. Cosine uses stable normalisation to avoid finite-component overflow; supplied vectors must be finite, nonzero and same-dimensional per comparison. Fixed nonnegative source weights (0.2/0.3/0.35/0.1/0.05), unknown signals excluded. No custom weights, learned store or mutation.

Test-first behaviors:
1. Existing canonical twin contract remains unchanged and its original4 tests run on official Node22.23.2.
2. Typed traversal accepts a real canonical revision, filters effective/known times, immutable snapshots and exact tenant/revision checks.
3. Actual out-of-order events hide late telemetry before observation, preserve replay when source objects mutate, reject duplicate/invalid event provenance and hide unknown anchor.
4. Evidence-backed engineering similarity yields hand-derived ordering/scores, scopes to known-at time; lineage stays within part and cycle rejection occurs before use; malformed and large finite vectors safely handled.
5. Projection input/output mutation cannot alter canonical source, cannot return authority or persist.

Verification artifact: run node --test for all lane01 *.test.cjs (new suite plus frozen4 regressions), retained raw red/green logs and exit codes. Later integration review: exact assembly/build, canonical source/role binding, source event/engineering facet producer contracts, limits/scale and application-specific hosted/security/rollback tests remain unproven. No caller should wire this batch before independent review/convergence admission.

Layout amendment after the initial22/22 source-contract run: faithful repository layout now uses implementation/runtime/twin-read-only-projections.cjs with the existing ./implementation-digital-twin.cjs import. Tests and unchanged dependency fixtures run at their real repository-relative paths. Original pre-mapping files/manifest remain nonshipping .snapshot archives. This is path mapping, not additional product behavior or state ownership; broad capability statuses remain IN_PROGRESS and admission locks null.
