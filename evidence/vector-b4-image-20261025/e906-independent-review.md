# Independent exact-image admission — e906c10b

Reviewer `/root/build_route_review`; sole integration owner `/root`; existing PR501. Read-only Railway inspection, no jobs triggered/cancelled, no deployment/configuration changes.

Verdict: observed isolated build admission succeeded for exact source b4a2582c59ccf1c2618274b16e569870fd9b3517. This evidence belongs only to that source and image. The prepared three-file logging delta is not in this image and receives no transferred admission.

Deployment e906c10b-1f64-43cd-b487-da16264a5f53 is SUCCESS, updated2026-10-25T21:02:59.783Z, project9cd73309-0ece-4b9a-891f-7daa13d94f0d/service845b5dcc-9c95-42cf-95fb-5719e96511f2/environment9e7875b6-e214-4c32-9cee-81235e3d49ff. Deployment metadata, live service source, non-root installed gate and final artifact SHA comparison all bind b4a2582.

Image digest sha256:e00d867daf78ef512d306867333850a5d8c559dad0bbc263388b6e8bc247e36d. OCI image config digest sha256:87787213eab88cb8958e6a5a5c84af8e82962509f89fb07477c81534f35684f1. Image config digest is not a Railway environment-variable hash.

Actually executed gates retrieved independently:

- Auth/federation:99/99 passed,0 failed/skipped/cancelled; summary20:55:37.920631950Z and completed Docker step13/21.
- Staffology:327/327 passed,0 failed/skipped/cancelled at20:57:06.818637773Z. Actual full HTTP journey case250 passed in16.4105s and is explicitly a simulated provider write across restart, not external provider proof.
- Source group:1599/1599 passed,0 failed/skipped/cancelled at20:58:15.119956511Z.
- Broad installed suite:691 tests,679 passed,12 skipped,0 failed. Those skips remain distinct and must not be hidden by other zero-skip gates.
- Separate installed-archive gate:88/88 passed,0 skipped/failed/cancelled, required_cases12; marker21:02:22.572891032Z. Sealed archive checksum OK; command runs with gosu node after root-owned read-only proof files. Final stage checks marker and /app source SHA equality, removes marker and verifies no /proof.

Healthcheck '/' succeeded21:02:57.632554713Z. The inspected start command remains only the artifact/runtime/expected-SHA receipt server and expressly excludes customer application/Golden Journey. Thus health establishes receipt service readiness, not customer bootstrap, provider sign-in or accessible setup wizard. No public deployment URL was returned. No provider/customer proof, external mutation/readback or financial outcome inferred.

Other same-source builds b39f0232 and bc3b835a were still reported BUILDING at this independent read. They may later affect service state; owner must reconcile their actual terminal outcomes and serving identity. They were not launched, cancelled or modified by this review. Current service config had no staged changes. Earlier failed builds and missing-log diagnosis remain historical failures; this success does not establish their root cause or certify startup reliability under all conditions. Existing release/security reviews and customer rollout approvals remain applicable; no formal merge approval implied.
