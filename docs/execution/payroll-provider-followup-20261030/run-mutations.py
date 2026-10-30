"""Disposable no-network sensitivity checks; never edits the reviewed candidate."""
from pathlib import Path
import json
import os
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parent
node = os.environ.get('VECTOR_PREFLIGHT_TEST_NODE', 'node')
source = Path(os.environ.get('VECTOR_PREFLIGHT_SOURCE_ROOT', root / 'candidate')).resolve()
mutations = [
    ('primary-only', 'for(const line of profile.batchManifest.lines){',
     'for(const line of profile.batchManifest.lines.slice(0,1)){',
     'a correct primary worker cannot hide a financial mismatch in the other worker'),
    ('collision-guard-removed', 'if(deliveryIds.has(deliveryId))fail(',
     'if(false)fail(', 'two VECTOR workers cannot target one provider business operation'),
    ('authority-claim-enabled', 'authorizationGranted:false',
     'authorizationGranted:true', 'complete two-worker input checks every released line and grants no authority'),
]
results = []
for name, old, new, expected in mutations:
    with tempfile.TemporaryDirectory(prefix='payroll-preflight-mutant-') as temporary:
        copy = Path(temporary) / 'candidate'
        # Materialize only this offline test's six imports, never a live store.
        for relative in [
            'scripts/staffology-payroll-proof-preflight.cjs',
            'scripts/staffology-payroll-proof-preflight.adversarial.test.cjs',
            'integrations/staffology/canonical-operations.cjs',
            'integrations/staffology/canonical-runtime-bridge.cjs',
            'integrations/staffology/staffology-adapter.cjs',
            'integrations/staffology/canonical-production-boundaries.cjs',
        ]:
            destination = copy / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source / relative, destination)
        checker = copy / 'scripts/staffology-payroll-proof-preflight.cjs'
        content = checker.read_text()
        assert content.count(old) == 1, name
        checker.write_text(content.replace(old, new, 1))
        completed = subprocess.run([
            node, '--test', '--test-reporter=tap',
            'scripts/staffology-payroll-proof-preflight.adversarial.test.cjs'
        ], cwd=copy, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30)
        (root / 'evidence' / (name + '-node22.tap')).write_text(completed.stdout)
        detected = completed.returncode != 0 and ('not ok ' in completed.stdout) and expected in completed.stdout
        results.append({'mutant': name, 'exitCode': completed.returncode, 'detected': detected,
                        'requiredFailingCase': expected})
        assert detected, json.dumps(results[-1])
(root / 'evidence' / 'mutation-results.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results, indent=2))
