# V123 durable outcome replay handoff — 2026-10-30

Original lane: complete durable incident/engineering memory and recurrence prevention. This package addresses only repeated learning outcome evidence across restart. It does not implement incident routing, authenticated measurement, production authority, or hosted/customer proof.

## Exact source and ownership

- Donor PR #354 at `3e4c721307abec96a1830f1b5e9fbb44c5310873`, `adaptive-intelligence/engine.mjs` Git blob `620fbc1d3f4aaf9bc31559b70a28bb857ee1a138`, was copied byte-for-byte before the two-line change.
- Existing PR #354 owner retains donor changes; PR #501 owner retains canonical integration and release. No shared branch, live tenant, or provider was changed.
- Apply `V123-durable-replay.patch` to an isolated checkout of PR #354 exact head after owner review. It changes the engine's derived timestamps to receipt timestamps and adds a narrow SQLite outcome ledger plus tests. `git apply --check` succeeded against the exact donor blob. The patch is a handoff, not adopted product code.

## Contract

The adapter requires a stable nonempty tenant/source/category/fingerprint/evidence reference, finite baseline/result and boolean verification. It starts `BEGIN IMMEDIATE`, replays committed rows in order through the donor engine, rejects conflicting reuse of tenant/source/evidence, then inserts one canonical record and commits. A second process/handle observes the committed state. A stored win threshold must match on reopen. WAL and FULL synchronous mode are requested for the local SQLite file.

The adapter relies on an approved durable path with independent volume/backup custody and trusted authenticated input. It is not wired to a current HTTP consumer or authorised outcome source. It does not prove cross-process crash inside the adapter, cross-host consensus, tamper resistance against an administrator editing SQLite, customer finance causality, or auto-deployment. The engine remains advisory and `authority:'none'`.

## Evidence

- On supported Node 22.23.2, original PR #354 engine tests plus adapter tests: 270/270 pass, zero skips, exit 0.
- Independent heldouts: 7/7 pass, including process restart, two handles, conflict, accessor rejection, corrupt-row refusal, changed threshold, and a killed uncommitted SQLite writer. Combined 277/277 pass. Independent exact derived snapshot heldout failed 0/1 on original donor engine and passed 1/1 with the two-line timestamp fix.
- See `../v123-verifier/independent-review.md` in local handoff; copy it with the patch into documentation for durable review.

Next: donor owner reviews source/API and resolves the experimental Node SQLite dependency or adopts an equivalent supported transaction store; canonical owner binds authenticated provenance and approved durable state, integrates on the current exact source, runs whole-image and hosted restart/replay proof, then independently verifies recurrence prevention.
