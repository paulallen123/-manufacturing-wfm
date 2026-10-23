# Independent review: atomic proof principal selection and issuance

Reviewer: `/root/auth_race_review`, 2026-10-23. Scope: the two auth source/test files against PR501 baseline `4b799ddab9800ea97254fdab665f2aa191270e3e`. Read-only review of product source; only this review directory was written. No remote writes, deployment, credentials or new runner.

## Verdict

ACCEPT the bounded source repair. No new Critical, Important or Minor adoption-blocking finding. This closes the previously retained lookup-to-issuance race for other SQLite writer connections, provided all principal writes use this same database. This is an independent agent recommendation, not formal GitHub approval, image admission or hosted/customer proof.

## Exact source identity

| File | Baseline Git blob | Reviewed Git blob | Reviewed SHA256 |
| --- | --- | --- | --- |
| proof-runner-auth.cjs | fbc0b6b974bb98821294de3ff456376c4385d73e | 805cb35ce2f750c663be41e8ef6bc780c738a621 | 0701e4d5d01a211bde865dce2256b9892475f95ae27a415a02132700f1d4fa5b |
| proof-runner-auth.test.cjs | 98f3e63ff4745c279867225df2b68155f19088eb | 892db2af30c0b8f6e1093e0f4bf8d6a1e1044a0c | be267a138ad4497d9e32f34148f472a49a72c52ab2a0798b5740251a43a3814b |

Baseline source and test were independently fetched from GitHub at the exact baseline. The final local pair was hashed after the integration owner's trailing-newline normalization. Dependencies retain exact baseline blobs: identity-survival-guard `929297a2fc698d6aa1ba2714ded5db79ee9bb3d4`; passkey-schema `f6d37edc3c7135b3feeb210605cf9c3619c31307`.

Independently fetched complete recursive remote trees: base `b1cde41af5aab3b5a5a0007f812a141152fe4131`, proposed source composition `48ed1c90ae8663a70a0ba8091111622b62aaeff6`. Exactly the two expected source/test blobs above change; no deleted paths or other leaf/mode/type changes. All previous six-file repair and evidence are preserved. Later checkpoint packaging remains the integration owner's responsibility.

## Assessment

The implementation moves principal lookup and ambiguity checking inside the existing `BEGIN IMMEDIATE` issuance transaction. The writer lock now precedes the SELECT and remains until session, proof-session, nonce and issuance-audit commit. There is no await or external callback in the production critical section. A competing writer cannot commit a normalized-email duplicate, tenant reassignment or role reassignment between lookup and issuance. The source otherwise preserves signature, allowlist, origin, staging, nonce, expiry, cookie and identity-survival controls.

Missing and ambiguous principals explicitly roll back before refusal and best-effort rejection auditing. Their status codes remain403/409, with no issued credential. Lookup or lock-acquisition errors enter the same rollback/refusal path and return503 rather than an uncaught lookup exception. Optional user access in error logging prevents a secondary exception when failure occurs before principal selection. Successful credentials are emitted only after commit. The private synchronous connection prevents another request from interleaving a transaction on the same connection.

The four added owner regressions are substantive: three interleave a real second database connection immediately after the real SELECT, verifying SQLite blocks its write and retains the selected principal, then verifies a post-commit write succeeds. The fourth injects a lookup failure and verifies no credentials/nonce plus successful retry. The temporary Statement prototype interception is test-only and restored in finally; tests execute sequentially within their file. Existing test assertions are preserved. Owner reports fresh RED9 pass/4 fail and final GREEN13/13 on Node22.23.2; these are attributed owner receipts and were not rerun by this reviewer.

## Independent verification executed

Command: `/tmp/node-v22.23.2-linux-x64/bin/node --test auth-race/review/heldout.test.cjs`

Result: exit0;4 tests passed,0 failed/skipped/cancelled/todo. Synthetic SQLite fixture uses WAL mode and real second connection. Cases:

- Missing principal refuses403, releases transaction, and the same signed assertion works after identity correction.
- Same-tenant case-variant ambiguity refuses409 and remains recoverable.
- The same refusal remains safe when rejection audit deliberately fails; correction and retry succeed.
- A competing connection holding BEGIN IMMEDIATE causes503 without issuing credentials or leaking an exception; releasing the lock permits the same assertion to succeed.

Artifacts: `heldout.test.cjs` SHA256 `ef5db5b4437833bf3a8ec06cd05f4eee3a4885b8b35413dfa1835e6dad21b189`; `heldout.tap` SHA256 `008e07a2b099f5ced153b706326c81de90b08228f1caee42028d80e53d7ba053`. The busy-lock case took about3.1 seconds: the existing1.5-second busy timeout can apply once for BEGIN and again for best-effort refusal audit. This remains fail-closed and is not a new authority flaw.

## Limits

The guarantee linearizes principal selection and issuance at the database transaction. It does not prohibit a legitimate identity change after commit; existing identity-survival checks remain responsible for later use. SQLite/JavaScript Unicode normalization differences, trusted-proxy configuration, hosted key custody, access administration, assertion-time behavior under waiting, and full product tenant isolation are not broadened or certified by this change. No schema/uniqueness migration or production authority is introduced. Exact image build, installed runtime, hosted login and customer proof remain unverified.
