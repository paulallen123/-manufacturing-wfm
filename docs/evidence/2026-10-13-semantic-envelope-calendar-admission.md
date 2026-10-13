# Integration source timestamp admission — 2026-10-13

## Requirement and owner/conflict check

Issue #202 requires an integration evidence standard and asset/source provenance; issue #265 requires exact source time and reconnect evidence for the Golden Journey. The existing `integration-fabric/runtime/semantic-envelope.mjs` is the shared source observation envelope. Its `Date.parse` check admitted `2026-02-30T12:00:00Z` as a different date while retaining the invalid raw source time. A current open-PR search found no focused correction for this module; wider integration work remains in PR #194. This package changes only the envelope validator, its adjacent tests and this evidence record. It adds no connector, writer, route, runner, checkpoint or deployment. The sole canonical owner retains adoption and integration authority.

## Exact package and result

- Base: candidate `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`.
- Changed files: `integration-fabric/runtime/semantic-envelope.mjs`, `integration-fabric/runtime/semantic-envelope.test.mjs`, this evidence record.
- The shared parser now requires explicit-zone ISO-8601 timestamps and checks calendar day, leap year, hour and offset bounds before computing epoch time. It preserves the accepted source-local offset and original raw timestamp. Source observation, ingestion, effective, FX and intervention fields all use the same parser.

## Verification and review

RED-first `node --test integration-fabric/runtime/semantic-envelope.test.mjs` on Node `v24.19.0`: **5 passed, 2 failed**; `2026-02-30T12:00:00Z` was accepted, and another impossible date passed in downstream time fields. After repair and leap-day/offset coverage, the focused suite passed **8/8**. `node --check integration-fabric/runtime/semantic-envelope.mjs` and `git diff --check` passed. Independent read-only review found no blocking acceptance hole in the bounded timestamp change and separately observed 8/8 passing.

## State, limits and next action

**TESTED isolated.** No canonical integration, exact-candidate deployment, hosted exercise or customer proof occurred. Current Railway successful candidate deployment `faca24a2-10b9-4289-bc49-3406e44f7272` serves old SHA `90ad90fcf60adaca9abacdd4ad14bf392f95e585`; patch `b453aa80-4763-4a08-a4f5-d5d27534b2c8` staging source SHA `48dce8f697825c8cd5f99b3e5aeea3953647f8c2` remains under the release owner. The canonical owner should reconcile this patch with PR #194 and the one candidate, run exact-tree integration tests and source readback, then use approved deployment and hosted proof controls. Strict timestamp admission may expose provider-specific timestamp formats; any mapping must be explicit and source-owned rather than silently parsed.
