# F2.4 assurance producer calendar admission

Status: **TESTED locally**, independently reviewed once recorded in companion report. Canonical adoption, native/image admission, deployment and hosted/customer proof remain open. Sole integrator/release owner: Continue customer proof.

## Requirement/source and owner/conflict

Accepted F2.4 genuine agency identity/right-to-work/work-start evidence in current Friday backlog, #265 and source ledger contract. A malformed date must not become a different finite coverage date before the authoritative ledger boundary. This is data validation, not a change to legal entitlement or policy.

Reservation #265comment6155661353. Current exact-module open PR/issue query returned no focused lifecycle repair; complete visible branch refs contained no narrow calendar/expiry branch; PR239 file list excludes lifecycle. Legacy PR82 is historical foundation and its source matches canonical built baseline. Source455/457 and proof468 retain their files/owners. No active conflicting job or accepted lease was observed. Hidden chats/leases cannot be certified. Continue customer proof keeps canonical integration/release; no controller, shared runner, schema/SQL, source adapter, person/worker/agency or release state changed.

## Exact base and files

- Canonical48dce8f697825c8cd5f99b3e5aeea3953647f8c2/treecc8ff3737036dec8fe69a90e0759289661280537.
- Modified existing `src/frontier/agency-right-to-work-lifecycle.mjs`, original Git blob690b6dcb97b99c87fbe8a1ecd08fef02668870cc; existing `test/frontier/agency-right-to-work-lifecycle.test.mjs`, original blobaf0f20d40e82522e88ca9f7e59e22c8a9213829a.
- New `test/frontier/agency-assurance-calendar-consumer.test.mjs`, dedicated `.github/workflows/agency-assurance-calendar-admission.yml`, this evidence and independent review note.
- Real unchanged dependencies: right-to-work evaluator bloba56a0d75a837aec2a9d507a69bd01b113ce46fc7, ledger blobaaf2f66b33156c1a6bd49eac3410e5fd50d8ff3f. A partial fixture originally added a terminal newline to the evaluator; restored to exact original bytes and reran all tests. Neither dependency is in this change.

## Implementation and actual producer result

The original lifecycle Date.parse accepted validUntil2027-02-30 and emitted finite ISO coverage2027-03-02. Actual evaluateAgencyRightToWork plus createAgencyRightToWorkAssuranceVersion, using a synthetic accepted-refresh receipt and real eligibility evaluator, returned valid:true and published the rolled version.coverageUntil. No evaluator success was injected. This establishes an in-process public producer path before typed database insertion, not actual provider acceptance, database persistence or deployed reachability.

Check the numeric YYYY-MM-DD prefix against its UTC calendar day before Date.parse. Reject impossible ISO/SQL-style numeric date prefixes including surrounding whitespace and space separators; preserve the original parser for valid inputs. Valid leap days/century rules, date-only, explicit offsets, numeric milliseconds and native Date inputs retain their existing behavior. Indefinite-permission, cutover, refresh-window, positive verification notice and no-write policies are unchanged.

The shared lifecycle ms helper also denies an impossible numeric calendar in notice issue/expiry or assignment/clock inputs when it is used. It does not make every caller's null-clock handling stricter, impose a new timestamp format, claim validation of all free-form/RFC/human dates, or establish legal-policy correctness. Existing invalid-date failure vocabulary is retained.

## Tests actually run; failures preserved

- Real producer RED on unchanged lifecycle:2tests,1pass/1fail,exit1. Invalid Feb30 produced a valid rolled assurance version; valid leap/date/offset control passed.
- Initial repair combined lifecycle+ledger+consumer20/20,exit0.
- Expanded padding/space-prefix RED: lifecycle12cases,11pass/1fail,exit1. Guard expanded before final verification.
- Final lifecycle12 + unchanged ledger9 + real consumer2 = **23/23**, Node24.19.0,exit0,zero failures/skips/cancellations/todos. Valid inputs preserve exact normalized coverage, invalid inputs cannot publish a version, inputs remain unchanged.
- Syntax passes; original source/dependency Git hashes verified. Supported Node22.23.2 three-suite/syntax and unchanged Docker build workflow added; terminal native/image receipts remain separate from local proof.
- Independent review report records exact hashes and separate held-out calendar/producer/control checks; overlapping counts are not release-wide totals.

## Relation to proof468

Proof468 is a different gate on immutable455/457 sources. Its malformed callback strings are not yet proven reachable as typed PostgreSQL query results; its proposed defensive contract remains owner-unadmitted, local5/8 and registered CI failure with zero reported job steps (no supported execution inferred). Do not claim this lifecycle fix closes all three callback findings or repairs either455/457 source. It specifically closes the impossible calendar in the earlier real producer path. No mutation authority arises from either proof.

## Review/integration/deployment and next action

No canonical merge/adoption or approved release happened. Fresh observed canonical remains48d, live deploymentfaca24a2-10b9-4289-bc49-3406e44f7272 remains SUCCESS at older90ad90fcf60adaca9abacdd4ad14bf392f95e585. Neither applies to this isolated patch as deployment evidence.

Sole source/integration owner reviews and adopts exact lifecycle bytes, reconciles agency source/principal/DB boundaries and retained455/457/468 contracts once, runs actual combined/native/full-image and relevant authenticated producer/ledger/readback/audit gates, releases through existing controls, then proves one exact serving customer journey. Remaining risks: real accepted-refresh/source custody, legal-policy/customer approval, actual typed database persistence/restart, provider acceptance and complete release gates. No real payroll/personnel/supplier/customer contact, provider/database writes, paid infrastructure changes or persistent product worker were performed.
