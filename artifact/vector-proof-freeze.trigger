VECTOR_PROOF_FREEZE_V1
branch=release/vector-hardening-pre-freeze-20260925
candidate_parent_sha=4327d0f0f2b734f091ab55d3ce7483a4070ff2fb
purpose=independent validation of pre-freeze hardening controls
runtime_change_scope=none; policy+proof-regression only
pre_freeze_contract=VECTOR_PRE_FREEZE_SIMULATION_V1
must_reject=no-persistent-mount;non-durable-db-path;root-runtime;provider-assistant-authority
must_preserve=exact-sha;health=/api/health;condition-readiness;failure-domain-uniqueness
persistence_claim=NO_HOSTED_RECOVERY_CLAIM
no_idle=consume terminal evidence immediately; continue persistence and hosted proof work in parallel
