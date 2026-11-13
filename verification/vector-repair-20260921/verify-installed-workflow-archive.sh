#!/bin/sh
# HARVEST: PR429 installed-archive recipe; no donor policy/workflow adoption.
# Run only against an isolated installed runtime, never customer state.
set -eu
runtime=${1:-/app}
source=${2:-/proof/source}
archive=${WFM_EVIDENCE_SEALED_ARCHIVE:?sealed archive required}
expected=${EXPECTED_SOURCE_SHA:?reviewed build source required}
test "$(id -u)" -ne 0 || { echo 'ARCHIVE_ADMISSION_ROOT_FORBIDDEN' >&2; exit 1; }
printf '%s\n' "$expected" | grep -Eq '^[0-9a-f]{40}$'
test "$(cat "$runtime/.wfm-build-source-sha")" = "$expected"
test "$(node --version)" = 'v22.23.2'
printf '%s  %s\n' '3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d' "$archive" | sha256sum -c -
work=$(mktemp -d /tmp/vector-installed-workflow.XXXXXX)
trap 'result=$?; rm -rf "$work"; exit "$result"' 0
for name in tenant-calendar.cjs workflow-action-evidence-contract.cjs workflow-action-evidence-bridge.cjs; do
  cmp "$source/$name" "$runtime/operations-runtime/$name"
  ln -s "$runtime/operations-runtime/$name" "$work/$name"
done
cp "$source/workflow-action-evidence-contract.test.cjs" "$source/workflow-action-evidence-bridge.test.cjs" "$work/"
set +e
node --test --test-reporter=tap "$work/"*.test.cjs > "$work/result.tap" 2>&1
result=$?
set -e
cat "$work/result.tap"
test "$result" -eq 0
grep -qx '# tests 88' "$work/result.tap"
grep -qx '# pass 88' "$work/result.tap"
grep -qx '# fail 0' "$work/result.tap"
grep -qx '# skipped 0' "$work/result.tap"
test "$(grep -c '^ok .*preserves the pinned .*session before any loopback forwarding' "$work/result.tap")" -eq 9
grep -q '^ok .*pinned direct actor still revokes genuine changed source plus client and records containment audit' "$work/result.tap"
grep -q '^ok .*pinned observe-only actor updates client metadata on a successful authenticated loopback read' "$work/result.tap"
grep -q '^ok .*canonical sealed producers preserve permission and audited sign-off behavior' "$work/result.tap"
echo 'VECTOR_INSTALLED_ARCHIVE_ADMISSION=PASS tests=88 skipped=0 required_cases=12'
