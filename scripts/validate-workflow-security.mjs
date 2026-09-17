import fs from 'node:fs';
import path from 'node:path';

class WorkflowSecurityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WorkflowSecurityError';
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new WorkflowSecurityError(code, message);
};

const invariant = (condition, code, message) => {
  if (!condition) fail(code, message);
};

const countOccurrences = (text, needle) => text.split(needle).length - 1;
const indentOf = line => line.match(/^\s*/)?.[0].length ?? 0;

export function findSecretEnvStep(source, secretName, fileLabel = '<fixture>') {
  const expression = `\${{ secrets.${secretName} }}`;
  const assignment = `${secretName}: ${expression}`;
  const lines = source.split(/\r?\n/);
  const matches = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.includes(assignment));

  invariant(matches.length === 1, 'SECRET_COUNT', `${fileLabel}: ${secretName} must be assigned from ${expression} exactly once; observed ${matches.length}.`);

  const secret = matches[0];
  let stepIndex = -1;
  for (let i = secret.index; i >= 0; i -= 1) {
    if (/^\s*-\s+name:\s*\S/.test(lines[i])) {
      stepIndex = i;
      break;
    }
  }
  invariant(stepIndex >= 0, 'SECRET_SCOPE', `${fileLabel}: ${secretName} is not inside a named workflow step.`);

  const stepIndent = indentOf(lines[stepIndex]);
  let nextStepIndex = lines.length;
  for (let i = stepIndex + 1; i < lines.length; i += 1) {
    if (/^\s*-\s+name:\s*\S/.test(lines[i]) && indentOf(lines[i]) === stepIndent) {
      nextStepIndex = i;
      break;
    }
  }
  invariant(secret.index < nextStepIndex, 'SECRET_SCOPE', `${fileLabel}: ${secretName} escaped the containing workflow step.`);

  let envIndex = -1;
  for (let i = stepIndex + 1; i < secret.index; i += 1) {
    if (/^\s*env:\s*$/.test(lines[i]) && indentOf(lines[i]) > stepIndent) envIndex = i;
  }
  invariant(envIndex >= 0, 'SECRET_SCOPE', `${fileLabel}: ${secretName} must be provided through the containing step's env block.`);
  invariant(indentOf(secret.line) > indentOf(lines[envIndex]), 'SECRET_SCOPE', `${fileLabel}: ${secretName} must be nested under the containing step's env block.`);

  const stepName = lines[stepIndex].replace(/^\s*-\s+name:\s*/, '').trim();
  return {
    stepName,
    stepLine: stepIndex + 1,
    envLine: envIndex + 1,
    secretLine: secret.index + 1
  };
}

const walkWorkflowFiles = root => {
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.ya?ml$/i.test(entry.name)) files.push(full);
    }
  };
  walk(root);
  return files.sort();
};

const requireText = (source, needle, code, fileLabel, description) => {
  invariant(source.includes(needle), code, `${fileLabel}: missing ${description}: ${needle}`);
};

const externalActionRefs = source => [...source.matchAll(/^\s*uses:\s+([^#\s]+).*$/gm)].map(match => match[1]);
const secretRefs = source => [...new Set([...source.matchAll(/secrets\.[A-Za-z0-9_]+/g)].map(match => match[0]))].sort();

function validateAllowedSecretWorkflow(filePath, source, options) {
  const {
    secretName,
    expectedRef,
    requiredText = []
  } = options;

  const refs = secretRefs(source);
  invariant(refs.length === 1 && refs[0] === expectedRef, 'SECRET_ALLOWLIST', `${filePath}: expected only ${expectedRef}; observed ${refs.join(', ') || 'none'}.`);

  const expression = `\${{ secrets.${secretName} }}`;
  invariant(countOccurrences(source, expression) === 1, 'SECRET_COUNT', `${filePath}: ${expression} must appear exactly once.`);

  for (const [needle, description] of requiredText) {
    requireText(source, needle, 'WORKFLOW_INVARIANT', filePath, description);
  }

  return findSecretEnvStep(source, secretName, filePath);
}

export function validateRepository(root = process.cwd()) {
  const workflowsRoot = path.join(root, '.github', 'workflows');
  const selfPath = path.join(workflowsRoot, 'wfm-every-push-security.yml');
  const railwayPath = path.join(workflowsRoot, 'railway-first-deploy.yml');
  const browserPath = path.join(workflowsRoot, 'live-browser-readonly-proof.yml');

  invariant(fs.existsSync(workflowsRoot), 'WORKFLOW_DIR_MISSING', `Workflow directory is missing: ${workflowsRoot}`);
  invariant(fs.existsSync(selfPath), 'SELF_MISSING', `Security gate workflow is missing: ${selfPath}`);

  const files = walkWorkflowFiles(workflowsRoot);
  const scanned = [];
  const secretFiles = [];

  for (const file of files) {
    if (path.resolve(file) === path.resolve(selfPath)) continue;
    const source = fs.readFileSync(file, 'utf8');
    const relative = path.relative(root, file);
    scanned.push(relative);

    invariant(!/^\s*runs-on:\s*ubuntu-latest\s*$/m.test(source), 'MUTABLE_RUNNER', `${relative}: mutable ubuntu-latest runner reference is forbidden.`);

    for (const ref of externalActionRefs(source)) {
      if (ref.startsWith('./')) continue;
      invariant(/@[0-9a-fA-F]{40}$/.test(ref), 'MUTABLE_ACTION', `${relative}: third-party action must be pinned to a 40-character commit SHA: ${ref}`);
    }

    const untrusted = source.match(/^\s*(pull_request_target|pull_request|workflow_run|issue_comment)\s*:/m)?.[1];
    invariant(!untrusted, 'UNTRUSTED_TRIGGER', `${relative}: ${untrusted} execution is forbidden in the private staging repository.`);

    if (/secrets\.|secrets:\s*inherit/.test(source)) secretFiles.push(relative);
    invariant(!source.includes('PUBLIC-WFM-E2E'), 'DERIVABLE_AUTH', `${relative}: public/derivable staging authentication material is forbidden.`);
  }

  const allowedSecretFiles = new Set([
    path.relative(root, railwayPath),
    path.relative(root, browserPath)
  ]);
  for (const file of secretFiles) {
    invariant(allowedSecretFiles.has(file), 'UNREVIEWED_SECRET_USE', `${file}: unreviewed workflow secret consumption is forbidden.`);
  }

  const scopedSecrets = [];
  if (fs.existsSync(railwayPath)) {
    const fileLabel = path.relative(root, railwayPath);
    const source = fs.readFileSync(railwayPath, 'utf8');
    const scope = validateAllowedSecretWorkflow(fileLabel, source, {
      secretName: 'RAILWAY_TOKEN',
      expectedRef: 'secrets.RAILWAY_TOKEN',
      requiredText: [
        ['if: github.actor == github.repository_owner', 'owner-only execution guard'],
        ['runs-on: ubuntu-24.04', 'pinned runner family'],
        ['contents: read', 'read-only repository token permission'],
        ['persist-credentials: false', 'non-persistent checkout credential setting'],
        ["RAILWAY_PROJECT_ID: '9a774359-37fa-47e8-bde0-932420c32923'", 'fixed Railway project target'],
        ["RAILWAY_ENVIRONMENT_ID: '6a33f2c1-bedd-46dc-85e7-2ef5d3b54de6'", 'fixed Railway environment target'],
        ["RAILWAY_SERVICE_ID: 'ddd54fb9-3564-4251-9959-28cf3308c272'", 'fixed Railway service target'],
        ["EXPECTED_RUNTIME_SHA256: '3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d'", 'sealed runtime digest']
      ]
    });
    scopedSecrets.push({ file: fileLabel, secret: 'RAILWAY_TOKEN', ...scope });
  }

  if (fs.existsSync(browserPath)) {
    const fileLabel = path.relative(root, browserPath);
    const source = fs.readFileSync(browserPath, 'utf8');
    if (secretRefs(source).length > 0) {
      const scope = validateAllowedSecretWorkflow(fileLabel, source, {
        secretName: 'WFM_DEMO_PASSWORD',
        expectedRef: 'secrets.WFM_DEMO_PASSWORD',
        requiredText: [
          ['if: github.actor == github.repository_owner', 'owner-only execution guard'],
          ['runs-on: ubuntu-24.04', 'pinned runner family'],
          ['contents: read', 'read-only repository token permission']
        ]
      });
      scopedSecrets.push({ file: fileLabel, secret: 'WFM_DEMO_PASSWORD', ...scope });
    }
  }

  return { ok: true, scannedWorkflowFiles: scanned.length, secretFiles, scopedSecrets };
}

export function runSelfTest() {
  const renamedSafeFixture = [
    'jobs:',
    '  promote:',
    '    steps:',
    '      - name: Upload exact merged UX source to existing customer-proof service',
    '        env:',
    '          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}',
    '        shell: bash',
    '        run: echo safe'
  ].join('\n');
  const safe = findSecretEnvStep(renamedSafeFixture, 'RAILWAY_TOKEN', 'renamed-safe-fixture');
  invariant(safe.stepName === 'Upload exact merged UX source to existing customer-proof service', 'SELF_TEST', 'A harmless deployment-step rename must remain valid when the secret stays scoped to the same step env block.');

  const leakedFixture = [
    'jobs:',
    '  promote:',
    '    steps:',
    '      - name: Unsafe inline secret',
    '        shell: bash',
    '        run: echo "RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}"'
  ].join('\n');
  let leakRejected = false;
  try {
    findSecretEnvStep(leakedFixture, 'RAILWAY_TOKEN', 'leaked-fixture');
  } catch (error) {
    leakRejected = error instanceof WorkflowSecurityError && error.code === 'SECRET_SCOPE';
  }
  invariant(leakRejected, 'SELF_TEST', 'A secret reference outside a step env block must fail closed with SECRET_SCOPE.');

  const duplicatedFixture = [
    'jobs:',
    '  promote:',
    '    steps:',
    '      - name: First',
    '        env:',
    '          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}',
    '      - name: Second',
    '        env:',
    '          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}'
  ].join('\n');
  let duplicateRejected = false;
  try {
    findSecretEnvStep(duplicatedFixture, 'RAILWAY_TOKEN', 'duplicate-fixture');
  } catch (error) {
    duplicateRejected = error instanceof WorkflowSecurityError && error.code === 'SECRET_COUNT';
  }
  invariant(duplicateRejected, 'SELF_TEST', 'Duplicate secret consumption must fail closed with SECRET_COUNT.');

  return {
    ok: true,
    regression: '2026-09-17 harmless Railway deployment-step rename no longer creates a silent CI failure',
    negativeFixtures: ['secret-outside-env', 'duplicate-secret-consumption']
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  try {
    const result = process.argv.includes('--self-test') ? runSelfTest() : validateRepository();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (error instanceof WorkflowSecurityError) {
      console.error(`WFM_WORKFLOW_SECURITY:${error.code}:${error.message}`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
