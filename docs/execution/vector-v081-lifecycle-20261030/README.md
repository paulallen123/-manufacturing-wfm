# V081: preserve hidden settings and identify the saved editor revision

An immutable report version could silently replace its parent's nondefault
`limit` or `claimBoundary` with server defaults because the UI omitted both
fields. A later save response could also label a different selection or edited
view Saved and continue pin/schedule creation against the wrong editor context.
This isolated donor addresses those two boundaries on final PR549
`c82d6f98b35768b48df9068eeb8ef8e661554dc4`, preserving its CSV/collision/cache
guards. The exact parent tree is `75ad13c7ddb75069886924e6033aa679d563c7d5`.

## Owner contract and conservative decision

Fresh #527, reporting owners #371 `f34464f3a713bab8c381260c27320c7042dcd192`
and #481 `e1ed2eae98d67a558f4a103259681c0f48a33837`, and final #549 were
inspected before writing. Existing owner comments identify these defects and
leave retention/refusal/editing semantics unresolved. Prior temporary V081/e41
candidates were not adopted wholesale. No competing V081 PR was identified in
the inspected open-PR pages; session/external leases are not inferred. The
coordinator assigned this independent continuation after the #549 UI writer
became terminal. Reporting owners and sole #501 integrator retain authority.

The stored definition supplies only the two hidden values retained here. Before
creating its new version, the existing `/api/reporting/validate` route must
return both unchanged. If current server normalization/evidence policy changes
either, the UI explains that hidden settings cannot be retained and sends no
report-create request. This is a fail-closed UI decision, not a new claim policy
or an override of #371's server governance. New-template saves keep their
existing behavior. No backend, permission, immutable-row or delivery policy is
changed, and the separate #371 legacy definition/dashboard visibility decision
remains open.

The create response is also checked. If hidden settings change between validation
and creation, the UI discloses that a version was created, requires review and
stops automatic pin/schedule continuation. It does not claim rollback. Validation
and creation are separate requests; the UI does not promise a server transaction
across them.

## Editor lifecycle and pin/schedule semantics

Each applied selection/control edit advances an editor revision. Saved means
the selected immutable report ID belongs to that revision. The save request
captures its parent and definition before awaiting; an older response cannot
replace or mark the current editor saved. Only one save is in flight at a time.

A confirmed post-commit response for an older revision now explicitly tells the
user an earlier version was created and current edits remain unsaved. Selecting
another already-saved report instead reports that it was not replaced. The new
version remains discoverable through normal saved-report refresh; the UI neither
claims cancellation nor automatically retries/rewinds the committed request.
An authority-epoch-stale response is still discarded by the existing JSON guard;
401/403/404 continue through the existing conservative authority refresh.

Unchanged saved reports retain native pin/unpin and in-app scheduling against
their exact IDs. A new unsaved template retains automatic save before pin or
schedule. Dirty edits of an existing saved report require an explicit save;
pin/schedule refuse to silently target its older parent. If the editor changes
during automatic save, the created older version is disclosed and no pin or
schedule is sent. Scheduling captures cadence/time before that await. No external
delivery or schedule-execution semantics are added.

If an already-issued pin or schedule commits before the editor changes, its
confirmed dashboard/schedule response now discloses the action on the earlier
saved version without changing the current editor. Closing/changing the authority
epoch still suppresses those responses. No durable action is described as rolled
back. A source run also captures its editor revision and source; a late response
cannot supply rows/columns/CSV to a newly selected template or saved report.
Selection/control changes reset the old loading indicator without cancelling or
relabeling the network request.

## Fresh local evidence

The complete remote parent tree and 1,722 blobs/modes were matched in the isolated
snapshot; no AGENTS.md existed in the complete tree. The existing UI and a
new lifecycle test change as product source. One inherited extracted-function
mapping harness additionally initializes the new editorRevision dependency; its
collision/cache assertions remain intact. Runtime, CSS, other inherited export
tests, Docker/Forge, freeze marker, schema and owner branches retain parent bytes.
An initial broad local-copy attempt caught inherited Docker CRLF normalization;
reconstruction from exact #545 bytes plus the nine #549 overrides matched the
published parent tree. Initial cwd-relative setup/verification attempts were
corrected before accepted source verification or green results.

The new test executes the shipped IIFE through its actual DOM click/change
listeners, connected to the real reporting service and a disposable fictional
SQLite tenant/session. It creates immutable versions and reads their stored bytes,
digests and parent IDs; it does not contact a hosted service. The policy-change
case deliberately replaces only the local validation response to exercise the
UI's refusal seam. It is not evidence of an actual policy change.

Node v22.23.2, zero skips:

| Check | Result |
| --- | --- |
| Final 17-case suite with exact unchanged #549 UI/service | 3 PASS / 14 intended FAIL, exit1 |
| Initial repair before independent disclosure challenge | 11/11 PASS |
| Added post-commit disclosure expectations on that repair | 9 PASS / 2 FAIL, exit1 |
| Added held-source selection expectations before run fencing | 11 PASS / 2 FAIL, exit1 |
| Added committed pin/schedule disclosure expectations before correction | 15 PASS / 2 FAIL, exit1 |
| Final complete reporting UI/runtime selection | 137/137 PASS, exit0 |

Independent coordinator `/root` identified the disclosure and source-run gaps
after initial green runs; each was reproduced and corrected before final review.
The coordinator independently reviewed the final exact diff and reran the full
137/137 selection, zero failures/skips. This is bounded technical acceptance,
not formal GitHub approval.
The first full run after source fencing had five ReferenceErrors in the inherited
function-extraction harness because its editorRevision collaborator was absent.
That harness initialization was corrected; these five are setup errors, not five
product defects. All counts overlap. Raw TAP, exact patch, source inventory and decompression digests are
retained in this directory. Reproduce from repository root:

```sh
node --test --test-reporter=tap reporting/ui/*.test.cjs reporting/runtime/*.test.cjs
```

This is local source/service/SQLite evidence. Browser rendering, real login,
exact-image admission, installed runtime, provider delivery, customer acceptance
and other V081 lifecycle behavior are unproved. Historical browser/reader/CI
results do not transfer. Other hidden definition fields, unsupported saved filter
operators, other refresh/lifecycle races and legacy visibility remain separate owner
work. No canonical/live/tenant/provider mutation, release or DONE claim.
