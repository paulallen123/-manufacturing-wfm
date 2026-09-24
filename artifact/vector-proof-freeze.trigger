VECTOR_PROOF_FREEZE_V1
branch=feature/vector-eow-convergence-20260925
candidate_parent_sha=a196333dc64038ee44913557b60affaad6ca3e25
rule=hosted proof deploys only when this file changes
purpose=coalesce development commits into one exact proof candidate and prevent provider queue congestion
orchestration=no idle wait; scheduled checkpoints never block; simulate ahead and provision/reroute elastic proof lanes
evidence=exact deployed commit SHA must be captured independently from Git metadata
safety=no proof scope weakened; no skipped or stale result counts as PASS
routing=if primary lane is unavailable, use an equivalent independent lane with the same required proof scope
fix=reporting provenance source tree admitted with fail-closed file existence checks
