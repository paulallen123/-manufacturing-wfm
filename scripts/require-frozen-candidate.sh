#!/usr/bin/env bash
set -euo pipefail

# Required CI contexts must never succeed without running their proof steps.
# Reject an unfrozen candidate before any expensive proof or deployment work.
refuse() {
  printf 'FROZEN_CANDIDATE_ADMISSION=FAIL reason=%s\n' "$1" >&2
  exit 1
}

trigger='artifact/vector-proof-freeze.trigger'
expected_sha="${CIRCLE_SHA1:-}"
[[ "$expected_sha" =~ ^[0-9a-f]{40}$ ]] || refuse missing_or_invalid_source_sha
actual_sha="$(git rev-parse --verify HEAD 2>/dev/null)" || refuse unreadable_head
[[ "$actual_sha" = "$expected_sha" ]] || refuse source_sha_mismatch
parent_sha="$(git rev-parse --verify 'HEAD^1' 2>/dev/null)" || refuse missing_parent

# Read committed bytes: an untracked, deleted or symlink trigger is not authority.
entry="$(git ls-tree HEAD -- "$trigger")" || refuse unreadable_trigger
[[ "$entry" = '100644 blob '* ]] || refuse missing_or_nonregular_trigger
trigger_content="$(git show "HEAD:$trigger" 2>/dev/null)" || refuse unreadable_trigger
[[ "${trigger_content%%$'\n'*}" = 'VECTOR_PROOF_FREEZE_V1' ]] || refuse invalid_trigger_contract
grep -Fxq 'safety=no proof scope weakened; no skipped or stale result counts as PASS' <<< "$trigger_content" || refuse missing_safety_contract
git diff --quiet HEAD -- "$trigger" || refuse dirty_trigger

# git diff exits 0 for unchanged, 1 for changed and >1 for an error.
set +e
git diff --quiet "$parent_sha" HEAD -- "$trigger"
diff_status=$?
set -e
case "$diff_status" in
  1) printf 'FROZEN_CANDIDATE_ADMISSION=PASS sha=%s\n' "$actual_sha" ;;
  0) refuse unchanged_trigger ;;
  *) refuse trigger_comparison_failed ;;
esac
