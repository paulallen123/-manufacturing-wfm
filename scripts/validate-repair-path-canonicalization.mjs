import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFactory } = require('../resilience/autonomous-repair-factory.cjs');
const digest = (value) => createHash('sha256').update(String(value)).digest('hex');

function expectCode(fn, code) {
  try {
    fn();
  } catch (error) {
    assert.equal(error.code, code);
    return;
  }
  assert.fail(`Expected ${code}`);
}

function seededFactory(incidentId) {
  const factory = createFactory();
  const tenant = 'tenant-a';
  factory.openIncident({ incidentId, tenant, evidenceDigest: digest(`${incidentId}:evidence`) });
  factory.registerReproducer({
    incidentId,
    tenant,
    failingTestDigest: digest(`${incidentId}:failing-test`),
    observedFailureDigest: digest(`${incidentId}:observed-failure`),
  });
  return { factory, tenant };
}

const protectedAliases = [
  'release/./release-policy.json',
  'resilience/../release/release-policy.json',
  'release\\release-policy.json',
  './DEPLOYMENT_MANIFEST.json',
  'resilience/../.github/workflows/canonical-staging-release.yml',
];

for (const [index, changedPath] of protectedAliases.entries()) {
  const incidentId = `canonical-protected-${index}`;
  const { factory, tenant } = seededFactory(incidentId);
  expectCode(() => factory.proposeCandidate({
    incidentId,
    tenant,
    proposerId: 'repair-worker',
    patchDigest: digest(`${incidentId}:patch`),
    changedPaths: [changedPath],
  }), 'WFM_REPAIR_PROTECTED_PATH');
}

for (const [index, changedPath] of ['/tmp/fix.cjs', '../release/release-policy.json', 'C:\\temp\\fix.cjs']) {
  const incidentId = `canonical-escape-${index}`;
  const { factory, tenant } = seededFactory(incidentId);
  expectCode(() => factory.proposeCandidate({
    incidentId,
    tenant,
    proposerId: 'repair-worker',
    patchDigest: digest(`${incidentId}:patch`),
    changedPaths: [changedPath],
  }), 'WFM_REPAIR_PROTECTED_PATH');
}

{
  const incidentId = 'canonical-safe-path';
  const { factory, tenant } = seededFactory(incidentId);
  const proposed = factory.proposeCandidate({
    incidentId,
    tenant,
    proposerId: 'repair-worker',
    patchDigest: digest(`${incidentId}:patch`),
    changedPaths: ['lib/./fix.cjs', 'tests/../lib/fix.cjs'],
  });
  assert.deepEqual(proposed.candidate.changedPaths, ['lib/fix.cjs']);
}

console.log(JSON.stringify({
  schemaVersion: 1,
  proof: 'tier2-repair-path-canonicalization',
  status: 'PASS',
  protectedAliasCases: protectedAliases.length,
  repositoryEscapeCases: 3,
  canonicalSafePathDeduplicated: true,
  productionAuthority: false,
  productionMutation: false,
  customerMutation: false,
}, null, 2));
