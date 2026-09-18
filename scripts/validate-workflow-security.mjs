import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

class WorkflowSecurityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WorkflowSecurityError';
    this.code = code;
  }
}

const fail = (code, message) => { throw new WorkflowSecurityError(code, message); };
const invariant = (condition, code, message) => { if (!condition) fail(code, message); };
const indentOf = line => line.match(/^\s*/)?.[0].length ?? 0;
const countOccurrences = (text, needle) => text.split(needle).length - 1;
const normalize = value => value.split(path.sep).join('/');

function findNamedStepForLine(lines, targetIndex, fileLabel, code = 'STEP_SCOPE') {
  for (let i = targetIndex; i >= 0; i -= 1) {
    if (/^\s*-\s+name:\s*\S/.test(lines[i])) {
      const stepIndent = indentOf(lines[i]);
      for (let j = i + 1; j <= targetIndex; j += 1) {
        if (/^\s*-\s+name:\s*\S/.test(lines[j]) && indentOf(lines[j]) === stepIndent) break;
        if (j === targetIndex) return { index: i, line: i + 1, name: lines[i].replace(/^\s*-\s+name:\s*/, '').trim(), indent: stepIndent };
      }
    }
  }
  fail(code, `${fileLabel}: target line is not inside a named workflow step.`);
}

export function findSecretEnvStep(source, secretName, fileLabel = '<fixture>') {
  const expression = `\${{ secrets.${secretName} }}`;
  const assignment = `${secretName}: ${expression}`;
  const lines = source.split(/\r?\n/);
  const matches = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.includes(assignment));
  invariant(matches.length === 1, 'SECRET_COUNT', `${fileLabel}: ${secretName} must be assigned from ${expression} exactly once; observed ${matches.length}.`);

  const secret = matches[0];
  const step = findNamedStepForLine(lines, secret.index, fileLabel, 'SECRET_SCOPE');
  let envIndex = -1;
  for (let i = step.index + 1; i < secret.index; i += 1) {
    if (/^\s*env:\s*$/.test(lines[i]) && indentOf(lines[i]) > step.indent) envIndex = i;
  }
  invariant(envIndex >= 0, 'SECRET_SCOPE', `${fileLabel}: ${secretName} must be provided through the containing step's env block.`);
  invariant(indentOf(secret.line) > indentOf(lines[envIndex]), 'SECRET_SCOPE', `${fileLabel}: ${secretName} must be nested under the containing step's env block.`);
  return { stepName: step.name, stepLine: step.line, envLine: envIndex + 1, secretLine: secret.index + 1 };
}

function findStepContaining(source, needle, fileLabel) {
  const lines = source.split(/\r?\n/);
  const matches = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.includes(needle));
  invariant(matches.length === 1, 'PREFLIGHT_COUNT', `${fileLabel}: expected exactly one preflight command ${needle}; observed ${matches.length}.`);
  const step = findNamedStepForLine(lines, matches[0].index, fileLabel, 'PREFLIGHT_SCOPE');
  return { stepName: step.name, stepLine: step.line, commandLine: matches[0].index + 1 };
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

const externalActionRefs = source => [...source.matchAll(/^\s*uses:\s+([^#\s]+).*$/gm)].map(match => match[1]);
const secretRefs = source => [...new Set([...source.matchAll(/secrets\.[A-Za-z0-9_]+/g)].map(match => match[0]))].sort();

export function assertDeclaredCredentialFiles(secretFiles, declaredPaths) {
  const declared = new Set(declaredPaths);
  for (const file of secretFiles) {
    invariant(declared.has(file), 'UNREVIEWED_SECRET_USE', `${file}: unreviewed workflow secret consumption is forbidden. Add a reviewed entry to reliability/workflow-credential-policy.json and satisfy its invariants before use.`);
  }
}

function validateCredentialWorkflowSource(fileLabel, source, entry) {
  const expectedRef = `secrets.${entry.secret}`;
  const expression = `\${{ ${expectedRef} }}`;
  const refs = secretRefs(source);
  invariant(refs.length === 1 && refs[0] === expectedRef, 'SECRET_ALLOWLIST', `${fileLabel}: expected only ${expectedRef}; observed ${refs.join(', ') || 'none'}.`);
  invariant(countOccurrences(source, expression) === 1, 'SECRET_COUNT', `${fileLabel}: ${expression} must appear exactly once.`);
  for (const needle of entry.required_text || []) {
    invariant(source.includes(needle), 'WORKFLOW_INVARIANT', `${fileLabel}: missing reviewed workflow invariant: ${needle}`);
  }

  const secretScope = findSecretEnvStep(source, entry.secret, fileLabel);
  let preflight = null;
  if (entry.browser_credential) {
    invariant(typeof entry.preflight === 'string' && entry.preflight.length > 0, 'BROWSER_FLOOR_POLICY', `${fileLabel}: browser credential entry is missing a preflight command.`);
    preflight = findStepContaining(source, entry.preflight, fileLabel);
    invariant(preflight.stepLine < secretScope.stepLine, 'BROWSER_FLOOR_ORDER', `${fileLabel}: browser security-floor preflight must execute before the step that receives ${entry.secret}.`);
  }
  return { secret: entry.secret, browserCredential: Boolean(entry.browser_credential), secretScope, preflight };
}

export function validateRepository(root = process.cwd()) {
  const workflowsRoot = path.join(root, '.github', 'workflows');
  const selfPath = path.join(workflowsRoot, 'wfm-every-push-security.yml');
  const registryPath = path.join(root, 'reliability', 'workflow-credential-policy.json');
  const browserPolicyPath = path.join(root, 'resilience', 'browser-security-floor.json');
  const browserScriptPath = path.join(root, 'scripts', 'browser-security-floor.mjs');

  invariant(fs.existsSync(workflowsRoot), 'WORKFLOW_DIR_MISSING', `Workflow directory is missing: ${workflowsRoot}`);
  invariant(fs.existsSync(selfPath), 'SELF_MISSING', `Security gate workflow is missing: ${selfPath}`);
  invariant(fs.existsSync(registryPath), 'CREDENTIAL_POLICY_MISSING', `Credential workflow policy is missing: ${registryPath}`);

  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  invariant(Array.isArray(registry.workflows), 'CREDENTIAL_POLICY_INVALID', 'Credential workflow policy must contain a workflows array.');
  const entries = new Map();
  for (const entry of registry.workflows) {
    invariant(entry && typeof entry.path === 'string' && typeof entry.secret === 'string', 'CREDENTIAL_POLICY_INVALID', 'Each credential workflow entry requires path and secret.');
    invariant(!entries.has(entry.path), 'CREDENTIAL_POLICY_DUPLICATE', `Duplicate credential workflow entry: ${entry.path}`);
    entries.set(entry.path, entry);
  }

  const files = walkWorkflowFiles(workflowsRoot);
  const scanned = [];
  const secretFiles = [];
  for (const file of files) {
    if (path.resolve(file) === path.resolve(selfPath)) continue;
    const source = fs.readFileSync(file, 'utf8');
    const relative = normalize(path.relative(root, file));
    scanned.push(relative);

    invariant(!/^\s*runs-on:\s*ubuntu-latest\s*$/m.test(source), 'MUTABLE_RUNNER', `${relative}: mutable ubuntu-latest runner reference is forbidden.`);
    for (const ref of externalActionRefs(source)) {
      if (ref.startsWith('./')) continue;
      invariant(/@[0-9a-fA-F]{40}$/.test(ref), 'MUTABLE_ACTION', `${relative}: third-party action must be pinned to a 40-character commit SHA: ${ref}`);
    }
    const untrusted = source.match(/^\s*(pull_request_target|pull_request|workflow_run|issue_comment)\s*:/m)?.[1];
    invariant(!untrusted, 'UNTRUSTED_TRIGGER', `${relative}: ${untrusted} execution is forbidden in the private staging repository.`);
    invariant(!/secrets:\s*inherit/.test(source), 'INHERITED_SECRETS', `${relative}: inherited workflow secrets are forbidden.`);
    if (/secrets\.[A-Za-z0-9_]+/.test(source)) secretFiles.push(relative);
    invariant(!source.includes('PUBLIC-WFM-E2E'), 'DERIVABLE_AUTH', `${relative}: public/derivable staging authentication material is forbidden.`);
  }

  assertDeclaredCredentialFiles(secretFiles, [...entries.keys()]);
  invariant(secretFiles.length === entries.size, 'CREDENTIAL_POLICY_STALE', `Credential policy declares ${entries.size} workflows but repository currently contains ${secretFiles.length} secret-bearing workflows.`);

  const credentialWorkflows = [];
  let browserCredentialCount = 0;
  for (const [relative, entry] of entries) {
    const full = path.join(root, ...relative.split('/'));
    invariant(fs.existsSync(full), 'DECLARED_WORKFLOW_MISSING', `Declared credential workflow is missing: ${relative}`);
    const source = fs.readFileSync(full, 'utf8');
    const result = validateCredentialWorkflowSource(relative, source, entry);
    if (result.browserCredential) browserCredentialCount += 1;
    credentialWorkflows.push({ path: relative, ...result });
  }

  if (browserCredentialCount > 0) {
    invariant(fs.existsSync(browserPolicyPath), 'BROWSER_FLOOR_POLICY', 'Browser security-floor policy is required when browser credential workflows exist.');
    invariant(fs.existsSync(browserScriptPath), 'BROWSER_FLOOR_POLICY', 'Browser security-floor script is required when browser credential workflows exist.');
    const browserPolicy = JSON.parse(fs.readFileSync(browserPolicyPath, 'utf8'));
    const protectedWorkflows = new Set((browserPolicy.protected_paths || []).map(item => item.workflow).filter(Boolean));
    for (const item of credentialWorkflows.filter(item => item.browserCredential)) {
      invariant(protectedWorkflows.has(item.path), 'BROWSER_FLOOR_POLICY', `${item.path}: missing from browser security-floor protected paths.`);
    }
  }

  return {
    ok: true,
    scannedWorkflowFiles: scanned.length,
    secretFiles,
    credentialWorkflows,
    browserCredentialCount
  };
}

export function runSelfTest() {
  const safeFixture = [
    'jobs:', '  proof:', '    steps:',
    '      - name: Require browser floor', '        run: node scripts/browser-security-floor.mjs',
    '      - name: Authenticated proof', '        env:', '          WFM_DEMO_PASSWORD: ${{ secrets.WFM_DEMO_PASSWORD }}',
    '        run: echo safe'
  ].join('\n');
  const safe = validateCredentialWorkflowSource('safe-fixture', safeFixture, { secret: 'WFM_DEMO_PASSWORD', browser_credential: true, preflight: 'node scripts/browser-security-floor.mjs' });
  invariant(safe.secretScope.stepName === 'Authenticated proof', 'SELF_TEST', 'Safe browser fixture did not resolve credential step.');

  const missingFloor = [
    'jobs:', '  proof:', '    steps:', '      - name: Authenticated proof', '        env:',
    '          WFM_DEMO_PASSWORD: ${{ secrets.WFM_DEMO_PASSWORD }}', '        run: echo unsafe'
  ].join('\n');
  let floorRejected = false;
  try { validateCredentialWorkflowSource('missing-floor-fixture', missingFloor, { secret: 'WFM_DEMO_PASSWORD', browser_credential: true, preflight: 'node scripts/browser-security-floor.mjs' }); }
  catch (error) { floorRejected = error instanceof WorkflowSecurityError && error.code === 'PREFLIGHT_COUNT'; }
  invariant(floorRejected, 'SELF_TEST', 'Browser credential workflow without preflight must fail closed.');

  const duplicated = [
    'jobs:', '  proof:', '    steps:', '      - name: First', '        env:', '          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}',
    '      - name: Second', '        env:', '          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}'
  ].join('\n');
  let duplicateRejected = false;
  try { validateCredentialWorkflowSource('duplicate-fixture', duplicated, { secret: 'RAILWAY_TOKEN', browser_credential: false }); }
  catch (error) { duplicateRejected = error instanceof WorkflowSecurityError && error.code === 'SECRET_COUNT'; }
  invariant(duplicateRejected, 'SELF_TEST', 'Duplicate secret consumption must fail closed.');

  let undeclaredRejected = false;
  try { assertDeclaredCredentialFiles(['.github/workflows/new-secret.yml'], ['.github/workflows/known.yml']); }
  catch (error) { undeclaredRejected = error instanceof WorkflowSecurityError && error.code === 'UNREVIEWED_SECRET_USE'; }
  invariant(undeclaredRejected, 'SELF_TEST', 'New unregistered secret workflow must fail closed.');

  return {
    ok: true,
    regression: 'credential workflow registry drift and pre-secret browser floor',
    negativeFixtures: ['browser-preflight-missing', 'duplicate-secret-consumption', 'unregistered-secret-workflow']
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
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
