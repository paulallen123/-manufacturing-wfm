# L7 maintenance meter context exact source/image admission

Proof-only continuation of draft PR #449, not canonical adoption. This package adds only this record and one scoped workflow. Product source, tests, Dockerfile, runtime, deployment, tenant/provider data, controllers and shared runner configuration remain unchanged.

## Immutable binding

- Repository: `paulallen123/-manufacturing-wfm`
- Proof branch: `proof/maintenance-meter-context-image-ec3b44d-20261017`
- Proof parent: current canonical `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`
- Target PR #449 head: `ec3b44d510696ac6556824995745e0f688ba6227`
- Source blob: `2bb001cb64da4709560799e5e79fc3465e32a1b3`
- Test blob: `f68a0958960f1180d054a265c0307763162be8b5`
- Unchanged Dockerfile blob: `a31e87448e6950906691c13d56ed6c9cc986bb55`
- Supported source and image Node: `22.23.2`

GitHub preflight refreshed PR/head/blobs, current base, matching proof branches and pull requests, proposed paths, indexed ownership evidence and active/queued Actions immediately before publication. No competing maintenance-meter-context proof branch, exact-target image run, path collision or active Actions job was visible. The #265 comments endpoint was incomplete, so exhaustive off-platform ownership visibility is not claimed. Existing PR #449 source ownership and sole canonical integration/release ownership are preserved.

## Evidence classes — do not collapse these states

| Class | Evidence / boundary |
| --- | --- |
| Built / source evidence | PR #449 records focused local tests and independent re-review of the isolated contract. Existing exact-head source run `38434751485`, job `115425716804`, used Node 22.23.2 and passed 4/4. There is no formal GitHub source-review object; preserve that caveat. |
| Supported-runtime source | This workflow checks immutable HEAD, reviewed source/test bytes and Dockerfile, exact Node 22.23.2, source and test syntax, and the exact focused test. Pending execution at authoring; require exact run/head/job/step evidence. |
| Image-build provenance | Build the unchanged target Dockerfile with `RAILWAY_GIT_COMMIT_SHA` bound to target; inspect final image ID, sealed SHA and Node version. Pending execution; never infer from a green source step. |
| Installed module | Final-image `/app/operations-runtime/maintenance-meter-context.cjs` is checked for presence and exact SHA-256. Absence emits both the path and `SOURCE_IMAGE_ADMISSION_ONLY; MODULE_INSTALLATION_NOT_PROVEN`, not installed capability. |
| Authenticated CMMS/MES provenance | Not established. Source reference, revision, completeness, observations, engineering units and reset/rollover evidence remain caller claims until a canonical authenticated adapter proves them. |
| Integrated consumer | Not established. The module is not wired to a canonical asset/maintenance consumer or reconciled with the selected machine schema. Canonical-owner reconciliation and affected integrated regressions remain required. |
| Deployed-enabled behavior | Not established. No image push, deployment, enablement, production approval or runtime mutation is performed. |
| Customer proof | Not established. Synthetic tests are not customer evidence or measured maintenance benefit. Real intended-role, tenant/site/asset-scoped source readback, durable state, fresh-login, downstream and audit proof remain required. |

## Harness and safety

Push-only exact branch/workflow-path trigger; read-only contents permission; branch-scoped non-cancelling concurrency. An owner/repository/ref/event gate fails closed before immutable checkout. Actions are commit-pinned, credentials are not persisted, and an `always()` verdict rejects failed, skipped or cancelled prerequisites. Final-image inspection overrides startup with Node and runs networkless, read-only, non-root, capability-free, with no-new-privileges. It does not start the application or load/execute the optional maintenance meter context module.

A green verdict means exact-target supported source and unchanged sealed-image admission only. It is deliberately compatible with an explicit missing-module result and cannot establish an authenticated CMMS/MES adapter or installed, integrated, enabled or customer-proven maintenance behavior. Run identity, terminal status and actual path result must be recorded in the draft PR handoff after observation; no unchanged failing run is rerun.

This read-only context evaluator and proof cannot establish canonical integration, enabled consumer behavior, authenticated CMMS/MES provenance, deployment, measured maintenance benefit, machine/OT authority or customer proof. It performs no writer, work-order, controller, tenant/provider or customer action. Canonical integration, release, deployment and shared runner state remain with their existing owners.
