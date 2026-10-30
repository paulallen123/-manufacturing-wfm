'use strict';
const {createPrivateKey} = require('node:crypto');
function inspectProofAccess(env = process.env) {
  const missing = [], invalid = [];
  const required = ['VECTOR_PROOF_AUTH_PROFILE','VECTOR_PROOF_URL','WFM_EXPECTED_CANDIDATE_SHA','EXPECTED_DEPLOYMENT_ID','EXPECTED_IMPLEMENTATION_TENANT','EXPECTED_IMPLEMENTATION_RUN_ID','EXPECTED_CONFIGURATION_DIGEST','VECTOR_PROOF_ACTORS_JSON','PROOF_PRIVATE_KEY_B64'];
  for (const name of required) if (!env[name]) missing.push(name);
  const check = (name, predicate) => { if (env[name] && !predicate(env[name])) invalid.push(name); };
  // Match createProofClient's offline input contract. This never exchanges a
  // session or verifies that the configured signer/actors are authorized.
  const bounded = (value, limit) => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= limit;
  check('VECTOR_PROOF_AUTH_PROFILE', value => value === 'signed');
  check('VECTOR_PROOF_URL', value => { try { const u = new URL(value); return u.protocol === 'https:' && u.pathname === '/' && !u.search && !u.hash && !u.username && !u.password; } catch { return false; } });
  check('WFM_EXPECTED_CANDIDATE_SHA', value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value));
  for (const name of ['EXPECTED_DEPLOYMENT_ID','EXPECTED_IMPLEMENTATION_TENANT','EXPECTED_IMPLEMENTATION_RUN_ID']) check(name, value => bounded(value, 160));
  check('EXPECTED_CONFIGURATION_DIGEST', value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
  check('PROOF_PRIVATE_KEY_B64', value => {
    try {
      if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length > 8192) return false;
      const decoded = Buffer.from(value, 'base64');
      if (decoded.toString('base64') !== value) return false;
      const pem = decoded.toString('utf8');
      return /^-----BEGIN PRIVATE KEY-----\r?\n[\s\S]+\r?\n-----END PRIVATE KEY-----\r?\n?$/.test(pem) &&
        createPrivateKey(pem).asymmetricKeyType === 'ed25519';
    } catch { return false; }
  });
  check('VECTOR_PROOF_ACTORS_JSON', value => {
    try {
      const actors = JSON.parse(value), roles = {'manager':'manager','employee':'employee','payroll':'payroll_admin','company-admin':'director','isolation-manager':'manager'};
      return Array.isArray(actors) && actors.length === 5 &&
        actors.every(a => a && typeof a === 'object' && !Array.isArray(a) && ['slug','email','tenant','role'].every(key => bounded(a[key], 240))) &&
        new Set(actors.map(a => a.email.toLowerCase())).size === 5 &&
        Object.entries(roles).every(([slug, role]) => {
          const matches = actors.filter(a => a.slug === slug);
          if (matches.length !== 1) return false;
          const a = matches[0];
          return a.role === role && typeof a.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email) && typeof a.tenant === 'string' && a.tenant.length > 0 &&
            (slug === 'isolation-manager' ? a.tenant !== env.EXPECTED_IMPLEMENTATION_TENANT : a.tenant === env.EXPECTED_IMPLEMENTATION_TENANT);
        });
    } catch { return false; }
  });
  return {status: missing.length || invalid.length ? 'BLOCKED' : 'CONFIGURATION_VALID', missing, invalid,
    scope: 'Offline configuration validation only; no session issued, server authorization or customer proof established.'};
}
if (require.main === module) { const result = inspectProofAccess(); console.log(JSON.stringify(result)); process.exitCode = result.status === 'BLOCKED' ? 1 : 0; }
module.exports = {inspectProofAccess};
