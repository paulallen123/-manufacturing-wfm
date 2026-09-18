import fs from 'node:fs';
import path from 'node:path';

const WORKFLOW_DIR = '.github/workflows';

const emit = (status, code, extra = {}) => {
  const out = JSON.stringify({ status, code, ...extra });
  (status === 'PASS' ? console.log : console.error)(out);
};

function inspectSource(source, file = '<fixture>') {
  const lines = source.split(/\r?\n/);
  const findings = [];
  const upLines = [];

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const text = raw.trim();
    if (text.startsWith('#')) continue;
    if (/(?:\$RAILWAY_BIN(?:\"|')?|\brailway)\s*\"?\s+up\b/.test(raw) || /["']?\$RAILWAY_BIN["']?\s+up\b/.test(raw)) {
      upLines.push(i);
    }
  }

  for (const lineIndex of upLines) {
    const raw = lines[lineIndex];
    if (/\bup\s+\.(?:\s|\\|$)/.test(raw)) {
      findings.push({ code: 'RAILWAY_UP_ROOT_POSITIONAL_PATH_FORBIDDEN', line: lineIndex + 1 });
    }

    const before = lines.slice(0, lineIndex).join('\n');
    const after = lines.slice(lineIndex + 1).join('\n');

    if (!before.includes('validate-railway-proof-env.mjs')) {
      findings.push({ code: 'RAILWAY_UP_MISSING_ENV_PREFLIGHT', line: lineIndex + 1 });
    }

    const deploymentListAfter = /deployment\s+list[\s\\\S]*--json/.test(after) || /deployment\s+list[^\n]*--json/.test(after);
    if (!deploymentListAfter) {
      findings.push({ code: 'RAILWAY_UP_MISSING_TERMINAL_STATUS_POLL', line: lineIndex + 1 });
    }

    if (!after.includes('/api/health')) {
      findings.push({ code: 'RAILWAY_UP_MISSING_POST_DEPLOY_HEALTH_ASSERTION', line: lineIndex + 1 });
    }
  }

  return { file, directDeployments: upLines.length, findings };
}

function validateRepository() {
  if (!fs.existsSync(WORKFLOW_DIR)) {
    emit('FAIL', 'RAILWAY_WORKFLOW_DIRECTORY_MISSING');
    process.exitCode = 1;
    return;
  }

  const files = fs.readdirSync(WORKFLOW_DIR)
    .filter(name => /\.ya?ml$/i.test(name))
    .sort();
  const results = [];
  for (const name of files) {
    const file = path.join(WORKFLOW_DIR, name);
    const result = inspectSource(fs.readFileSync(file, 'utf8'), file);
    if (result.directDeployments || result.findings.length) results.push(result);
  }

  const findings = results.flatMap(result => result.findings.map(finding => ({ file: result.file, ...finding })));
  if (findings.length) {
    emit('FAIL', 'RAILWAY_DEPLOYMENT_WORKFLOW_CONTRACT_VIOLATION', { findings });
    process.exitCode = 1;
    return;
  }
  emit('PASS', 'RAILWAY_DEPLOYMENT_WORKFLOW_CONTRACT_OK', {
    workflowsScanned: files.length,
    directDeploymentsChecked: results.reduce((sum, result) => sum + result.directDeployments, 0)
  });
}

function selfTest() {
  const safe = [
    'node scripts/validate-railway-proof-env.mjs "$RUNNER_TEMP/vars.json"',
    '"$RAILWAY_BIN" up \\',
    '  --project "$RAILWAY_PROJECT_ID" \\',
    '  --ci',
    '"$RAILWAY_BIN" deployment list --service "$RAILWAY_SERVICE_ID" --environment "$RAILWAY_ENVIRONMENT_ID" --json',
    'curl --fail --silent --show-error "$WFM_PUBLIC_ORIGIN/api/health"'
  ].join('\n');
  const fixtures = [
    ['safe', safe, []],
    ['root-path', safe.replace('"$RAILWAY_BIN" up \\', '"$RAILWAY_BIN" up . \\'), ['RAILWAY_UP_ROOT_POSITIONAL_PATH_FORBIDDEN']],
    ['no-preflight', safe.replace('node scripts/validate-railway-proof-env.mjs "$RUNNER_TEMP/vars.json"\n', ''), ['RAILWAY_UP_MISSING_ENV_PREFLIGHT']],
    ['no-poll', safe.replace('"$RAILWAY_BIN" deployment list --service "$RAILWAY_SERVICE_ID" --environment "$RAILWAY_ENVIRONMENT_ID" --json\n', ''), ['RAILWAY_UP_MISSING_TERMINAL_STATUS_POLL']],
    ['no-health', safe.replace('\ncurl --fail --silent --show-error "$WFM_PUBLIC_ORIGIN/api/health"', ''), ['RAILWAY_UP_MISSING_POST_DEPLOY_HEALTH_ASSERTION']]
  ];

  for (const [name, source, expectedCodes] of fixtures) {
    const actualCodes = inspectSource(source, name).findings.map(f => f.code).sort();
    const expected = [...expectedCodes].sort();
    if (JSON.stringify(actualCodes) !== JSON.stringify(expected)) {
      throw new Error(`self-test ${name} failed: expected ${JSON.stringify(expected)} got ${JSON.stringify(actualCodes)}`);
    }
  }
  emit('PASS', 'RAILWAY_DEPLOYMENT_WORKFLOW_SELF_TEST_OK', { cases: fixtures.length });
}

if (process.argv.includes('--self-test')) selfTest();
else validateRepository();
