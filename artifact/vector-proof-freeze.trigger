VECTOR_PROOF_FREEZE_V1
branch=feature/vector-eow-convergence-20260925
candidate_parent_sha=b78a58ac21c85240a468ca48280fa4905265b037
rule=hosted proof deploys only when this file changes
purpose=freeze the one-hour uncompromised VECTOR proof candidate and trigger exact-candidate verification
evidence=exact deployed commit SHA must be captured independently from Git metadata
safety=no proof scope weakened; no skipped or stale result counts as PASS
routing=if primary lane is unavailable, use an equivalent independent lane with the same required proof scope
pre_freeze_contract=VECTOR_PRE_FREEZE_SIMULATION_V1
railway_runtime_contract=canonical + overflow A/B/C must preserve hosted mode, WFM_DB, /api/health, condition-readiness policy
promotion=blocked until exact-candidate Golden Journey, evidence continuity, independent verification, and recovery proof pass
war_room=one-hour proof convergence; no feature scope; fix only root-caused proof failures
retest=cold exact-candidate rerun required after every fix
