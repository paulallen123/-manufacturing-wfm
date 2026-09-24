VECTOR_PROOF_FREEZE_V1
branch=feature/vector-eow-convergence-20260925
candidate_parent_sha=a29a81f0ad2c1c9b41fd9e5c57b8de04ae6aea66
rule=hosted proof deploys only when this file changes
purpose=coalesce development commits into one exact proof candidate and prevent provider queue congestion
orchestration=no idle wait; scheduled checkpoints never block; simulate ahead and provision/reroute elastic proof lanes
evidence=exact deployed commit SHA must be captured independently from Git metadata
safety=no proof scope weakened; no skipped or stale result counts as PASS
routing=if primary lane is unavailable, use an equivalent independent lane with the same required proof scope
fix=reporting provenance source tree admitted with fail-closed file existence checks
pre_freeze_contract=VECTOR_PRE_FREEZE_SIMULATION_V1
railway_runtime_contract=admitted: canonical + overflow A/B/C have hosted mode, WFM_DB, /api/health, condition-readiness policy
failure_domains=railway shared domain counts once; github provider degraded after two pre-execution failures; circleci execution unverified
promotion=blocked until at least two independent failure domains return exact-candidate proof
regressions=missing hosted vars/domain, fixed-port startup, fixed readiness window, same-provider false parallelism, pre-execution provider failure
