import fs from 'node:fs';
import path from 'node:path';

const emit = (status, code, extra = {}) => {
  const payload = { status, code, ...extra };
  const out = JSON.stringify(payload);
  (status === 'PASS' ? console.log : console.error)(out);
};

const fail = (code, extra = {}) => {
  emit('FAIL', code, extra);
  process.exitCode = 1;
  return false;
};

const readManifest = () => JSON.parse(fs.readFileSync('DEPLOYMENT_MANIFEST.json', 'utf8'));

function validate(vars, manifest = readManifest()) {
  const required = [
    'WFM_DB',
    'WFM_HOSTED_STAGING',
    'WFM_PUBLIC_ORIGIN',
    'WFM_RUNTIME_SHA256',
    'WFM_STAGING_PASSWORD'
  ];

  for (const key of required) {
    if (typeof vars?.[key] !== 'string' || vars[key].trim() === '') {
      return { ok: false, code: 'RAILWAY_PROOF_REQUIRED_VARIABLE_MISSING', key };
    }
  }

  const hosted = vars.WFM_HOSTED_STAGING.trim().toLowerCase();
  if (!['1', 'true', 'yes', 'on'].includes(hosted)) {
    return { ok: false, code: 'RAILWAY_PROOF_HOSTED_STAGING_DISABLED' };
  }

  let origin;
  try {
    origin = new URL(vars.WFM_PUBLIC_ORIGIN);
  } catch {
    return { ok: false, code: 'RAILWAY_PROOF_PUBLIC_ORIGIN_INVALID' };
  }
  if (origin.protocol !== 'https:' || origin.username || origin.password) {
    return { ok: false, code: 'RAILWAY_PROOF_PUBLIC_ORIGIN_UNSAFE' };
  }

  const db = vars.WFM_DB.trim();
  if (!path.posix.isAbsolute(db) || db === '/app' || db.startsWith('/app/')) {
    return { ok: false, code: 'RAILWAY_PROOF_DB_PATH_NOT_EXTERNAL_WRITABLE' };
  }

  const expectedRuntime = String(manifest.runtime_sha256 || '').trim().toLowerCase();
  const actualRuntime = vars.WFM_RUNTIME_SHA256.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expectedRuntime) || actualRuntime !== expectedRuntime) {
    return { ok: false, code: 'RAILWAY_PROOF_RUNTIME_IDENTITY_MISMATCH' };
  }

  if (vars.WFM_STAGING_PASSWORD.length < 16) {
    return { ok: false, code: 'RAILWAY_PROOF_STAGING_CREDENTIAL_TOO_SHORT' };
  }

  if ('PORT' in vars && String(vars.PORT).trim() !== '3000') {
    return { ok: false, code: 'RAILWAY_PROOF_PORT_CONTRACT_MISMATCH' };
  }

  return { ok: true, code: 'RAILWAY_PROOF_ENV_CONTRACT_OK' };
}

function selfTest() {
  const manifest = { runtime_sha256: 'a'.repeat(64) };
  const safe = {
    WFM_DB: '/tmp/wfm-proof.sqlite',
    WFM_HOSTED_STAGING: '1',
    WFM_PUBLIC_ORIGIN: 'https://proof.example.invalid',
    WFM_RUNTIME_SHA256: manifest.runtime_sha256,
    WFM_STAGING_PASSWORD: 'x'.repeat(24),
    PORT: '3000'
  };

  const cases = [
    ['safe', safe, true, 'RAILWAY_PROOF_ENV_CONTRACT_OK'],
    ['missing-db', { ...safe, WFM_DB: '' }, false, 'RAILWAY_PROOF_REQUIRED_VARIABLE_MISSING'],
    ['app-db', { ...safe, WFM_DB: '/app/local-data/wfm.sqlite' }, false, 'RAILWAY_PROOF_DB_PATH_NOT_EXTERNAL_WRITABLE'],
    ['dev-mode', { ...safe, WFM_HOSTED_STAGING: '0' }, false, 'RAILWAY_PROOF_HOSTED_STAGING_DISABLED'],
    ['runtime-drift', { ...safe, WFM_RUNTIME_SHA256: 'b'.repeat(64) }, false, 'RAILWAY_PROOF_RUNTIME_IDENTITY_MISMATCH'],
    ['http-origin', { ...safe, WFM_PUBLIC_ORIGIN: 'http://proof.example.invalid' }, false, 'RAILWAY_PROOF_PUBLIC_ORIGIN_UNSAFE'],
    ['short-credential', { ...safe, WFM_STAGING_PASSWORD: 'short' }, false, 'RAILWAY_PROOF_STAGING_CREDENTIAL_TOO_SHORT']
  ];

  for (const [name, vars, expectedOk, expectedCode] of cases) {
    const result = validate(vars, manifest);
    if (result.ok !== expectedOk || result.code !== expectedCode) {
      throw new Error(`self-test ${name} failed: ${JSON.stringify(result)}`);
    }
  }
  emit('PASS', 'RAILWAY_PROOF_ENV_SELF_TEST_OK', { cases: cases.length });
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const input = process.argv[2];
  if (!input) {
    fail('RAILWAY_PROOF_ENV_INPUT_REQUIRED');
  } else {
    try {
      const vars = JSON.parse(fs.readFileSync(input, 'utf8'));
      const result = validate(vars);
      if (!result.ok) fail(result.code, result.key ? { key: result.key } : {});
      else emit('PASS', result.code, { checked: 6, secretValuesLogged: false });
    } catch (error) {
      if (process.exitCode !== 1) fail('RAILWAY_PROOF_ENV_PARSE_OR_IO_FAILURE', { error: error.message });
    }
  }
}
