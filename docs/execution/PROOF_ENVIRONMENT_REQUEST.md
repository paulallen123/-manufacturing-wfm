# Prepared isolated hosted proof request
Observed 2026-10-22T20:49:12.935Z.
Target existing Railway project43367a88-2233-4c6b-9018-0ce234dd73ca / environment eed9f097-610a-416e-83b9-6bc7bdb3eeef / hardening service48ee3ceb-9cfc-4399-b3a1-3628e3603815.
Existing application/customer-ready service and its volume are excluded.

## Missing authorization/access
An explicit handoff of the hardening service for a fresh synthetic proof run, an approved budget for one isolated500MB persistent volume mounted /data, and a secure test identity/configuration binding are required before changing this proof environment. Current OAuth connection exposes variable names only, not their values. No secret should be sent in chat.
Official pricing checked: https://docs.railway.com/pricing/plans lists volume storage$0.15/GB/month. https://docs.railway.com/volumes/reference says used storage is billed; metadata also consumes space.500MB at full usage is approximately$0.075/month storage only; runtime compute/egress remain separately metered, and account remaining budget is unknown. No resource provisioned or paid subscription created.

## Prepared change
After exact combined CI and necessary reviews, pin this existing service only to the reviewed candidate. Preserve one replica; configure hosted staging, exact HTTPS public origin, WFM_DB=/data/vector-proof.sqlite and WFM_REQUIRE_DURABLE_STATE=true. Use existing secret facilities for staging password/test identity, with no outgoing invitation or provider action. Runtime entrypoint explicitly requires /data and drops to node after preparing permissions; no root application process waiver.
A new empty volume hides prior /data contents. Check current state/ownership and preserve any required proof data before mounting. Do not detach/reuse the customer-ready volume.
Use service-scoped live operations only after approval. Do not accept environment-wide pending patch b453aa80-4763-4a08-a4f5-d5d27534b2c8, which would also change customer-ready.

## Verification and rollback
Record immutable image/source identity, health and public UID/security checks; scoped test login and fresh tenant; browser onboarding; restart persistence and isolated recovery. Simulated providers remain labeled.
Existing hardening deployment36ce7d6b-5801-412e-a924-8dbd7a33dce9 metadata source5ea6d4664e52348557e7e6284fe75a1c98d8a976 is rollback lead. Independently verify rollback availability and configuration before deployment. New proof data remains isolated; application rollback cannot undo external state. No external writes are in scope.
## Independent work
Continue source/CI proof, source-bound backlog reconciliation and review while the environment/access decision is unresolved. No ongoing background Work runner is implied.
