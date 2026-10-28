# 3Min integration base refresh — 25 October 2026

Existing PR509 only; integration PR501 and canonical release unchanged.

Parent donor 7ecd4fdc682ef9ffd2088456ed78b16cda7268fd. Refreshed base d94bafcb3b3fcf397a1900b2fce743d48631e112 includes source8931ab2abaa725aa60a8d97bb959110765ffb99f and evidence-only successor. Two overlapping files retain both federated-auth and 3Min bindings. No receiver or auth semantics changed in this merge.

Fresh Node22.23.2 results, exit0 and zero skips: authentication/receiver/UI106/106; composition contracts/workspace/real synthetic intake-readback-restart-tenant-isolation5/5. TAP retained here. Cached local dependencies; no Docker build or live provider/browser proof.

Independent /root/review_3min_refresh ACCEPT, no Critical/Important findings. Independently retrieved incoming overlap Git hashes match; removing five known 3Min Docker edits and one composer binding reconstructs incoming files; removing new federated bindings reconstructs published donor overlap blobs. All other11 incoming source files match Git blobs. Reviewer did not duplicate root tests.
Docker SHA2569991dd50d27fbff6879e889bbf902c80fd03ef021635056ad23910a87b39f03a; composer03349d5eb57c931a8e75fe9445d3b6ad4b6b74823ed3a0df3d74e990bd895f5f.

Full source tree comparison against8931 base: exactly33 original donor paths, no missing base files or unexpected donor changes. Later d94b update changes only seven documentation/evidence paths, all copied by exact Git SHA. No proof is transferred from prior image to this merge.

Live readback: customer has noWFM_3MIN variables or staged patch; latest attempted deploymentd9112b19 remainsFAILED (not proof of outage). 3Min endpoint01a16a4d-c707-7e24-8a5c-3f0e1fc4d59c active in both environments but webhook URLs/auth values absent. No provider or customer mutation.

Remaining: release adoption/current image/formal review, exact tenant/site/source authority and credentials, dashboard webhook authentication, provider mapping/consumer and actual hosted delivery/recovery/customer proof. Browser sign-in remains unresolved from last observation. No additional product/controller/service created.
