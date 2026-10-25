# Missing buffered TAP diagnosis — cdc12c32

Diagnoser: `/root/build_route_review` (author of the startup diagnostics; not an independent review of that change). Same PR501, source b4a2582c59ccf1c2618274b16e569870fd9b3517. No source edits, remote builds or configuration changes.

Observed Railway facts: deployment cdc12c32-33a7-4d57-bbb7-26a2ed63f675 FAILED. Autonomy-proof19 began20:28:40.800839392Z. Setup tests78/78 completed20:28:42.688Z. The next retrieved event is the entire shell command failing exit1 at20:28:57.147921235Z. No Staffology TAP, summary or newly added startup diagnostic is present in the queried interval. This does not identify which test failed, whether cat ran, or whether provider log transport discarded output. Do not carry forward the preceding build's full-HTTP failure as this build's established cause.

Reproductions using actual Node22.23.2:

- Copied only the unchanged current diagnostic test and sibling full-HTTP source into a Docker-like directory layout; executed with env -i and only PATH/HOME. Diagnostic fixtures4/4 passed. This extraction uses __dirname sibling resolution, built-in modules and an explicit VM context; no need for actual /proof paths or inherited variables was found.
- Executed the entire current Staffology command through /bin/sh with the same set+e, redirected TAP, status capture, cat and exit structure, against the fresh exact runtime from prior diagnosis:327/327 passed,0 skipped,12.207s. Buffered TAP and emitted wrapper output match byte-for-byte at78,024bytes.
- Controlled command exits0,1 and137 all emitted their buffered content and preserved the exact exit status under the same wrapper structure. A normal Node test failure alone cannot explain omission of the subsequent cat output under these tested shell semantics.

Hypotheses, none established as root cause:

1. A real test failed and its buffered stdout was dropped or unavailable through the provider logging path. The test runs for roughly the observed interval and the shell's final1 is compatible with an ordinary test failure, but no failing TAP is available. This remains an inference, not proof.
2. Shell/container interruption or resource failure prevented cat. No OOM, signal or termination evidence was returned; command exit1 is not itself proof of OOM.
3. mkdir/cp/redirect/artifact I/O failed before/around tests. Those shell operations are outside or before buffered Node execution and should normally expose their errors; none were returned. The interval alone cannot exclude this.
4. Diagnostic fixture behavior differs under the actual image. Restricted-layout and full-group reproduction give contrary local evidence; no specific fixture defect reproduced.

Logging assessment: upstream BuildKit log implementation documents a default2MiB step cap and200KiB/s allowance, emits a clipping marker and retains a tail. Retrieved step19 output before the gap is18,712characters, max individual message1,773characters, and no clipping marker. Local full TAP is78KiB. Therefore default upstream step-size clipping is not supported by the observed volume. Railway's actual builder version/configuration/collector limits are unknown; per-message truncation or loss is not ruled out. Primary code inspected: https://github.com/moby/buildkit/blob/master/util/progress/logs/logs.go . No provider setting was changed.

Next useful diagnostic, if root chooses a source change: emit small fixed stage markers before invoking tests and after wait/status capture; print captured exit status, byte count and a bounded sanitized failure/TAP summary to stderr before replaying the full retained TAP. Use a tested chunked/line emitter if the collector loses large writes, preserve the original status exactly, and keep full private evidence. This adds observability; it must not claim to repair the hidden failing test. Do not alter startup timeout, auth behavior or test acceptance. Existing exact-image admission is still failed/blocked until an authorized successor succeeds.

Files: restricted-layout.tap; buffered.tap; wrapper-output.tap; shell-controls.json; observed-log-gap.json. Source/runtime unchanged. Local proof is synthetic and no provider/customer calls were made.
