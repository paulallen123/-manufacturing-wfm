#!/usr/bin/env python3
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASELINE = json.loads((ROOT / "security/WFM_SECURITY_BASELINE.json").read_text())
MANIFEST = json.loads((ROOT / "DEPLOYMENT_MANIFEST.json").read_text())
VEX = json.loads((ROOT / "security/WFM_VEX.json").read_text())
DOCKERFILE = (ROOT / "Dockerfile").read_text()

errors = []

def require(condition, message):
    if not condition:
        errors.append(message)

node = BASELINE["node"]
expected_ref = f'{node["requiredImage"]}@{node["requiredDigest"]}'
first = DOCKERFILE.splitlines()[0].strip()
require(first == f"FROM {expected_ref}", f"Dockerfile must pin the approved Node image and digest: {expected_ref}")
require(MANIFEST.get("node_image") == expected_ref, "DEPLOYMENT_MANIFEST node_image must exactly match Dockerfile")
require(MANIFEST.get("runtime_sha256") == BASELINE["runtimeArtifact"]["sha256"], "Runtime SHA must match the security baseline")
require(MANIFEST.get("runtime_sha256") in DOCKERFILE, "Dockerfile must verify the exact runtime SHA recorded in the manifest")
require(MANIFEST.get("candidate") == BASELINE["runtimeArtifact"]["candidate"], "Candidate identity must match the security baseline")
require(MANIFEST.get("production_approved") is False, "This wrapper must remain non-production")
require(MANIFEST.get("staging_only") is True, "This wrapper must remain staging-only")
require(MANIFEST.get("fixture_only") is True, "This wrapper must remain fixture/demo-data only")

m = re.match(r"node:(\d+)\.(\d+)\.(\d+)-bookworm-slim@sha256:[0-9a-f]{64}$", MANIFEST.get("node_image", ""))
require(bool(m), "Pinned Node image format is invalid")
if m:
    actual = tuple(map(int, m.groups()))
    minimum = tuple(map(int, node["minimumSafeVersion"].split(".")))
    require(actual >= minimum, f"Node {actual} is below the approved security floor {minimum}")

validated = set(node.get("validatedCves", []))
vex_cves = {s.get("vulnerability", {}).get("name") for s in VEX.get("statements", [])}
require(validated <= vex_cves, f"VEX is missing validated CVEs: {sorted(validated - vex_cves)}")
for statement in VEX.get("statements", []):
    if statement.get("vulnerability", {}).get("name") in validated:
        require(statement.get("status") in {"fixed", "not_affected", "affected", "under_investigation"}, "VEX statement has an invalid status")

kev = set(VEX.get("kev", {}).get("listedValidatedCves", []))
require(kev <= validated, "KEV results contain a CVE that is not in the validated set")

if errors:
    for error in errors:
        print(f"SECURITY_BASELINE_FAIL: {error}", file=sys.stderr)
    sys.exit(1)

print("SECURITY_BASELINE_PASS")
print(f"node_image={expected_ref}")
print(f"runtime_sha256={MANIFEST['runtime_sha256']}")
print(f"validated_cves={len(validated)} kev_listed={len(kev)}")
for gap in BASELINE.get("knownGaps", []):
    print(f"KNOWN_GAP[{gap.get('severity','review')}]: {gap.get('id')}: {gap.get('detail')}")
