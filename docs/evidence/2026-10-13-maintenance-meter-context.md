# Maintenance meter/condition context: isolated package

## Requirement and ownership

Issue #202's maintenance target includes meter and condition signals. The asset design (`docs/superpowers/specs/2026-09-22-manufacturing-asset-decision-value-os-design.md`) requires tenant/site asset scope and source provenance. Current connector registry already names machine-state and maintenance-event targets. PR #377 owns research on the missing canonical machine asset projection schema. Before this package, open PR, branch and exact-path checks found no focused meter/condition context implementation. The sole canonical owner retains graph, connector, UI, integration and release authority. This package makes no graph, route, connector, writer, industrial-control or deployment change.

Base: `48dce8f697825c8cd5f99b3e5aeea3953647f8c2` (`release/vector-customer-ready-candidate-20260925`). Changed files:

- `operations/runtime/maintenance-meter-context.cjs`
- `operations/runtime/maintenance-meter-context.test.cjs`
- `.github/workflows/maintenance-meter-context-gate.yml`
- `docs/evidence/2026-10-13-maintenance-meter-context.md`

## Result and tests

The pure read-only evaluator accepts two ordered readings in one tenant/site/asset/meter/unit/kind scope alongside a caller-declared complete source revision. Both readings must be within the declared age bound. It rejects foreign, incomplete, stale, future, duplicate-time and unsafe numeric observations. A cumulative meter yields observed change; a decrease yields `RESET_OR_ROLLOVER_UNVERIFIED` with no usage delta. An instantaneous condition signal preserves only its latest source value, including valid negative readings. It derives no condition state, threshold breach, diagnosis, maintenance due state, cost, savings or action authority.

TDD red: the first test run failed because the module was absent (0 pass, 1 test file failure). After implementation and source scope binding, `node --test operations/runtime/maintenance-meter-context.test.cjs` passed 4/4 locally. Independent review found unbound meter kind and rejection of valid negative instantaneous readings, plus an unbounded first observation. Regression tests went red (1/4 passing); after correction, 4/4 passed locally and in pinned Node 22.23.2 Docker image `sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96`. Re-review found no remaining blocker for the isolated contract. Focused GitHub workflow is provided; remote run pending. No full forge suite was rerun for this independent pure module; it passed on the same base with the preceding aggregate productivity package.

### Snapshot-integrity repair, 2026-10-23

Independent exact-head review of `ec3b44d510696ac6556824995745e0f688ba6227` reproduced eight failures: caller-controlled iteration, mutable ambient array methods, repeated getter reads changing validated scope/provenance/timestamps/values, and missing machine-readable provenance boundaries. The repaired evaluator snapshots the outer request, scope, source, exact two-element readings array and both readings from ordinary enumerable own data descriptors before validation. Proxies, accessors, custom prototypes, sparse/custom-iterator arrays, hidden/Symbol/extra fields and unsafe values fail closed. Validation, calculation and publication use only the inert snapshot and engine-owned index traversal. The receipt remains immutable and explicitly reports `sourceAuthenticated:false`, `currentRevisionVerified:false`, `executionAuthority:false`, with no condition or maintenance-due claim.

Fail-first committed regression groups reproduced 4/7 pass and 3/7 fail on the predecessor. The first repair passed 7/7, but independent review blocked it after reproducing post-load intrinsic poisoning and inherited due/condition claims. Two additional fail-first groups reproduced 7/9 pass and 2/9 fail. Re-review closed those findings but found that mutable global string conversion could redirect both pair indexes to `0` and admit an inherited forged second reading; the next committed regression reproduced 9/10 pass and 1/10 fail. The successor captures required intrinsics once, uses fixed index keys and null-prototype internal pairs, builds both scope and top-level receipt as frozen null-prototype own-data records, and passed the committed suite 10/10 plus a separate adversarial suite for hidden/Symbol fields, sparse/custom-prototype arrays, live/revoked proxies and prototype setters (13/13 combined) on Node 24.19.0. Final independent re-review replayed the index/prototype exploit and found no remaining Critical or Important issue in the bounded contract. The historical Node 22/image result belongs to predecessor bytes and is not promoted; exact successor supported-runtime/image admission remains required.

## State and release limits

**TESTED as isolated contract only.** Source reference, revision and completeness are caller claims; the module cannot authenticate OPC UA/CMMS observations, validate engineering units, detect a legitimate meter reset, or infer machine health. The canonical machine schema decision in PR #377, trusted source adapter, graph mapping and exact-candidate proof remain open. No canonical integration, deployment, hosted or customer proof. A platform deployment of the current candidate would not include this branch.

Next: canonical owner reconciles PR #377's source schema decision, authenticates meter identity, units, revision/completeness and reset events, composes this context into the existing asset read model, and verifies it on the exact serving SHA through the approved release path.
