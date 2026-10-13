# Independent assurance calendar producer review

Reservation #2656155661353. Review-only source diff, fixture/consumer independence, compatibility and CI workflow. No source/test edits, DB/provider calls, external writes or jobs started. Requested report is the only reviewer artifact. Existing source owners and sole Continue customer proof integration/release owner retain their roles. Broader malformed query-result contract gate468 remains distinct; its run38471174757 failed before job steps and establishes no supported tests.

## Verdict

Approve the bounded calendar source repair and its proof workflow. The final 10-line addition rejects impossible four-digit numeric YYYY-MM-DD prefixes followed by uppercase T, whitespace, or end, after trimming for calendar validation only. It preserves original Date.parse timestamp interpretation after checking the calendar. This repairs an actual producer call path: raw impossible expiry passes into the real right-to-work evaluator and previously produced a valid assurance version with a rolled, well-formed ISO expiry. The repaired lifecycle withholds eligibility and producer version creation. This is stronger reachability evidence than malformed strings injected into a trusted PostgreSQL query result; actual DB persistence/authentication and legal/hosted/customer proof remain unestablished.

Fresh final selected run:23/23 tests pass, no skipped/cancelled/todo, exit0, Node v24.19.0. No supported Node22 CI or Docker run was executed by this reviewer. The independently reviewed workflow requests those gates but source review does not establish execution.

## Exact bytes

Read-only GitHub fetch at canonical48d `48dce8f697825c8cd5f99b3e5aeea3953647f8c2` independently confirms original lifecycle blob `690b6dcb97b99c87fbe8a1ecd08fef02668870cc` and ledger blob `aaf2f66b33156c1a6bd49eac3410e5fd50d8ff3f`. Original lifecycle local SHA-256 is `c3ef1ec5ef8f378c9afdca0c1a347a9744652a4673f2d1a9344025f78f6af4c1`. Canonical right-to-work evaluator is `a56a0d75a837aec2a9d507a69bd01b113ce46fc7`; local fixture `f91962...` differs only by an added final newline, independently diffed. No evaluator logic change is included; exact canonical packaging should preserve its original bytes.

| Final file under assurance-expiry | Git blob SHA-1 | SHA-256 |
| --- | --- | --- |
| src/frontier/agency-right-to-work-lifecycle.mjs | bad388b74989c96972d89ffb99c28c26d3167fae | d9a814f4d021e673b63a41b48bb8e85f89c96aeb6eeb1440744fd9c66582d180 |
| src/frontier/agency-right-to-work-assurance-ledger.mjs | aaf2f66b33156c1a6bd49eac3410e5fd50d8ff3f | 968848596f1313f76937982ff53923cd3b2384d2ad21fc2977e23dd3236b339b |
| src/frontier/agency-right-to-work.mjs (fixture newline normalization only) | f91962f931f92110b40426ce5447341d74a2c74c | 8d4d744d938416b20f42fe607b1f256e6a12ad4aab681d91a0352666b724da62 |
| test/frontier/agency-right-to-work-lifecycle.test.mjs | 1cb75e4c28e4743868c7495b88361fbeb917f151 | 77124c8289d08b84398cb8336e82de2f82be0929d73eb8adee7ca7b4382fcbb7 |
| test/frontier/agency-right-to-work-assurance-ledger.test.mjs | 167ab2ad3786130d44beff6e0941932cd4881dc3 | c43c030b94602dda4963e38b06615c8e1cfb6135b41d6d1fdef3ed7fedd59f46 |
| test/frontier/agency-assurance-calendar-consumer.test.mjs | ffc65d461d8cb1feb22db2bc64513419d18d9185 | e4852988364e0ca7356947b8ce46a7f4b2175f612ee62a5ef070bd98e276d104 |
| .github/workflows/agency-assurance-calendar-admission.yml | 95adfc4f14ac6ea743e2040aa7ee24a65ca9f9b8 | b7e8fb60352cd03e168e9f6d9f41f17e38a9835f36803b7286f5f3ee85e0a6c9 |

## Commands and independent probes

From `/workspace/scratch/11d7df70bc11`:

```sh
diff -u assurance-calendar-original.mjs assurance-expiry/src/frontier/agency-right-to-work-lifecycle.mjs
node --test assurance-expiry/test/frontier/*.test.mjs
sha256sum assurance-expiry/src/frontier/*.mjs assurance-expiry/test/frontier/*.mjs assurance-expiry/.github/workflows/*.yml
git hash-object assurance-expiry/src/frontier/*.mjs assurance-expiry/test/frontier/*.mjs assurance-expiry/.github/workflows/*.yml
```

Diff is exactly the 10 added lines in existing ms(); parser fallback, refresh policy, lifecycle output, and engine/ledger logic are unchanged. Final selected run includes lifecycle12, ledger9, consumer2 =23/23, exit0.

Separate `node --input-type=module` stdin probes imported the real producer and lifecycle. To compare baseline producer behavior without source edits, I loaded original lifecycle into a data URL, replaced the local evaluator import with that original data URL, and loaded an equivalent ledger import chain in memory. No evaluator stub was injected. New PROBE-* IDs and synthetic accepted-refresh receipt were used. Inputs were cloned and compared after evaluation to verify no mutation.

| Actual producer probe | Baseline valid/coverage | Repaired valid/coverage |
| --- | --- | --- |
| 2027-02-30T12:00:00Z | true /2027-03-02T12:00:00.000Z | false /version null |
| 2100-02-29 | true /2100-03-01T00:00:00.000Z | false /version null |
| 2400-02-29T01:00:00+14:00 | true /2400-02-28T11:00:00.000Z | true /same coverage |
| 2027-02-28T23:00:00-12:00 | true /2027-03-01T11:00:00.000Z | true /same coverage |

The initial narrower uppercase-T/end implementation was probed independently; space-separated `2027-02-30 12:00:00` still rolled. The author expanded the guard before this final review. Fresh probes against final exact source independently reject that value and both padded date-only/space-separated variants. Final direct lifecycle probes reject1900-02-29 and2100-02-29, accept2000-02-29 and2400-02-29, preserve legitimate offsets crossing UTC calendar boundaries, accept numeric timestamp/native Date and RFC timestamp. Earlier probes also accept valid year0000 leap day and reject month13/day00. These results demonstrate prefix-calendar validation rather than wrongly comparing local date to normalized UTC date.

## Consumer and workflow review

New consumer tests import actual createAgencyRightToWorkAssuranceVersion, which calls actual evaluateAgencyRightToWork and repaired lifecycle. Synthetic accepted-refresh receipt is the one approved fixture boundary; it is not proof of receipt authentication or persistence. Impossible calendar assertions require valid:false and version:null; valid leap/date-only/offset cases require exact normalized coverage. Input immutability is checked. No DB store/promotion operation occurs in new tests or independent producer probes.

Workflow uses read-only contents permission, pinned checkout/setup-node actions, Node22.23.2, scoped source/test/workflow PR paths, unsuppressed three-suite invocation, syntax checks, and Docker build with github.sha. No source overlays/stubbed evaluator are installed by it. Docker build is a packaging gate, not hosted acceptance. The dependency ledger/evaluator files are not included in its trigger paths; that is acceptable for this bounded lifecycle repair, but not a promise of perpetual full producer admission for unrelated changes.

## Scope and remaining limits

The helper is shared by expiry, PVN issue/expiry, assignment end, and evaluation time. Impossible numeric calendar inputs in those lifecycle calls now reject where previously rolled; no refresh thresholds, UK cutover, prescribed-method, indefinite-permission or offset policy was changed. Non-prefix/free-form/RFC date parsing remains delegated to existing Date.parse, and this review claims no universal timestamp parser hardening or format migration. The new rejection prevents malformed raw expiry from reaching the normalized producer version in the tested path; it does not prove existing persisted rolled expiries can be detected or repaired.

No integration, deployment, actual database persistence, real provider authentication, legal clearance, hosted release or customer-ready status is inferred. PR455/457 length repairs and proof-only gate468 remain separately scoped; source-owner adoption and release continue through the existing sole owner.
