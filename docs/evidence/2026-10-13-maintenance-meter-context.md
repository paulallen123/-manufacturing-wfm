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

## State and release limits

**TESTED as isolated contract only.** Source reference, revision and completeness are caller claims; the module cannot authenticate OPC UA/CMMS observations, validate engineering units, detect a legitimate meter reset, or infer machine health. The canonical machine schema decision in PR #377, trusted source adapter, graph mapping and exact-candidate proof remain open. No canonical integration, deployment, hosted or customer proof. A platform deployment of the current candidate would not include this branch.

Next: canonical owner reconciles PR #377's source schema decision, authenticates meter identity, units, revision/completeness and reset events, composes this context into the existing asset read model, and verifies it on the exact serving SHA through the approved release path.
