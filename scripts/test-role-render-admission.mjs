import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateRoleRenderEvidence } from './validate-role-render-evidence.mjs';

const fixture = JSON.parse(fs.readFileSync('reliability/fixtures/role-render-convergence.json', 'utf8'));
const policy = JSON.parse(fs.readFileSync('reliability/role-render-admission-policy.json', 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));

function run(context, diagnostic) {
  return validateRoleRenderEvidence({ context, diagnostic, policy });
}

function overrideRole(diagnostic, slug, patch) {
  const out = clone(diagnostic);
  const role = out.roles.find(r => r.slug === slug);
  assert.ok(role, `fixture role ${slug} missing`);
  Object.assign(role, patch);
  out.pass = out.roles.every(r => r.pass === true);
  return out;
}

const observed = run(fixture.observed_failure.context, fixture.observed_failure.diagnostic);
assert.equal(observed.result, 'FAIL');
assert.ok(observed.errors.some(e => e.code === 'ROLE_RENDER_NOT_CONVERGED' && e.role === 'employee'));
assert.ok(observed.errors.some(e => e.code === 'ACCESSIBLE_CONTROLS_BELOW_FLOOR' && e.role === 'employee'));
assert.ok(observed.warnings.some(w => w.code === 'WEAK_CONTEXT_ORACLE_REPORTED_PASS_ON_GENERIC_SHELL'));
assert.equal(observed.metrics.convergedRoles, 3);
assert.deepEqual(observed.metrics.failedRoles, ['employee']);

const falseGreenDiagnostic = overrideRole(
  fixture.observed_failure.diagnostic,
  'employee',
  fixture.false_green_variant.employee_override
);
const falseGreen = run(fixture.observed_failure.context, falseGreenDiagnostic);
assert.equal(falseGreen.result, 'FAIL', 'Changing a weak pass flag must never certify a generic shell with zero controls.');
assert.ok(falseGreen.errors.some(e => e.code === 'ROLE_RENDER_NOT_CONVERGED' && e.role === 'employee'));
assert.ok(falseGreen.errors.some(e => e.code === 'ACCESSIBLE_CONTROLS_BELOW_FLOOR' && e.role === 'employee'));

const healthyDiagnostic = overrideRole(
  fixture.observed_failure.diagnostic,
  'employee',
  fixture.healthy_variant.employee_override
);
const healthy = run(fixture.observed_failure.context, healthyDiagnostic);
assert.equal(healthy.result, 'PASS');
assert.equal(healthy.metrics.convergedRoles, 4);
assert.equal(healthy.metrics.failedRoles.length, 0);

const screenshotDegradedDiagnostic = overrideRole(
  healthyDiagnostic,
  'manager',
  fixture.screenshot_only_degradation_variant.manager_override
);
const screenshotDegraded = run(fixture.observed_failure.context, screenshotDegradedDiagnostic);
assert.equal(screenshotDegraded.result, 'PASS', 'Screenshot-only degradation must remain diagnostic when role convergence is healthy.');
assert.ok(screenshotDegraded.warnings.some(w => w.code === 'SCREENSHOT_CAPTURE_BLOCKED' && w.role === 'manager'));

const missingRoleContext = clone(fixture.observed_failure.context);
missingRoleContext.roles = missingRoleContext.roles.filter(r => r.slug !== 'payroll');
const missingRole = run(missingRoleContext, healthyDiagnostic);
assert.equal(missingRole.result, 'FAIL');
assert.ok(missingRole.errors.some(e => e.code === 'REQUIRED_CONTEXT_ROLE_MISSING' && e.role === 'payroll'));

const badBootstrapContext = clone(fixture.observed_failure.context);
badBootstrapContext.roles.find(r => r.slug === 'manager').rendered.authenticatedBootstrapAfterNavigation = false;
const badBootstrap = run(badBootstrapContext, healthyDiagnostic);
assert.equal(badBootstrap.result, 'FAIL');
assert.ok(badBootstrap.errors.some(e => e.code === 'AUTHENTICATED_BOOTSTRAP_NOT_PROVEN' && e.role === 'manager'));

console.log('ROLE_RENDER_ADMISSION_FIXTURES=PASS|cases=6');
console.log(`OBSERVED_FAILURE_CODES=${[...new Set(observed.errors.map(e => e.code))].join(',')}`);
console.log('PREVENTION=generic-shell and zero-control false greens are rejected even when authentication/API context and a legacy pass flag succeed');
