#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

valid_uid() {
  local value=$1
  [[ "$value" =~ ^(0|[1-9][0-9]{0,9})$ ]] || return 1
  [[ ${#value} -lt 10 || "$value" < "4294967295" ]]
}

status=$(cat)
uid_record_count=$(printf '%s\n' "$status" | awk '$1 == "Uid:" { count++ } END { print count+0 }')
invalid_uid_record_count=$(printf '%s\n' "$status" | awk '$1 == "Uid:" && NF != 5 { count++ } END { print count+0 }')
uid_values=$(printf '%s\n' "$status" | awk '$1 == "Uid:" && NF == 5 { print $2, $3, $4, $5 }')
if [[ "$uid_record_count" != 1 || "$invalid_uid_record_count" != 0 || ! "$uid_values" =~ ^[0-9]+\ [0-9]+\ [0-9]+\ [0-9]+$ ]]; then
  echo 'VECTOR_APPLICATION_UID=FAIL reason=missing-or-malformed-pid1-uid' >&2
  exit 65
fi
read -r real effective saved filesystem <<<"$uid_values"
if ! valid_uid "$real" || ! valid_uid "$effective" || ! valid_uid "$saved" || ! valid_uid "$filesystem"; then
  echo 'VECTOR_APPLICATION_UID=FAIL reason=noncanonical-or-out-of-range-pid1-uid' >&2
  exit 65
fi
if [[ "$real" == 0 || "$effective" == 0 || "$saved" == 0 || "$filesystem" == 0 ]]; then
  echo "VECTOR_APPLICATION_UID=FAIL reason=root-pid1 real=$real effective=$effective saved=$saved filesystem=$filesystem" >&2
  exit 66
fi
printf 'VECTOR_APPLICATION_UID=PASS real=%s effective=%s saved=%s filesystem=%s\n' "$real" "$effective" "$saved" "$filesystem"
