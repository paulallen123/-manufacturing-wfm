# L7 maintenance reliability exact source/image admission

Proof-only continuation of draft PR #421, not canonical adoption. This package adds only this record and one scoped workflow. Product source, tests, Dockerfile, runtime, deployment, tenant/provider data, controllers and shared runner configuration remain unchanged.

## Immutable binding

- Repository: `paulallen123/-manufacturing-wfm`
- Proof branch: `proof/maintenance-reliability-image-5258e6e-20261017`
- Proof parent: current canonical `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`
- Target PR #421 head: `5258e6e84f08788e2eca87c605568cd31cc149a3`
- Target source-reviewed head: `8abb4793acf8026e6041dd4626dc23ce759a1172`; the target tip changes evidence text only
- Source blob: `b9f09f9274393f497d5c1182e1ae1b7c34630095`
- Test blob: `0fb14b6c6701bc97a4163a7e508244493d60a3e4`
- Unchanged Dockerfile blob: `a31e87448e6950906691c13d56ed6c9cc986bb55`
- Supported source and image Node: `22.23.2`

GitHub preflight refreshed PR/head/blobs, current base, matching proof branches and pull requests, proposed paths, latest visible #265/#288 ownership evidence and active/queued Actions. No competing maintenance-reliability proof branch, exact-target run, path collision or active Actions job was visible. Existing PR #421 source ownership and sole canonical integration/release ownership are preserved; hidden ownership cannot be certified.

## Evidence classes — do not collapse these states

| Class | Evidence / boundary |
| --- | --- |
| Built / source-reviewed | PR #421 records focused Node 24.19.0 and Node 22.23.3 suites at 18/18 after repair. Independent re-review of source head `8abb4793acf8026e6041dd4626dc23ce759a1172` found no remaining concrete Important/Medium defect and independently passed 18/18. Target tip `5258e6e84f08788e2eca87c605568cd31cc149a3` changes evidence text only; source/test bytes are bound above. |
| Supported-runtime source | This workflow checks immutable HEAD, reviewed source/test bytes and Dockerfile, exact Node 22.23.2, source and test syntax, and the exact affected test. Pending execution at authoring; require exact run/head/job/step evidence. |
| Image-build provenance | Build the unchanged target Dockerfile with `RAILWAY_GIT_COMMIT_SHA` bound to target; inspect final image ID, sealed SHA and Node version. Pending execution; never infer from a green source step. |
| Installed module | Final-image `/app/operations-runtime/maintenance-reliability-metrics.cjs` is checked for presence and exact SHA-256. Absence emits both the path and `SOURCE_IMAGE_ADMISSION_ONLY; MODULE_INSTALLATION_NOT_PROVEN`, not installed capability. The target Dockerfile does not reference this module. |
| Authenticated CMMS adapter | Not established. Expected source names, window completeness, revisions and record digests remain caller claims until a canonical authenticated adapter proves them. |
| Integrated consumer | Not established. The module is not wired to the canonical FORGE asset read path or reconciled with maintenance PRs #394/#415. Canonical-owner reconciliation and affected integrated regressions remain required. |
| Deployed-enabled behavior | Not established. No image push, deployment, enablement, production approval or runtime mutation is performed. |
| Customer proof | Not established. Synthetic tests are not customer evidence or measured reliability/value. Real intended-role, tenant/site/asset-scoped source readback, durable state, fresh-login, downstream and audit proof remain required. |

## Harness and safety

Push-only exact branch/workflow-path trigger; read-only contents permission; branch-scoped non-cancelling concurrency. An owner/repository/ref/event gate fails closed before immutable checkout. Actions are commit-pinned, credentials are not persisted, and an `always()` verdict rejects failed, skipped or cancelled prerequisites. Final-image inspection overrides startup with Node and runs networkless, read-only, non-root, capability-free, with no-new-privileges. It does not start the application or load/execute the optional maintenance-reliability module.

A green verdict means exact-target supported source and unchanged sealed-image admission only. It is deliberately compatible with an explicit missing-module result and cannot establish an authenticated CMMS adapter or installed, integrated, enabled or customer-proven maintenance reliability behavior. Run identity, terminal status and actual path result must be recorded in the draft PR handoff after observation; no unchanged failing run is rerun.

This read-only aggregation cannot establish source completeness, causal attribution, MTBF, MTTR, cost, savings or machine/OT authority. It performs no writer, work-order, controller, tenant/provider or customer action. Canonical integration, release, deployment and shared runner state remain with their existing owners.
