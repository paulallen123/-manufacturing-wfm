# Receiving commit correction

Status: TESTED locally, not yet hosted proof.

The f7a13eb independent staging baseline remains 1 pass / 1 fail. An arbitrary asynchronous submitBatch can commit before the adapter's post-await lease check. Outer checks cannot revoke a downstream callback's independent database authority.

Durable jobs now require a receiver issued by integration-gateway.createStore(db).createProviderReceiver(jobStore, connectorConfig, synchronousRecordMapper). The receiver is bound to its job store through a private WeakMap. Unregistered callbacks fail before acquisition or invocation. Provider fetch/token waits remain outside any database transaction.

The receiving transaction uses the exact lease database connection, BEGIN IMMEDIATE, current owner/generation/expiry plus tenant/connector/provider/object identity checks, gateway rows and audit, a second lease check, mandatory provider commit audit, then COMMIT. Any rejection rolls everything back. Idempotent replay is checked within the same lock and still requires current authority. Mapping is trusted synchronous application code; this is not a sandbox for arbitrary callbacks. Remote receiving systems require their own fencing contract and are not admitted by this API.

Existing takeover fixture callbacks were migrated to the actual admitted SQLite receiver; their lease and no-staging assertions are retained. The independent deliberately unfenced f7 baseline is preserved separately, not rewritten into a passing test. Eight new receiving tests cover denial, takeover, expiry, audit rollback, idempotency, identity/database isolation, separate-connection locking, and recovery across the stage/checkpoint gap.

The compound rollback baseline is 3 pass / 3 fail. Terminal audit failures now preserve the digest-only attempted diagnosis with durableReceiptRecorded=false. Compensation failure reasons survive a simultaneous recorder outage; the operation still throws and never invents a durable receipt. The independent six compound assertions pass unchanged on the corrected controller.

Combined isolated suite: 78 passed, 0 failed. Canary controller simulation validator: PASS. Extracted sealed runtime composition and syntax checks: PASS. No provider/customer mutation, automatic support-worker admission, real rollback, or whole Golden Journey proof is claimed.
