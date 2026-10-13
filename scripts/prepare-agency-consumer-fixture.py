"""Prepare a hash-pinned isolated agency consumer fixture; never change repo engines."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import urllib.request

REPOSITORY = "paulallen123/-manufacturing-wfm"
SOURCES = (
    ("src/frontier/agency-identity-continuity.mjs", "8534ffd507d1e1cf3027aa7853ae53115e46deef", "1d29f27d3d47babf6e97ba3b3dac1593ea68bb79"),
    ("test/frontier/agency-identity-continuity.test.mjs", "8534ffd507d1e1cf3027aa7853ae53115e46deef", "7a899f99564af45fd9dda237d4f1b5fba2e35556"),
    ("src/frontier/agency-work-start-readiness.mjs", "e3db198ef59d3d27e2213ee46e854b56843b0a4b", "87d9f2d15d1491036c434ed8dbddbef689e428f3"),
    ("test/frontier/agency-work-start-readiness.test.mjs", "e3db198ef59d3d27e2213ee46e854b56843b0a4b", "5a5be6c0a92356c076abb070108b623a820c345e"),
)
CONSUMER = "test/frontier/agency-work-start-combined-consumer.test.mjs"

def verify(data, expected):
    actual = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
    if actual != expected:
        raise ValueError("Pinned source blob mismatch")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--existing", type=Path, help="Validate an already isolated local fixture without networking")
    args = parser.parse_args()
    records = []
    if args.existing:
        root = args.existing.resolve()
        for path, commit, blob in SOURCES:
            data = (root / path).read_bytes()
            verify(data, blob)
            records.append({"path": path, "commit": commit, "blob": blob, "sha256": hashlib.sha256(data).hexdigest()})
    else:
        token = os.environ.get("GH_TOKEN")
        if not token:
            raise ValueError("Read-only repository token is required")
        root = Path(tempfile.mkdtemp(prefix="vector-agency-consumer-"))
        for path, commit, blob in SOURCES:
            url = f"https://api.github.com/repos/{REPOSITORY}/contents/{path}?ref={commit}"
            request = urllib.request.Request(url, headers={"Authorization": "Bearer " + token,
                "Accept": "application/vnd.github+json", "User-Agent": "vector-pinned-agency-consumer"})
            with urllib.request.urlopen(request, timeout=30) as response:
                item = json.load(response)
            if item.get("sha") != blob or item.get("encoding") != "base64":
                raise ValueError("Pinned source metadata mismatch")
            data = base64.b64decode(item["content"].replace("\n", ""), validate=True)
            verify(data, blob)
            target = root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            records.append({"path": path, "commit": commit, "blob": blob, "sha256": hashlib.sha256(data).hexdigest()})
        owner_root = Path(__file__).resolve().parents[1]
        shutil.copyfile(owner_root / CONSUMER, root / CONSUMER)
    records.append({"path": CONSUMER, "sha256": hashlib.sha256((root / CONSUMER).read_bytes()).hexdigest()})
    print(json.dumps({"fixture": str(root), "repository": REPOSITORY, "files": records}, sort_keys=True))
    if not args.existing and os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            output.write(f"fixture={root}\n")

if __name__ == "__main__":
    main()
