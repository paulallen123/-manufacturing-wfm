Independent review of native bf9f70e21364f00465a3bad40be6ffb1d1b732ac

Hold publication: two material P2 evidence/outcome defects remain. Raw243-byte commit hashes to bf9; all1107 blobs/modes recompute treef386ab2f4726f8818848c15fcb3b4b1e44426b08; parentdb041fe7f9c0bddbf53e637184548285849e5f74. Exactly five paths differ from verified695:
- integrations/staffology/REVIEW_5925613376_RESOLUTION.md: 3ff9877559d4779d19e8a8e37e0ffd9a8c7e4bf5
- integrations/staffology/canonical-operations.cjs: d705dd486bde5a5016b6205985d296e239d8c7e6
- integrations/staffology/canonical-production-boundaries.cjs: fe29787b97dc1093f1753393a07d686f1832bd9c
- integrations/staffology/canonical-production-boundaries.test.cjs: 48b82a29a5eb8fdc3d41ccb16402007599cfbf8e
- integrations/staffology/independent/full-http-employee-journey.test.cjs: d613b1cd56df7399ef82ba1d5321620517d25eee

TR-09B P2: canonical-production-boundaries.cjs:68 selects recovery-dispatch from the old absence of a marker. Actual recovery of expired provably-undispatched intent with changed fresh immutable baseline returns STAFFOLOGY_BASELINE_CHANGED and dispatchStarted:false; zeroPOST, null marker, zero consumed approvals, durable uncertain. Its public status is retryable, approvalIdnull and durable operation audit mode recovery-dispatch. Expected a truthful held/non-dispatch mode; do not bypass baseline. Probe native-bf9-recovery.held-out.test.cjs (TR-09-NO-DISPATCH); complete actual row in observationsJSON.

TR-12 P2: staffology-adapter.cjs:395 reports retryable and dispatchStarted:false after a resumed authorized POST returns403. Actual durable row is rejected; dispatch marker, consumed authority and response/audit all share nonempty approvalfaf4f1fa-ec41-4919-a44b-d6c9e4c22e9e. Operation audit/public response repeat retryable with STAFFOLOGY_AUTH_REJECTED. Expected rejected,dispatchStarted:true. Repeat recovery is held and POSTcount stays1: no duplicate or unauthorized provider write shown. Probe TR-02-RECOVERY-REJECTED.

Minimum bounded repair: actual final marker-based recovery classification in boundaries; actual durable rejection/dispatch metadata in adapter failure catch; meaningful regression tests. Operations37 propagates current status/mode; no authority/store redesign required. Keep current principal, exact financial intent, immutable baseline, fencing and one-shot approval.

Prior11 findings revisited

TR01immutablebaseline,TR02initial401/403 rejection/no-replay,TR03seal/env mismatch,TR04renew/reuse/one-shot,TR05server-derived recovery intent,TR06person identity,TR07post-read current authority,TR08lease/timeout,TR10actual UI action key behavior andTR11static context-safe artifacts still pass. OriginalTR09 successful-dispatch approval/mode now passes; added real read-only uncertain recovery control performs zero additionalPOST, retains original consumed approval and uses read-only-reconciliation. New truth branches above remain open. All dispositions and exact runtime blobs are in findingsJSON.

Executed officialNode22.23.2 evidence

- Original behavior10/10,zero skip,488.1321ms.
- Expanded recovery13tests11pass2fail,zero skip,336.6408ms. Original10/10 is a subset; additional3 are1pass2fail. No inflated sums.
- Actual UI action isolatedVM plus staticCI4/4,zero skip,143.7053ms.
- Real SQLite and injected provider only; network guard,60-second per-suite limits. Prior695 source/tests/red retained. Reviewer-owned fixture delegates real coordinator and records returned fields; no product changes. Initial verifier copy retained old source-root and was rejected by full blob verification; corrected before tests.

CI evidence update

Parent recovered authenticated rawb851CircleCI26 Linux build log at work/ci19-browser/job26-build.log. Reviewer independently hashes it c5ad82ffd7c176bbeba80c4e72e0d928696b00ccb5ab23a2c388fb5bd6db8f3d and readsnotok73 fullHTTP expected200 actual403,143tests142pass1fail0skip. Earlier access-limit evidence retained; availability has changed. Mapping-options diagnosis is from separate parent probe. No claim this exactbf9 passed Linux/containerCI. Parent reports source/UI155/155,persistence1/1 and subsequent actualHTTP1/1, with first startup failure retained; those are separate parent executions and do not cover these two branches. Unchanged admission trigger requires a truthful successor marker before heavyCI.

Scope remains exact local source behavior; no hosted/customer proof, broad proven gate or live-provider execution.
