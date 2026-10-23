# Execution decisions

## 2026-10-23T19:20:21.658Z: retain PR501 and repair principal issuance atomically
Preserve all reviewed six-file changes. Close the Important race retained after PR364 adoption with two bounded source/test edits; independent review and actual Node22 receipts archived. No schema or authority expansion.

## Existing isolated build service only
Use wfm-hosted-ci-fallback (845b5dcc-9c95-42cf-95fb-5719e96511f2) for one exact-commit Docker build once specifically confirmed. This is build admission, not hosted product proof; no customer data/volume/public domain. Preserve all Dockerfile test gates. Existing release/proof-lane-policy.json remains unchanged; production requires its independent-provider, runtime, recovery and approval gates. A targeted immutable admission request avoids firing the broad automatic freeze marker and unavailable CircleCI. Provider commit metadata/build logs/digest must bind the result; the receipt server's configured SHA is not authoritative proof. New source selection is staged, never applied through an unconfirmed live source connect. No new product or release lane.
