#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${1:-./backup-artifacts}"
mkdir -p "$OUT_DIR"

git rev-parse --is-inside-work-tree >/dev/null
HEAD_SHA="$(git rev-parse HEAD)"
BUNDLE="$OUT_DIR/manufacturing-wfm-$HEAD_SHA.bundle"
RECEIPT="$OUT_DIR/manufacturing-wfm-$HEAD_SHA.backup-receipt.json"

# Validate the repository before creating the backup.
git fsck --full --strict

# Include every locally available ref and object needed to reconstruct the repository.
git bundle create "$BUNDLE" --all

# A backup does not count unless Git can independently verify that the bundle is readable.
git bundle verify "$BUNDLE"

BUNDLE_SHA="$(sha256sum "$BUNDLE" | awk '{print $1}')"
CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > "$RECEIPT" <<JSON
{
  "schemaVersion": 1,
  "proofClass": "BACKUP_CREATED_AND_LOCALLY_VERIFIED",
  "sourceCommit": "$HEAD_SHA",
  "bundle": "$(basename "$BUNDLE")",
  "bundleSha256": "$BUNDLE_SHA",
  "gitFsck": "PASS",
  "gitBundleVerify": "PASS",
  "createdAt": "$CREATED_AT",
  "claimBoundary": "This receipt proves the local bundle was created and verified. Customer-release recovery is not proven until the bundle is stored outside GitHub and a clean restore drill is executed from that external copy."
}
JSON

printf 'WFM_REPOSITORY_BACKUP_CREATED=%s\n' "$BUNDLE"
printf 'WFM_REPOSITORY_BACKUP_RECEIPT=%s\n' "$RECEIPT"
