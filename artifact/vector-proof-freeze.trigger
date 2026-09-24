VECTOR_PROOF_FREEZE_V1
branch=feature/vector-eow-convergence-20260925
candidate_parent_sha=67e17138dda9031144f04fc225f8624a6a867c10
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
war_room=two-hour proof convergence; canonical auto lanes only; specialist and overflow on demand
pre_freeze=full bootstrap + health + failure-domain simulation passed for canonical Railway lanes
retest=no-idle regression fixtures aligned with hardened runtime contract; no product-code relaxation
