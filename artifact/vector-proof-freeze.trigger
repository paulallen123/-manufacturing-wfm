VECTOR_PROOF_FREEZE_V1
branch=feature/vector-eow-convergence-20260925
rule=hosted proof deploys only when this file changes
purpose=coalesce development commits into one exact proof candidate and prevent provider queue congestion
evidence=exact deployed commit SHA must be captured independently from Git metadata
safety=no proof scope weakened; no skipped or stale result counts as PASS
routing=if primary lane is unavailable, use an equivalent independent lane with the same required proof scope
