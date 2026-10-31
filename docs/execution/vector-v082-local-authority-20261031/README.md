# V082 local in-app publication authority

An asynchronous identity reader can return a user snapshot captured before a committed role revocation, tenant transfer or deletion. The #563 pause transaction alone then records a READY in-app reference. Differing reader snapshots can also authorize a payroll report or payroll ancestor while the locally current actor is a manager.

This successor adds a deny-only local fence inside #563's existing `BEGIN IMMEDIATE` publication transaction. The final local user/role, tenant freeze, immutable report/source ancestry, pause observation and receipt insertion share the SQLite write boundary. Missing users, changed roles, forbidden sources, missing/foreign ancestors, cycles and the existing 200-entry traversal bound refuse READY. The report walk starts with the schedule entry already counted. The local check never replaces the prior asynchronous authorization grant. No callback, await, provider or adapter operation runs under the lock.

Only `reporting/runtime/vector-reporting-service.cjs` and its already-admitted test change, plus this evidence directory. The source Git blobs are `3db96ec47563db6f5e51904523d9e5530d6dd4ca` and `371c722133794a70d40bfea3d4d7ee5b4aed82ce`. The exact donor parent is #563 `3a1087c8d3003a4a837b42d2365787d9d1d221c9`, tree `e9a8970dc797eb6fb2a2d9696677585f25a63350`. #563's branch is unchanged. This stacked proposal leaves its reporting owners and the sole #501 integrator responsible for adoption.

## Fresh evidence

| Evidence | Result |
|---|---|
| Final admitted service test on unchanged #563 service, Node22.23.2 | 44 pass / 5 intended authority failures / 0 skips |
| Final admitted service test on unchanged current #501 b26 service, Node22.23.2 | 42 pass / 7 intended failures: two inherited pause and five authority / 0 skips |
| Donor-parent reporting suites after repair, Node22.23.2 | 109/109, zero skips |
| Current b26 reporting composition plus #563 and this repair, Node22.23.2 and Node24.22.1 | 145/145 on each, zero skips |
| Clean application of both patches to unchanged #563 service/test | exact candidate bytes; service49/49 on Node22 |
| Previous independent authority/pause/rollback fixtures against final repair | 13/13 on Node22 |
| New independent reviewer | ACCEPT; reporting109/109 and independent heldouts6/6 on each Node22/24 |

The independent heldouts exercise differing-reader roles and payroll ancestry, a freeze committed immediately before BEGIN, unchanged authority/replay, a separate process trying to revoke the user after the final local read, and rollback after a blocked receipt INSERT fault. The revocation cannot commit while the publication write lock is held; a successful later revocation blocks a later slot. A freeze-at-BEGIN control on unchanged #563 fails0/1 by producing READY. The initial minimal repair failed two independent role/ancestry adversaries; the final synchronous report walk repairs both. This is technical review, not a formal GitHub approval.

The decisive raw TAP, independent fixture source and review receipt are in `receipts.json`, with hashes and selected-source custody. Counts overlap and must not be added together. Initial mixed-layout testing accidentally included four frozen UI test files absent from #563, producing107/126; an initial old cross-process fixture was run without its required `EXPECT_SERIALIZED=1` flag, producing1/2. Both logs remain in the local work packet. They are fixture-selection errors, not green results, and the corrected exact selections are recorded above.

## Current-base adoption

The observed current #501 head was `b26bb6f0fc30e33b6f4c31e05608368a45fd00a4`. All 12 current reporting blobs/modes were verified against its untruncated remote tree. Its service/test remain the old `616639e5`/`0db8494e` pair; #563 is not yet adopted. The 145-test composition preserves all current reporting UI/export/lifecycle files and replaces only service/test with this successor's final pair. A normal current-base integration must include #563's pause transaction as well as this repair. Copying the old donor's UI directory would discard current #552/#553 work and is outside this proposal.

There is no file overlap with #565's manifest/test/marker changes or the private V082 UI packet. Current reporting-suite compatibility is demonstrated; a complete current canonical tree, installed artifact/image and browser workflow were not built or exercised here.

## Remaining limits

V082 remains DEVELOPMENT with research NO and open authority/provider/acknowledgement contracts. This repair covers locally persisted in-app READY publication only. External UNKNOWN quarantine remains; external delivery, recipient/provider acknowledgement identity, durable acknowledgement audit/replay, provider acceptance/readback and customer proof remain open. The pre-existing authority audit insertion still occurs after the receipt transaction; no atomic audit claim is made. #481 retains its independent NO-GO.

No #501/#563/#564/#565 ref change, merge, deployment, provider operation, protected-key access or live tenant mutation was performed by this donor. Existing source/lease/release ownership remains. No DONE, customer-ready or current-image admission claim follows from these local results.

Run the admitted affected suites with Node22:

```sh
node --test reporting/runtime/*.test.cjs reporting/ui/*.test.cjs
```

Use the reporting files from the identified tree. The #563 parent selects109 tests after this repair; the current b26 reporting composition selects145.
