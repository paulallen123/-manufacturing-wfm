# V029 bounded fairness-input admission

The existing normalizer coerced explicit malformed fairness exposure into zero,
which can make that supplied worker look less exposed. This owner-ready donor
on exact PR418 `d701edb14b17c92e03210bb1fb28df986eac934f` addresses that
specific input finding from [independent review5559921959](https://github.com/paulallen123/-manufacturing-wfm/pull/418#pullrequestreview-5559921959).
It does not approve the complete preference/fairness package or scheduler.

Only four fairness fields change admission: overtimeHours, nightShifts,
weekendShifts and undesirableShifts. Supplied values must be own enumerable
data descriptors containing finite nonnegative primitive numbers. Coerced
strings, null/undefined field values, booleans, arrays/objects, negative and
non-finite values are refused. Missing fields and absent/undefined/null fairness
containers keep the existing zero defaults. Explicit negative zero keeps the
existing canonical positive-zero output. Null-prototype records are supported;
caller objects are not frozen. Unconsumed extra metadata is ignored without
calling its getters.

The worker Proxy check occurs at normaliseWorker entry before any worker reads;
the fairness container and consumed field descriptors are inspected without
evaluating getters, coercion hooks or Proxy traps. This is a bounded fairness
admission repair, not a complete inert snapshot of every worker field. Existing
preference, skill-array, scoring-weight and authority behavior stays separate.

## Verification and preservation

Node22.23.2, no skips:

- Original14 direct tests: exact baseline6/14, first candidate14/14.
- Independent review identified the too-late worker Proxy check. New direct
  regression:14/15 RED, then15/15 after moving refusal to entry.
- Separate7-case adversarial/compatibility fixture:6/7 initially, exposing that
  the new copy retained negative zero instead of the owned positive zero.
  Preserving primitive Math.max(0,value) canonicalization gives7/7.
- Final direct+heldout22 cases: exact baseline9/22, candidate22/22.
- Complete exact owner affected command:
  `node --test operations/runtime/manufacturing-scheduling-engine.test.cjs operations/runtime/scheduling-preference-fairness-proof.test.cjs`
  passes53/53: original scheduler27, original owner proof4, appended direct15
  and separate heldouts7. Counts overlap with the focused invocations.
- Parent independent reviewer inspected the final entry guard/descriptors/
  canonical zero and appended scopes, reran53/53 and accepted the bounded diff.
  This technical review is not formal GitHub approval.
- Syntax and index-based diff checks pass. An initial no-index check returned1
  with no diagnostics because it reports differences; the harness incorrectly
  expected0. Repeating against a private baseline index exits0. This is not a
  product defect. Original proof prefix remains byte-identical3784 bytes,
  Git blob6c52b4163d4856580f31634623e083e72746ef83. Both appended suites are
  lexical blocks in that already-owned selected test path, so the existing
  owner workflow command selects them without new workflow/selector edits.
  The existing scheduler test blobee1c0b4e12d818b67e03bdf0dd6ae53624cdc2b8
  is unchanged.

source-inventory.json records exact base/proposed blobs and the original prefix
hash. Raw failed/green TAP logs are gzip/base64 entries with raw byte hashes in
raw-test-receipts.json; source.patch contains both proposed changes.

## Ownership and open gates

PR352's scheduler domain owner, PR418's proof owner and sole canonical PR501
integrator retain authority. This is a separate donor on the exact existing
PR418 owner head, outside the canonical union. No PR352 branch, stored-plan HTTP
repair, travel/site test or real scheduling/customer/provider state was changed
by this task. The later complete owner command uses its unchanged in-process
baseline engine tests; it is not the held PR352 stored-plan HTTP action.

V029 remains BLOCKED/incomplete. Positive preferred-versus-neutral semantics,
preference/qualification array custody, candidate/plan identity binding and
receipt immutability findings in the existing review, authenticated
availability/preferences/skills/certification/site sources, donor reconciliation,
installed-image admission and intended-role hosted/customer proof remain open.
Default zero for omitted metadata is compatibility behavior, not evidence of
zero real exposure. No fair-allocation completeness, model switch, source trust,
new execution authority, canonical adoption, deployment or customer proof is
claimed.
