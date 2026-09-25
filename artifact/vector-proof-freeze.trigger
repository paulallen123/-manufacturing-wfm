VECTOR_PROOF_FREEZE_V1
branch=release/vector-6f61e7c-proof-20260925
candidate_parent_sha=6f61e7c561e1c6a9c425cfa17d7d50a4c6b5d0aa
rule=hosted proof deploys only when this file changes
purpose=freeze exact candidate for independent CircleCI runtime proof
evidence=exact deployed commit SHA must be captured independently from Git metadata
safety=no proof scope weakened; no skipped or stale result counts as PASS
routing=CircleCI is an independent failure domain; Railway lanes remain one Railway failure domain
pre_freeze_contract=VECTOR_PRE_FREEZE_SIMULATION_V1
runtime_contract=health=/api/health;readiness=condition;listen=public-or-container-boundary;runtime=non-root
persistence_claim=NOT_EARNED_BY_THIS_LANE
promotion=blocked until durable restart persistence and exact-candidate hosted recovery pass
no_idle=consume CircleCI result immediately when terminal; continue Railway and hardening work in parallel
