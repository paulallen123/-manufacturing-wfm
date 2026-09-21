# Astra Vector UI repair checkpoint — 21 September 2026

## Scope

This checkpoint covers the current composed Vector workflow candidate only. It
does not claim a deployment, provider submission, or preserved Railway database.

## Repair

The leave workflow had two state-coherency defects:

1. A successful leave request or decision refreshed only the leave panel,
   leaving the shared Vector dashboard at an older version.
2. A `409` optimistic-concurrency response left the next action stale.

The workflow now refreshes the shared authenticated shell through the existing
`reload()` path after a saved leave action. On a same-owner `409`, it clears the
receipt and refreshes the leave and shell state; it never replays the action.

## Repeatable evidence

Run with the pinned runtime from the repository root:

```sh
node scripts/run-local-vector-proof.mjs /tmp/vector-evidence-<fresh-name>
```

The captured run completed at `2026-09-21T01:02:26.225Z` using Node
`v22.23.2`. It passed 57 focused controller/security/provenance tests and 22
authenticated synthetic API/SQLite engine checks. The composed runtime included
150 verified files; its workflow asset SHA-256 was
`7a19071ffa8ad1243085d951fc796a2428b93308337d82ea585e271d16eb75b4`.

The controller suite specifically verifies the shared dashboard version is
refreshed after a leave change, and that a stale-version conflict refreshes
state without a replay.

## Boundaries

This is **BUILT** local evidence, not a release assertion. Docker admission,
an actual deployed browser journey, external provider submission, and Railway
SQLite preservation/restore remain false or unobserved. Do not restart or
promote the live service until its current database has been preserved and
restore-verified.
