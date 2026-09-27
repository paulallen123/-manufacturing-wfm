const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const dockerfilePath = process.env.WFM_DOCKERFILE || path.join(repositoryRoot, 'Dockerfile');
const artifactPath = process.env.WFM_RUNTIME_ARTIFACT || path.join(
  repositoryRoot,
  'artifact',
  'wfm-0.6.76-hosted-staging-rc1.tar.gz',
);

test('Docker build admits the exact sealed runtime artifact committed beside it', () => {
  const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
  const copy = dockerfile.match(
    /^COPY\s+(artifact\/wfm-0\.6\.76-hosted-staging-rc1\.tar\.gz)\s+\/tmp\/runtime\.tgz\s*$/m,
  );
  const admitted = dockerfile.match(
    /^RUN echo "([a-f0-9]{64})  \/tmp\/runtime\.tgz" \| sha256sum -c -/m,
  );

  assert.ok(copy, 'Dockerfile must copy the sealed runtime into the checked path');
  assert.ok(admitted, 'Dockerfile must declare the admitted runtime SHA-256');
  const actual = createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex');
  assert.equal(
    admitted[1],
    actual,
    'Dockerfile checksum must match the exact committed sealed runtime artifact',
  );
});
