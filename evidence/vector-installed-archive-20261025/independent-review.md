# Independent installed archive build verification

Reviewer: /root/build_route_review. Read-only remote verification of the existing authorized Railway job; no mutation or duplicate build. Local evidence files written at integration owner's request.

## Verdict

PASS for the exact installed-archive build admission scope of source 5d8b3f11fe04a09b63f258c34bbb8b9568942859, deployment 1e1dafcd-176d-4aea-a76d-6833fd02df35. Railway terminal SUCCESS at 2026-10-25T02:23:20.517Z. This is not formal merge approval or customer release.

Image sha256:b75a2110ecc558946f237705cd6150b2086a4eed2f8bbe93275d44a89c44336d; image config sha256:4528bb2d29a5dbdfd54a52563342d081fae43c0a9a44129cd743b679e80f3207.

## Actual evidence

- Setup-only source packaging regression passed 2026-10-25T02:11:37.189064888Z; workspace compiler composition passed 02:15:32.253268703Z.
- The broad source suite reported 1599 pass, zero failures/skips. The earlier installed broad suite remains 679 pass/12 skip; it is not relabelled.
- The distinct post-hardening installed-archive stage executed the unchanged verifier as gosu node, checked the pinned archive checksum, installed byte comparisons and exact source identity.
- Its complete TAP reports 88 tests, 88 pass, zero fail/cancel/skip/todo. All nine direct/observe-only/trusted-proxy session cases, two actor cases and one sealed producer permission/audit case passed. Gate marker emitted 02:22:49.768074590Z.
- The final runtime stage copied the successful marker, compared it and /app/.wfm-build-source-sha to the exact candidate, checked /proof absence and removed the marker. This executed before the image digest was emitted.
- Configured source, provider-reported source and receipt expected SHA match. Seven relevant source/build/test/verifier Git blob IDs match the reviewed versions; recursive tree read was untruncated.
- Railway's / healthcheck passed 02:23:18.691843606Z. This is the existing isolated receipt server, not customer application health. Response body was not fetched independently.

## Limits

Installed bridge/contract modules were tested with pinned archive actor/producer code and synthetic temporary state. These are not real-provider/customer operations. Full hosted customer bootstrap, authenticated setup wizard, durable restore/recovery, provider writes/readback, financial outcomes and customer acceptance remain unproven by this run. Previous failed builds and skipped blocks retain their original status. No proof transfers to later evidence-only commits as a new image SHA.

The saved logs are selected actual Railway records, not a complete build log: timestamps/messages retained; redundant encoded attributes and creator account identity omitted; ANSI colors removed. installed-archive.tap is the complete exact message text of the installed gate's TAP record, without invented output. Hashes cover saved bytes.
