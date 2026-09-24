VECTOR_PROOF_FREEZE_V1
branch=feature/vector-eow-convergence-20260925
candidate_parent_sha=9d7480ea91e8106c8c20e65b05c31f0be1c9c11f
rule=hosted proof deploys only when this file changes
purpose=coalesce development commits into one exact proof candidate and prevent provider queue congestion
orchestration=no idle wait; scheduled checkpoints never block; simulate ahead and provision/reroute elastic proof lanes
evidence=exact deployed commit SHA must be captured independently from Git metadata
safety=no proof scope weakened; no skipped or stale result counts as PASS
routing=if primary lane is unavailable, use an equivalent independent lane with the same required proof scope
