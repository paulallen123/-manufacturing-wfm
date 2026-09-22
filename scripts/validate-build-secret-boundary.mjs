import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  inspectDockerfile,
  isDockerfilePath,
  scanDockerfiles,
  inspectRailwayBuildEnvironment,
} = require('../resilience/build-secret-boundary.cjs');

const safe = scanDockerfiles([
  { path: 'Dockerfile', content: 'FROM node:22\nARG NODE_VERSION=22\nARG PORT\n' },
]);
assert.equal(safe.safe, true);
assert.equal(safe.violations.length, 0);

for (const [name, source] of [
  ['DATABASE_PASSWORD', 'ARG DATABASE_PASSWORD\n'],
  ['NPM_TOKEN', 'ARG NPM_TOKEN=synthetic\n'],
  ['API_KEY', 'ARG API_KEY\n'],
  ['CLIENT_SECRET', 'ARG CLIENT_SECRET=not-a-real-secret\n'],
  ['PRIVATE_KEY', 'ARG PRIVATE_KEY\n'],
  ['SERVICE_CREDENTIALS', 'ARG SERVICE_CREDENTIALS\n'],
]) {
  const result = inspectDockerfile({ path: 'Dockerfile', content: `FROM scratch\n${source}` });
  assert.equal(result.safe, false, `${name} must be denied as a Docker build ARG.`);
  assert.equal(result.violations[0]?.code, 'WFM_BUILD_SECRET_ARG_FORBIDDEN');
}

const canary = inspectDockerfile({
  path: 'security/railway-build-secret-canary/Dockerfile',
  content: 'FROM alpine:3.22.1\nARG SECURITY_BUILD_CANARY\nRUN test -n "$SECURITY_BUILD_CANARY"\n',
});
assert.equal(canary.safe, true);
assert.equal(canary.allowedSyntheticCanaryArgs.length, 1);

const copiedCanaryName = inspectDockerfile({
  path: 'Dockerfile',
  content: 'FROM scratch\nARG SECURITY_BUILD_CANARY\n',
});
assert.equal(copiedCanaryName.safe, false, 'The synthetic canary exception must be path-scoped.');

const hostileCanaryPath = inspectDockerfile({
  path: 'security/railway-build-secret-canary/Dockerfile',
  content: 'FROM scratch\nARG REAL_CLIENT_SECRET\n',
});
assert.equal(hostileCanaryPath.safe, false, 'The canary path must not permit arbitrary secret-like build args.');

const malformed = inspectDockerfile({
  path: 'Dockerfile',
  content: 'FROM scratch\nARG $DYNAMIC_NAME\n',
});
assert.equal(malformed.safe, false);
assert.equal(malformed.violations[0]?.code, 'WFM_BUILD_ARG_PARSE');

assert.equal(isDockerfilePath('../Dockerfile'), false);
assert.equal(isDockerfilePath('/tmp/Dockerfile'), false);

const railwaySafe = inspectRailwayBuildEnvironment([
  'railpack-v0.39.0 prepare /app --env PORT --env NODE_ENV --env RAILWAY_PROJECT_ID',
]);
assert.equal(railwaySafe.buildSecretScopeRiskDetected, false);
assert.deepEqual(railwaySafe.secretLikeBuildEnvNames, []);
assert.equal(railwaySafe.credentialValueExposureProven, false);
assert.equal(railwaySafe.releaseClaimAllowed, false);
assert.equal(railwaySafe.automaticRedeployAllowed, false);

const latestRailwayPrivateProof = inspectRailwayBuildEnvironment([
  'process "/driver/railpack-v0.39.0 prepare /app --plan-out /out/railpack-plan.json --env RAILWAY_PROJECT_NAME --env WFM_EXPECTED_CANDIDATE_SHA --env WFM_STAGING_PASSWORD --env PROOF_RUN_ID" did not complete successfully',
]);
assert.equal(latestRailwayPrivateProof.buildSecretScopeRiskDetected, true);
assert.deepEqual(latestRailwayPrivateProof.secretLikeBuildEnvNames, ['WFM_STAGING_PASSWORD']);
assert.equal(latestRailwayPrivateProof.credentialValueExposureProven, false);
assert.equal(latestRailwayPrivateProof.releaseClaimAllowed, false);
assert.equal(latestRailwayPrivateProof.automaticRedeployAllowed, false);
assert.equal(latestRailwayPrivateProof.productionMutation, false);
assert.equal(latestRailwayPrivateProof.customerMutation, false);
assert.equal(latestRailwayPrivateProof.payrollMutation, false);
assert.equal(latestRailwayPrivateProof.identityMutation, false);
assert.equal(latestRailwayPrivateProof.modelAuthorityGranted, false);
assert.equal(latestRailwayPrivateProof.executionAuthorityGranted, false);

const hostileRailwayBuild = inspectRailwayBuildEnvironment([
  'railpack prepare --env ATTACKER_TOKEN --env ATTACKER_TOKEN --env SERVICE_CLIENT_SECRET',
]);
assert.deepEqual(hostileRailwayBuild.secretLikeBuildEnvNames, ['ATTACKER_TOKEN', 'SERVICE_CLIENT_SECRET']);
assert.equal(hostileRailwayBuild.buildSecretScopeRiskDetected, true);

const railwaySyntheticCanary = inspectRailwayBuildEnvironment([
  'railpack prepare --env SECURITY_BUILD_CANARY',
]);
assert.equal(railwaySyntheticCanary.buildSecretScopeRiskDetected, false);
assert.deepEqual(railwaySyntheticCanary.secretLikeBuildEnvNames, []);

const git = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
if (git.status !== 0) {
  console.error(git.stderr || 'git ls-files failed');
  process.exit(1);
}

const trackedPaths = git.stdout.split('\0').filter(Boolean).filter(isDockerfilePath);
assert.ok(trackedPaths.length > 0, 'At least one tracked Dockerfile is required for repository proof.');
const trackedFiles = trackedPaths.map((filePath) => ({
  path: filePath,
  content: fs.readFileSync(path.resolve(filePath), 'utf8'),
}));
const repository = scanDockerfiles(trackedFiles);
assert.equal(repository.safe, true, `Tracked Dockerfile policy violations: ${JSON.stringify(repository.violations)}`);

console.log(JSON.stringify({
  schemaVersion: 2,
  proof: 'docker-and-railway-build-secret-boundary',
  status: 'PASS',
  trackedDockerfiles: trackedPaths,
  trackedDockerfileCount: trackedPaths.length,
  secretLikeDockerArgsDenied: true,
  malformedDockerArgsFailClosed: true,
  syntheticCanaryExceptionPathAndNameScoped: true,
  railwayBuildSecretScopeGuard: true,
  latestRailwayEvidenceBound: {
    deploymentId: '3ab59d58-a5cf-4d88-a199-704b29864920',
    secretLikeBuildEnvNames: latestRailwayPrivateProof.secretLikeBuildEnvNames,
    credentialValueExposureProven: latestRailwayPrivateProof.credentialValueExposureProven,
    automaticRedeployAllowed: latestRailwayPrivateProof.automaticRedeployAllowed,
  },
  repositoryReportDigest: repository.reportDigest,
  railwayReportDigest: latestRailwayPrivateProof.reportDigest,
  productionMutation: false,
  customerMutation: false,
  payrollMutation: false,
  identityMutation: false,
  modelAuthorityGranted: false,
  executionAuthorityGranted: false,
  releaseClaimAllowed: false,
  createsResources: false,
}, null, 2));
