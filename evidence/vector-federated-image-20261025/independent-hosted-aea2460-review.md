# Independent hosted build verification

Reviewer: `/root/build_route_review`; sole integration owner remains `/root`; PR501. Read-only Railway retrieval, no jobs, edits, deployments or provider calls.

Verdict: the isolated successor build completed successfully and its observed installed-archive and authentication gates passed. This is admissible evidence of this exact build, not customer release or live Google/Apple verification.

- Deployment: `f61925bc-3718-48f6-89d6-137786b09afb`; Railway observed `SUCCESS`, updated 2026-10-25T13:09:02.720Z.
- Exact source: `aea2460194d824a9bfe1325298b96b4894478d2c`. Deployment metadata, current service source, installed gate expected SHA and final artifact-source equality command agree.
- Image digest: `sha256:68562ed3b8d9e1c024bb0db019212b38fb7aed065eebef1a55830b0dfca1d153`.
- OCI image configuration digest: `sha256:149ddd56b7c62c3753d49b68577fa6ab88729f2fb9c782b833716761f5799aac`. This is the image config digest, not a hash of Railway environment variables.
- Installed-archive gate: actual TAP 88 tests / 88 pass / 0 fail / 0 skip, followed by `VECTOR_INSTALLED_ARCHIVE_ADMISSION=PASS tests=88 skipped=0 required_cases=12` at 13:08:22.544060718Z. Logged command runs the existing verifier with `gosu node`, proof files root-owned/read-only, expected candidate SHA. Final stage checks admission marker and `/app/.wfm-build-source-sha` equality, confirms no `/proof`, removes marker.
- Authentication gate: actual Docker autonomy-proof 13/21 executed the new federated-auth, session-boundary and UI tests with existing passkey/workspace suites: 98 tests / 98 pass / 0 fail / 0 skip. Completion logged 13:00:18.897807271Z. Logs include unconfigured/expired Apple refusal, bounded Apple body, role/epoch/freeze/metadata/binding/expiry rejection, unavailable-verifier refusal and invitation isolation. These tests use synthetic provider fixtures.
- Healthcheck `/` passed at 13:09:00.755745573Z. Current start command is solely the receipt server: it compares artifact source SHA, Railway runtime SHA and reviewed expected SHA before listening. Receipt scope expressly excludes customer application and Golden Journey verification. Runtime logs only show Starting Container; no public receipt body was fetched, and deployment URL is null.
- Current service config is pinned to the same source with no staged changes. Only two variable names are present on this isolated service; no provider activation was performed. This read does not establish configurations on another customer service.

Remaining limitations: no customer runtime bootstrap/browser journey verified by this healthcheck; no external Google/Apple login, approved provider subject mapping, real invite, customer acceptance, provider mutation/readback or financial outcome proven. Full build logs contain other test groups with skips; the zero-skip claims above apply only to these two explicitly observed gates. Standard review, branch protection and authorized release process still apply. No formal merge approval is implied.

Sanitized exact log messages, deployment metadata without creator identity and current non-secret service config are retained in `independent-hosted-aea2460-evidence.json`.
