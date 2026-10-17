# L11 hybrid resource exact source/image admission

Proof-only continuation of draft PR #362, not canonical adoption. This package adds only this record and one scoped workflow. Product source, tests, Dockerfile, runtime, deployment, tenant/provider data, controllers and shared runner configuration remain unchanged.

## Immutable binding

- Repository: `paulallen123/-manufacturing-wfm`
- Proof branch: `proof/hybrid-resource-image-36bd93b-20261017`
- Proof parent: current canonical `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`
- Target PR #362 head: `36bd93bd5d3dffb4c33768bbf3ca86fd0af601b4`
- Target parent: historical `90ad90fcf60adaca9abacdd4ad14bf392f95e585`, not current canonical
- Source blob: `63d5d52432e4ded3c6238d016cdd3871833701fe`
- Test blob: `3426bfad13350f619d54c9b58d26e9e60a2486b2`
- Unchanged Dockerfile blob: `a31e87448e6950906691c13d56ed6c9cc986bb55`
- Supported source and image Node: `22.23.2`

GitHub preflight refreshed PR/head/blobs, current base, all three open-PR inventory pages, matching proof branches, proposed paths, latest #265/#288 ownership evidence and active/queued Actions. No competing hybrid-resource proof branch, exact-target run, path collision or active Actions job was visible. Product ownership and sole canonical integration/release ownership are preserved; hidden ownership cannot be certified.

## Evidence classes — do not collapse these states

| Class | Evidence / boundary |
| --- | --- |
| Built / source-reviewed | Author baseline 31/31; new regression RED; exact repaired source 32/32. Independent exact-source review [5497891946](https://github.com/paulallen123/-manufacturing-wfm/pull/362#pullrequestreview-5497891946): READY, no Critical/Important/Minor findings. Existing source evidence used Node 24.19.0. |
| Supported-runtime source | This workflow checks immutable HEAD, reviewed source/test bytes and Dockerfile, exact Node 22.23.2, syntax, hybrid-resource and Decision Episode suites. Pending execution at authoring; require exact run/head/job/step evidence. |
| Image-build provenance | Build the unchanged target Dockerfile with `RAILWAY_GIT_COMMIT_SHA` bound to target; inspect final image ID, sealed SHA and Node version. Pending execution; never infer from a green source step. |
| Installed module | Final-image `/app/operations-runtime/hybrid-resource-shadow.cjs` is checked for presence and exact SHA-256. Absence emits `MODULE_INSTALLATION_NOT_PROVEN`, not installed capability. Existing Dockerfile tests the module in its discarded proof stage but does not explicitly copy it into final operations runtime. |
| Integrated consumer | Not established. Canonical-owner reconciliation and affected integrated consumer/reconciliation regression remain required. |
| Deployed-enabled behavior | Not established. No image push, deployment, enablement, production approval or runtime mutation is performed. |
| Customer proof | Not established. The 1,100-case synthetic benchmark is not customer evidence or measured benefit. Real intended-role/backend/durable-state/fresh-login/downstream/audit proof and applicable security, tenant, payroll, browser, recovery, scale and combined Golden Journey gates remain required. |

## Harness and safety

Push-only exact branch/workflow-path trigger; read-only contents permission; branch-scoped non-cancelling concurrency. An owner/repository/ref/event gate fails closed before immutable checkout. Actions are commit-pinned, credentials are not persisted, and an `always()` verdict rejects failed, skipped or cancelled prerequisites. Final-image inspection overrides startup with Node and runs networkless, read-only, non-root, capability-free, with no-new-privileges. It does not start the application or load/execute the optional hybrid-resource module.

A green verdict means exact-target supported source and unchanged sealed-image admission only. It is deliberately compatible with an explicit missing-module result and cannot establish installed, integrated or enabled hybrid-resource functionality. Run identity, terminal status and actual path result must be recorded in the draft PR handoff after observation; no unchanged failing run is rerun.

Human and automated-resource semantics stay distinct. Advisory/shadow-only boundaries remain: no robot/machine command, OT write, qualification award, authenticated authority, customer/tenant/provider action or production authority. Canonical integration, release, deployment and shared runner state remain with their existing owners.
