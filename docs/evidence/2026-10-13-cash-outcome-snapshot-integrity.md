# F4.6 cash outcome learning snapshot integrity

Status: **TESTED locally**. Sole canonical integrator/release owner: **Continue customer proof**.

## Requirement and source

Accepted F4.6 Cash-to-Capacity, predictions distinct from observed realised outcomes, evidence-only learning and no invented value. Sources: #265 v4 comment6114482290; existing canonical `release/vector-eow-convergence.json` (`cash-to-capacity` evidence/decision/outcome target, `noInventedSavings:true`, `noProductionAuthorityFromAI:true`); recorded backlog section16 economic integrity; original PR210 is historical discovery, not a new distinct feature.

## Ownership and conflicts

Reservation: #265 comment6150643781. Full visible open PR inventory, all matching branch refs, recent #265 comments, active Actions and visible local processes were checked. PR423 owns evidence source-time, PR425 engine age, PR438 presentation roles; this repair touches their separate outcome module only. PR210's v0.1 outcome source is superseded by canonical v0.2. No visible current narrow outcome-snapshot writer/branch/job was found. Hidden chats and unadvertised leases are not independently observable. No shared controller, runner, integration owner, Dockerfile or canonical release branch is modified.

## Exact base and files

- Remote base: `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`; tree `cc8ff3737036dec8fe69a90e0759289661280537`.
- Outcome source preimage: Git blob `9e1ac57a556c1db034102754ef3f1ad639267fc3`.
- Existing test preimage: Git blob `8062ad93b2169afceb8502e34660de76075dd3dd`.
- Those two source files were fetched at the exact immutable base and verified by `git hash-object`; local reconstructed baseline `3e0fef0` is a partial-source inspection baseline, not a canonical repository commit.
- Modified: `src/frontier/cash-to-capacity-outcome.mjs`, `test/frontier/cash-to-capacity-outcome.test.mjs`.
- Added: `.github/workflows/cash-capacity-outcome-snapshot.yml`, scoped implementation plan, this evidence note and independent review report.
- Other cash source/tests fetched solely for coexistence regression retain the upstream contents and are excluded from the adoption change.

## Implementation and preserved boundaries

The existing `learningSummary` validates serialized record content and later reads the caller's calibration again. A mutable `absoluteValueError` getter returned500 at validation and0 at aggregation, producing `evidence_only` with zero error from an actual500 error.

Capture a detached immutable snapshot of plain data by own property descriptors before status, replay identity, validation and aggregation. Reject accessors, custom serializers/iterators, hidden/symbol metadata, proxies (including revoked proxies), custom prototypes, sparse arrays, cycles and non-JSON scalars without executing their behavior. Frozen records, normal persisted JSON, null-prototype records, reordered keys, valid duplicate observations and existing mixed-scope/conflict rejection remain covered.

Reuse the current reconciler and calibration algorithm. Source authentication and authorisation remain owner responsibilities; `authoritative:true` stays a caller assertion. No source truth, causality, cash settlement, automatic policy change or execution authority follows from this pure structural consistency check. The separate reconciler input boundary was not expanded by this patch.

## Tests actually run and failures

- RED on unchanged canonical outcome: `node --test --test-reporter=tap .../cash-to-capacity-outcome.test.mjs`, Node24.19.0, exit1: **48 pass / 1 fail**, no skips. Failing regression observed `{count:1,status:'evidence_only',meanAbsoluteValueError:0,meanAbsoluteTimingErrorDays:1}` when rejection was required.
- After initial fix: same suite **49/49**, exit0.
- Expanded outcome suite: **54/54**, Node24.19.0, exit0, zero failures/skips/cancellations/todos.
- Four canonical cash file suites with only the outcome repair: `node --test --test-reporter=tap test/frontier/cash-to-capacity-*.test.mjs`, **69/69**, Node24.19.0, exit0, zero failures/skips/cancellations/todos. This is one shared run, not extra tests for each file.
- Syntax checks for modified source/test and `git diff --check`: exit0.
- Available historical local Node22.16.0 binary: same four-suite attempt crashed **exit139 (segmentation fault)** before any TAP output. It establishes no Node22 pass or product-test failure; no repeated retry was counted as progress.
- Dedicated CI follows the existing isolated cash-role-gate workflow's pinned checkout/setup-node, read-only token, Node22.23.2 focused four-suite tests, syntax and unchanged Docker build. CI, exact final-image test execution and canonical union admission are separate gates.

## Review, integration, deployment and proof

Independent source/test/workflow review is recorded in the companion review report. No canonical merge/adoption has occurred in this session. No deployment, business-state mutation, provider call, paid infrastructure change, payroll/personnel change or customer contact occurred.

Fresh platform readback: live service `cded4ff7-24b1-4aaa-a7e2-67f143583bc2`, environment `eed9f097-610a-416e-83b9-6bc7bdb3eeef`, deployment `faca24a2-10b9-4289-bc49-3406e44f7272` is SUCCESS at serving SHA `90ad90fcf60adaca9abacdd4ad14bf392f95e585`, separate from canonical48d. This patch is **not DEPLOYED/ENABLED, PROVEN or CUSTOMER-READY**. Local synthetic structural tests do not establish hosted customer benefit or authentic measured cash outcomes.

## Remaining blockers and next action

Continue customer proof must review/adopt this exact bounded change with the three disjoint cash packages once, verify the actual combined candidate and supported native/full-image gate, retain trusted provider/prediction/measurement/clock custody, release through existing controls, and collect authenticated same-image source→decision→observed outcome→unique learning→fresh readback/audit proof. Do not use separate PR-image passes as a combined release receipt. No ongoing product/background worker is claimed by this package.
