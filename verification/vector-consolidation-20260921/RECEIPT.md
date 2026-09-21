# Existing Vector release candidate consolidation

Status: BUILT. This is the continuation of PR #220, not a second product, branch or architecture.

Source base: 5362ed539ae71b7d7138fff650d0f9417ed8a1f3 (existing integrated engine, workflow, attendance and security repairs). Approved five-section presentation selected from b96ebaab7d266825d2cfadfe05a151c7af565131 (#221): Today, People, Plan, Factory, Improve. Selected route preservation, employee self-service and narrow source-guard corrections from 66715f091653494911437b819d5e97417a0c04ce (#222); its competing ten-section navigation is not retained. Exact-source admission and provenance work from 062be562d0592be608959aa858ac889f8d0f8cec (#207) is retained and extended to the workflow controller and workflow CSS. Archived security-hold source is not rewritten.

Reproduced defects before repair: invalid cost coercion, unreachable authorised section routes, employee home replaced by manager dashboard, inaccessible review detail, stale asynchronous evidence overwriting refreshed results, missing runtime dependency in both Docker and local composition, retained retired assets, and provenance coverage incompatible with the integrated workflow assets.

Executed on Node v22.16.0 against SHA-verified materialised source: 19 targeted tests passed, zero failures/skips. Scope: actual Vector helper logic in a minimal DOM harness, real local HTTP retirement routing, composition fixtures and byte-provenance adversarial tests. This is not a browser, full engine, Docker or deployed-customer proof. The added role-change test rejects an in-flight manager response after employee scope becomes active.

Repeat targeted checks:

    node --test tests/vector-consolidation.test.cjs tests/vector-runtime-packaging.test.cjs scripts/compose-vector-presentation.regression.test.mjs scripts/prove-vector-built-asset-provenance.test.mjs

The existing Dockerfile now also requires the repository/source guards and all new tests, the existing full local engine proof on the pinned Node v22.23.2 runtime, and exact final asset provenance. Existing security, attendance, payroll, immutable artifact and non-root runtime safeguards remain. A local pass does not waive these gates.

Release restrictions remain: preserve and restore-verify live SQLite before restart or promotion; establish durable storage and authorised session; run the full exact-source build; execute repeatable deployed browser/role/tenant/Golden Journey proof. Owner recovery remains unprovisioned; no credential change or security-hold removal is authorised by this receipt. Previous isolated engine evidence is historical, not a fresh pass of this combined candidate.
