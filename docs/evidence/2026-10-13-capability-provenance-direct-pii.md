# Capability provenance direct-PII admission — 2026-10-13

## Requirement and ownership

Research convergence row `privacy-preserving-capability-provenance` and historical PR #215 require a competence attestation that withholds worker identity and rejects direct employee PII before emission. PR #215 owns the prototype. A current open-PR search found no correction for numeric identity values, case/separator variants, or direct PII embedded in an output reference. This bounded patch is stacked on #215 and does not create a parallel identity model or canonical integration writer.

## Exact package

- Prototype base ref: `frontier/capability-provenance-v1`; base source blob `06f079543cdbb4964ee1aea15465afb3e28f08e7`, base test blob `138958f6834d1c6550a4b9da9fb968c093b6e364`. The GitHub connector supplied these bytes for local testing and confirmed the branch held the same blobs before update. A fresh base commit SHA was unavailable when unauthenticated Git fetch failed; no exact commit identity beyond the verified blobs is claimed.
- Draft stacked PR: #432, remote head `a191dfafd8f0525dd8e78d59e99d2644b88e3d9e`. Published source/test blobs `0a7b2f457ee88b03d09b076d5c2c414be742ab39` and `ba97dfffadef2127df87715b5a0a1b17f40f8709` match the locally tested files.
- Patch files: `src/frontier/capability-provenance.mjs`, `test/frontier/capability-provenance.test.mjs`. The ledger proposal stacks on loss-prevention evidence PR #428, which is based on exact candidate `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`; changed files in this stack: `release/research-convergence-ledger.json` and this evidence record.

## Result and tests

The prototype detects existing direct-identity keys regardless of case or common separators and treats numeric values as present. It also rejects recognizable email addresses and `tel:` URIs inside fields that could be copied to an attestation. The output privacy verifier uses the same bounded checks.

RED-first local regressions: the original numeric `employeeId` case failed in a 6-pass/1-fail suite; the embedded email case failed in a 7-pass/1-fail suite; the telephone URI case failed in an 8-pass/1-fail suite. Final `node --test test/frontier/capability-provenance.test.mjs` on Node `v24.19.0`: **9 pass/0 fail**. `node --check src/frontier/capability-provenance.mjs`: pass. Independent read-only review found the email and telephone URI leaks, then no remaining blocker within the stated scope after fixes.

## Release state and next action

**TESTED isolated.** PR #432 remains draft and stacked on open #215. No canonical integration, exact-candidate deployment, hosted run or customer proof occurred. Pattern matching is a bounded source guard, not a comprehensive privacy, de-identification or cryptographic proof. The canonical owner should reconcile #215/#432 with the trust spine, define and enforce opaque reference schemas, test the exact candidate, then use approved release controls and hosted/customer-like privacy proof before advancing status.
