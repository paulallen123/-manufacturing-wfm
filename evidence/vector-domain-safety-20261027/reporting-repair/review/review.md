# Reporting authority correction — independent bounded review

Verdict: ACCEPT final two-file correction. Reviewer/task `/root/build_route_review`; integration owner `/root`; author `/root/backlog_reconcile`. Reviewed 2026-10-27 against supplied PR501 base `9fb494e040bf2c2641571a1bc8718623012caa2d`. No remote edits, cloud jobs, deployment or formal platform approval performed.

Exact reviewed service Git blob: `57e4fb5950de5900a6bfdf881ee8f36b247513be`, SHA256 `6d229146ce51ead2f627cb31375cf6ba2938510292f51fb19be198cd315a74b9`. Test blob: `84b0eb21b5a7d3009a89e9b89bfb8afddb45cb3f`, SHA256 `91efad3489844082de23e98a6beb1ee19bc90b98fc0025c7329058eff9fd250e`. repair.patch SHA256 `51ac19c8ef60dbbaa1f58cfc7cfda71703ecd9dfa587b2a73742bebf3a968600`; dry-run applies cleanly to the saved baseline service and test.

Security assessment:

- Identity snapshots copy only nonempty own primitive string email/tenant/role descriptors and freeze the result. Accessor and inherited identity fields do not establish authority. Unknown, boxed or coerced roles are rejected. Synchronous returned proxies are rejected before await, and resolved actors are checked again. Captured plain identity cannot change through an authorizer retaining its source object.
- Every refreshed identity must match the original principal's email and tenant. Principal passed to currentUserReader is itself frozen. External schedule authorization still performs fresh report access and final role/email/tenant equality checks. Tenant security freeze remains checked. No new external delivery authority is introduced.
- Private exact role membership replaces ordinal privilege inference: director retains audit/operational access without payroll; payroll_admin retains payroll/operational access without audit; admin/superuser retain both. Role export does not supply the policy decision.
- Public source/template records and their nested arrays are frozen. Catalog/source selection uses indexed traversal instead of caller-mutable filter/includes for policy decisions. Catalog result arrays remain detached, so consumer edits do not rewrite future catalog membership.

Independent verification: Node v22.23.2, final 34/34 tests passed, zero failures/skips/cancellations. This comprises 29 author tests plus five independent heldouts. Heldouts cover direct/revoked proxies and descriptor traps; boxed versus null-prototype primitive actors; frozen reader principal and cross-tenant refresh rejection; retained actor email/tenant changes during external authorization with zero deliveries; and public catalog mutation refusal with preserved role restrictions. Fixtures use synthetic SQLite state and synthetic adapters, without external provider calls.

Initial independent run was 31/32: direct returned Proxy.get('then') ran during await before the original proxy check, although the request still returned401. This did not demonstrate authority bypass. The author added the narrow pre-await proxy check and two regressions. The same unchanged five heldouts now pass. Initial evidence is preserved as initial-results.tap, final as results.tap; no false original-green claim.

Limits: trusted process and trusted currentUserReader/delivery adapter implementations are still required. The guard cannot undo Promise assimilation already executed inside an external async reader; arbitrary thenables/shared builtin replacement or arbitrary process code are not sandboxed. This review does not certify the entire pre-existing scheduler/external-write protocol, provider readback or financial claims. No complete image build, installed-runtime, browser, provider or customer proof was performed. Accepted scope is the exact reporting authority correction; integration/release gates remain the owner's responsibility.

Evidence: heldout.test.cjs, initial-results.tap, results.tap and hashes.json. No reviewed source was edited by the reviewer; only isolated review files were authored.
