#!/usr/bin/env bash
set -u

contract='VECTOR_FROZEN_CANDIDATE_ADMISSION_V1'
trigger='artifact/vector-proof-freeze.trigger'

receipt() {
  local code="$1" source_sha="$2" status="$3" reason="$4"
  if [[ -n "$source_sha" ]]; then
    printf '{"contract":"%s","sourceSha":"%s","status":"%s","reason":"%s"}\n' \
      "$contract" "$source_sha" "$status" "$reason"
  else
    printf '{"contract":"%s","sourceSha":null,"status":"%s","reason":"%s"}\n' \
      "$contract" "$status" "$reason"
  fi
  exit "$code"
}

if ! source_sha="$(git rev-parse --verify HEAD 2>/dev/null)" ||
   [[ ! "$source_sha" =~ ^[0-9a-f]{40}$ ]]; then
  receipt 1 '' 'FAIL_CLOSED' 'SOURCE_IDENTITY_UNAVAILABLE'
fi

if ! git rev-parse --verify 'HEAD^' >/dev/null 2>&1; then
  receipt 1 "$source_sha" 'FAIL_CLOSED' 'PARENT_IDENTITY_UNAVAILABLE'
fi

git diff --quiet 'HEAD^' HEAD -- "$trigger"
diff_status=$?
if [[ "$diff_status" -eq 0 ]]; then
  # EX_CONFIG/78 is intentionally non-success: CircleCI must not publish a
  # green proof status when the expensive candidate proof was not executed.
  receipt 78 "$source_sha" 'NO_PROOF' 'FREEZE_TRIGGER_UNCHANGED'
fi
if [[ "$diff_status" -eq 1 ]]; then
  receipt 0 "$source_sha" 'ADMITTED' 'FREEZE_TRIGGER_CHANGED'
fi
receipt 1 "$source_sha" 'FAIL_CLOSED' 'TRIGGER_DIFF_UNAVAILABLE'
