# Independent trust review: exact published sources

PR #292 head: `502b8d45e11b8f8cfe9905d7cc06bf5890ef72a2`; PR base: `f32ca1a2672d47dcff8ef6cd1c3d71c77cf60560`.
Published review transport: `93513c250e3f0105a1fd019bf63a5a1674970b98`, whose actual parent is `f32ca1a2672d47dcff8ef6cd1c3d71c77cf60560`.
These are sibling commits. PR #292 reports mergeable=false / dirty; its review does not approve the 935 transport or an unpublished native delta.

**Disposition: repair required.** Static review confirms 7 P1 and 4 material P2 defects in both published sources. Adapter and production-boundaries contents are identical at both SHAs. The first three PR threads are marked outdated but remain unresolved and their defects remain in the bytes. All ten latest threads are unresolved/non-outdated on PR #292.

**Qualified execution update:** after the initial static review, the root supplied checksum-verified official Node 22.23.2 and a verified exact-935 source extraction. Held-outs executed 10 tests: 4 controls passed, 6 safety invariants failed, 0 skipped, reproducing TR-01/TR-02/TR-03/TR-06/TR-07. Three relevant repository suites passed 26/26, 0 skipped. Details and limits are in `behavioral-review.md` and `behavioral-verification.json`; raw TAP is retained here. No external provider requests, GitHub writes, browser/live-tenant actions, or product edits occurred. No supported-container, CI, deployment, hosted or customer proof pass is asserted. Other findings remain static-review-only.

## TR-01 P1: Pre-dispatch recovery tries to replace immutable baseline

[PR source integrations/staffology/staffology-adapter.cjs:352](https://github.com/paulallen123/-manufacturing-wfm/blob/502b8d45e11b8f8cfe9905d7cc06bf5890ef72a2/integrations/staffology/staffology-adapter.cjs#L352) · [Published review source:352](https://github.com/paulallen123/-manufacturing-wfm/blob/93513c250e3f0105a1fd019bf63a5a1674970b98/integrations/staffology/staffology-adapter.cjs#L352) · [Existing thread](https://github.com/paulallen123/-manufacturing-wfm/pull/292#discussion_r4161418423)

After a baseline is recorded, fail authorization before dispatch reservation. After lease expiry, recover() calls reconcile()->startDispatch(), which records a fresh baseline with a different observedAt. recordEvidence rejects the changed digest (boundaries line 59), so all later recovery attempts fail STAFFOLOGY_EVIDENCE_CONFLICT even with identical financial snapshots.

Repair boundary: Reuse the original immutable baseline while explicitly verifying fresh observations remain an equivalent safe replacement baseline; never replace it merely to refresh its timestamp.

## TR-02 P1: Definite provider authentication rejection can become acknowledged

[PR source integrations/staffology/staffology-adapter.cjs:383](https://github.com/paulallen123/-manufacturing-wfm/blob/502b8d45e11b8f8cfe9905d7cc06bf5890ef72a2/integrations/staffology/staffology-adapter.cjs#L383) · [Published review source:383](https://github.com/paulallen123/-manufacturing-wfm/blob/93513c250e3f0105a1fd019bf63a5a1674970b98/integrations/staffology/staffology-adapter.cjs#L383) · [Existing thread](https://github.com/paulallen123/-manufacturing-wfm/pull/292#discussion_r4161418429)

Return 401/403 for the reserved POST while baseline/readback already equal intended £12.50. request raises STAFFOLOGY_AUTH_REJECTED; startDispatch only marks uncertain and continues. reconcile accepts unchanged desired amounts and persists acknowledged. The diff explicitly removes the earlier authentication special case. Durable recovery also needs to preserve definitive rejection rather than manufacture a write acknowledgement.

Repair boundary: Persist definitive rejection distinctly and prevent initial or successor reconciliation from acknowledging that rejected write.

## TR-03 P1: Environment SHA overrides independent image seal

[PR source integrations/staffology/canonical-operations.cjs:16](https://github.com/paulallen123/-manufacturing-wfm/blob/502b8d45e11b8f8cfe9905d7cc06bf5890ef72a2/integrations/staffology/canonical-operations.cjs#L16) · [Published review source:20](https://github.com/paulallen123/-manufacturing-wfm/blob/93513c250e3f0105a1fd019bf63a5a1674970b98/integrations/staffology/canonical-operations.cjs#L20) · [Existing thread](https://github.com/paulallen123/-manufacturing-wfm/pull/292#discussion_r4161418437)

With actual image seal A, set WFM_BUILD_SOURCE_SHA and operation profile candidateSha to B. loadConfiguration never reads the sealed file when the environment value exists, so it activates a B-bound payroll operation on A bytes. Docker independently writes /app/.wfm-build-source-sha; this operation gate bypasses it.

Repair boundary: Read and validate the independent image seal; reject environment/profile mismatches. Limit an environment-only proof fallback to a genuinely missing seal under an explicitly permitted proof mode.

## TR-04 P1: Recovery cannot replace or reuse unconsumed approval

[PR source integrations/staffology/canonical-production-boundaries.cjs:66](https://github.com/paulallen123/-manufacturing-wfm/blob/502b8d45e11b8f8cfe9905d7cc06bf5890ef72a2/integrations/staffology/canonical-production-boundaries.cjs#L66) · [Published review source:66](https://github.com/paulallen123/-manufacturing-wfm/blob/93513c250e3f0105a1fd019bf63a5a1674970b98/integrations/staffology/canonical-production-boundaries.cjs#L66) · [Existing thread](https://github.com/paulallen123/-manufacturing-wfm/pull/292#discussion_r4163408936)

First authorizeWrite issues an approval; revoke current permission before request authorization/dispatch. No dispatch is reserved, but approval remains. A successor approvedCoordinator resets approvalId=null and issues the identical permit digest. UNIQUE(permit_digest) at line 25 makes insertion fail even after baseline recovery is repaired; expiration/revocation alone does not remove the uniqueness conflict.

Repair boundary: Atomically reuse a valid exact unconsumed approval or replace/revoke it under current exact-person authority; retain one-shot and tenant/binding checks.

## TR-05 P1: Supported operator recovery has no intent digest

[PR source integrations/staffology/canonical-operations.cjs:33](https://github.com/paulallen123/-manufacturing-wfm/blob/502b8d45e11b8f8cfe9905d7cc06bf5890ef72a2/integrations/staffology/canonical-operations.cjs#L33) · [Published review source:37](https://github.com/paulallen123/-manufacturing-wfm/blob/93513c250e3f0105a1fd019bf63a5a1674970b98/integrations/staffology/canonical-operations.cjs#L37) · [Existing thread](https://github.com/paulallen123/-manufacturing-wfm/pull/292#discussion_r4163408945)

Cause an ambiguous POST/readback. Delivery result only includes deliveryId (adapter 437); uncertain replay only includes deliveryId/status (429). The recovery route requires a digest exact match but neither delivery result nor status returns the mapped-payload digest. UI demands manual digest input (502 UI 233/244; 935 UI 237/248), leaving an ordinary operator without the required value.

Repair boundary: Return an opaque exact-bound recovery capability/digest with uncertain results or resolve and verify the stored digest from deliveryId server-side; make the UI retain/use it.

## TR-06 P1: Persisted approval is bound to reusable email rather than person ID

[PR source integrations/staffology/canonical-production-boundaries.cjs:36](https://github.com/paulallen123/-manufacturing-wfm/blob/502b8d45e11b8f8cfe9905d7cc06bf5890ef72a2/integrations/staffology/canonical-production-boundaries.cjs#L36) · [Published review source:36](https://github.com/paulallen123/-manufacturing-wfm/blob/93513c250e3f0105a1fd019bf63a5a1674970b98/integrations/staffology/canonical-production-boundaries.cjs#L36) · [Existing thread](https://github.com/paulallen123/-manufacturing-wfm/pull/292#discussion_r4163408966)

Issue a permit for person A with email E. Before consumption resolve E to replacement person B with both permissions. issue validates A.personId but stores only approved_by=email; check accepts any nonempty current personId at E. B can consume A's exact payroll approval.

Repair boundary: Persist approved person ID with the permit and require exact current tenant/email/person match at check and consume; fail closed for legacy rows without this binding.

## TR-07 P1: Employee PII is persisted after account authority is revoked

[PR source integrations/staffology/canonical-operations.cjs:30](https://github.com/paulallen123/-manufacturing-wfm/blob/502b8d45e11b8f8cfe9905d7cc06bf5890ef72a2/integrations/staffology/canonical-operations.cjs#L30) · [Published review source:34](https://github.com/paulallen123/-manufacturing-wfm/blob/93513c250e3f0105a1fd019bf63a5a1674970b98/integrations/staffology/canonical-operations.cjs#L34) · [Existing thread](https://github.com/paulallen123/-manufacturing-wfm/pull/292#discussion_r4163408986)

Begin acquisition with current permissions, then remove a required permission or replace principal during awaited pagination/detail requests. acquireAndStage only calls permitted before reads; after acquisition it stages with the original actor snapshot. The 935 mapping/connector preflight is also before reads. Bridge stageEmployeeAcquisition and composed stagePeople resolve connector scope but do not resolve the current user, so persistence/audit still occurs after revocation.

Repair boundary: Re-resolve the exact current person authority immediately before the synchronous staging/persistence boundary, retaining connector/cohort/mapping checks.

## TR-08 P2: Bounded successful provider reads outlast the fixed lease

[PR source integrations/staffology/canonical-production-boundaries.cjs:66](https://github.com/paulallen123/-manufacturing-wfm/blob/502b8d45e11b8f8cfe9905d7cc06bf5890ef72a2/integrations/staffology/canonical-production-boundaries.cjs#L66) · [Published review source:66](https://github.com/paulallen123/-manufacturing-wfm/blob/93513c250e3f0105a1fd019bf63a5a1674970b98/integrations/staffology/canonical-production-boundaries.cjs#L66) · [Existing thread](https://github.com/paulallen123/-manufacturing-wfm/pull/292#discussion_r4163408951)

Operations accept timeoutMs up to 30000 but createStore gets its default 60000 lease. observe performs three sequential GETs (adapter 321–330); 25s successful responses each expire ownership before recordEvidence. No renewal path exists. A successor receives the same lease and repeats the failure. Even the whole baseline+POST+readback sequence can exceed 60s with requests below the default timeout.

Repair boundary: Renew ownership safely while provider work is in flight or size and bound the lease for the full guarded operation; preserve fencing and prohibit old-owner dispatch.

## TR-09 P2: Recovery dispatch omits the consumed approval from audit

[PR source integrations/staffology/canonical-operations.cjs:33](https://github.com/paulallen123/-manufacturing-wfm/blob/502b8d45e11b8f8cfe9905d7cc06bf5890ef72a2/integrations/staffology/canonical-operations.cjs#L33) · [Published review source:37](https://github.com/paulallen123/-manufacturing-wfm/blob/93513c250e3f0105a1fd019bf63a5a1674970b98/integrations/staffology/canonical-operations.cjs#L37) · [Existing thread](https://github.com/paulallen123/-manufacturing-wfm/pull/292#discussion_r4163408973)

Recover an expired row that failed before any baseline/approval. reconcile may perform its first POST and consume newly issued approval. approvedCoordinator.recover returns only reconcile result, dropping closure approvalId; operation recovery audit records only deliveryId/status/code. The consequential write cannot be linked to its one-shot authority.

Repair boundary: Propagate the actual approval ID for recovery dispatch and record it in recovery audit, distinguishing read-only reconciliation from a new dispatch.

## TR-10 P2: A lost staging response makes retry create a second batch

[PR source ux-overlay/vector-shell.js:240](https://github.com/paulallen123/-manufacturing-wfm/blob/502b8d45e11b8f8cfe9905d7cc06bf5890ef72a2/ux-overlay/vector-shell.js#L240) · [Published review source:244](https://github.com/paulallen123/-manufacturing-wfm/blob/93513c250e3f0105a1fd019bf63a5a1674970b98/ux-overlay/vector-shell.js#L244) · [Existing thread](https://github.com/paulallen123/-manufacturing-wfm/pull/292#discussion_r4163408991)

Let acquisition commit its staged batch, then lose the HTTP response. User retries unchanged reviewed mappings. Each click sends crypto.randomUUID(), so the integration store treats it as a new request and creates duplicate staged batches/audit rather than returning the committed one. This persists in the 935 labelled-mapping UI.

Repair boundary: Retain one idempotency key for the reviewed intent across ambiguous network failures; rotate only when the reviewed intent changes or a definitive outcome permits it.

## TR-11 P2: First proof export changes the second exact-source Docker context

[PR source .circleci/config.yml:49](https://github.com/paulallen123/-manufacturing-wfm/blob/502b8d45e11b8f8cfe9905d7cc06bf5890ef72a2/.circleci/config.yml#L49) · [Published review source:49](https://github.com/paulallen123/-manufacturing-wfm/blob/93513c250e3f0105a1fd019bf63a5a1674970b98/.circleci/config.yml#L49) · [Existing thread](https://github.com/paulallen123/-manufacturing-wfm/pull/292#discussion_r4163408978)

Build 1 writes exported proof/log files under circleci-runtime-artifacts in the checkout. Build 2 uses '.' and Docker autonomy stage COPY . ./ (line 6). Without excluding those artifacts, the second context differs from the checked-out candidate and invalidates the proof cache; runtime-image-build.log is itself created while context is prepared. The config is identical at 502 and 935.

Repair boundary: Export/log outside the checkout or expressly exclude artifact/log paths from the Docker context while retaining private evidence custody.

## Qualified closure

The held-mapping editing/apply dead end (#4163409001) remains in 502 but is addressed by the 935 UI's held reasons, restage control and eligible-only Apply. It is excluded from current-candidate open findings. The minor generic-error-message thread remains but is excluded from this material-risk list.

The latest unpublished native 1a98bb6 delta was not accessible in the published commit review and has not been approved by this lane. Parent owns transport identity, deployment and remaining proof gates. Required repairs should return to the existing sole source owner; this lane did not implement them.
