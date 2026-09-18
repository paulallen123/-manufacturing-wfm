import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateRoleRenderEvidence({ context, diagnostic, policy }) {
  const errors = [];
  const warnings = [];
  const metrics = {
    requiredRoles: 0,
    contextRoles: Array.isArray(context?.roles) ? context.roles.length : 0,
    diagnosticRoles: Array.isArray(diagnostic?.roles) ? diagnostic.roles.length : 0,
    genericShellInitiallyObserved: 0,
    convergedRoles: 0,
    failedRoles: [],
  };

  const fail = (code, role, detail = {}) => {
    errors.push({ code, role, ...detail });
    if (role && !metrics.failedRoles.includes(role)) metrics.failedRoles.push(role);
  };
  const warn = (code, role, detail = {}) => warnings.push({ code, role, ...detail });

  if (!context || !Array.isArray(context.roles)) {
    fail('CONTEXT_EVIDENCE_MISSING', null);
  }
  if (!diagnostic || !Array.isArray(diagnostic.roles)) {
    fail('DIAGNOSTIC_EVIDENCE_MISSING', null);
  }
  if (!policy || !policy.required_roles || !Array.isArray(policy.known_generic_shell_sha256)) {
    fail('POLICY_INVALID', null);
  }
  if (errors.some(e => ['CONTEXT_EVIDENCE_MISSING', 'DIAGNOSTIC_EVIDENCE_MISSING', 'POLICY_INVALID'].includes(e.code))) {
    return { result: 'FAIL', errors, warnings, metrics };
  }

  const required = Object.entries(policy.required_roles);
  metrics.requiredRoles = required.length;
  const generic = new Set(policy.known_generic_shell_sha256.map(String));
  const contextBySlug = new Map();
  const diagBySlug = new Map();

  for (const role of context.roles) {
    if (!role?.slug) continue;
    if (contextBySlug.has(role.slug)) fail('DUPLICATE_CONTEXT_ROLE', role.slug);
    else contextBySlug.set(role.slug, role);
  }
  for (const role of diagnostic.roles) {
    if (!role?.slug) continue;
    if (diagBySlug.has(role.slug)) fail('DUPLICATE_DIAGNOSTIC_ROLE', role.slug);
    else diagBySlug.set(role.slug, role);
  }

  for (const [slug, expectedRole] of required) {
    const ctx = contextBySlug.get(slug);
    const diag = diagBySlug.get(slug);
    if (!ctx) { fail('REQUIRED_CONTEXT_ROLE_MISSING', slug); continue; }
    if (!diag) { fail('REQUIRED_DIAGNOSTIC_ROLE_MISSING', slug); continue; }

    if (String(ctx.role || ctx.expectedRole || '') !== expectedRole) {
      fail('CONTEXT_ROLE_IDENTITY_MISMATCH', slug, { expectedRole, observedRole: ctx.role || ctx.expectedRole || null });
    }
    if (String(diag.role || '') !== expectedRole) {
      fail('DIAGNOSTIC_ROLE_IDENTITY_MISMATCH', slug, { expectedRole, observedRole: diag.role || null });
    }

    const authenticatedBootstrap = ctx.rendered?.authenticatedBootstrapAfterNavigation;
    if (authenticatedBootstrap !== true) {
      fail('AUTHENTICATED_BOOTSTRAP_NOT_PROVEN', slug, { observed: authenticatedBootstrap ?? null });
    }

    const initialHash = String(ctx.rendered?.domSha256 || '');
    const finalHash = String(diag.htmlSha256 || '');
    if (generic.has(initialHash)) {
      metrics.genericShellInitiallyObserved += 1;
      warn('GENERIC_SHELL_OBSERVED_BEFORE_CONVERGENCE', slug, { domSha256: initialHash, domLength: ctx.rendered?.domLength ?? null });
    }

    if (!finalHash || finalHash.length !== 64) {
      fail('FINAL_DOM_HASH_MISSING_OR_INVALID', slug, { observed: finalHash || null });
    }
    if (generic.has(finalHash)) {
      fail('ROLE_RENDER_NOT_CONVERGED', slug, { domSha256: finalHash, domLength: diag.htmlLength ?? null });
    }

    const minDom = Number(policy.minimum_rendered_dom_bytes ?? 1000);
    if (!Number.isFinite(diag.htmlLength) || diag.htmlLength < minDom) {
      fail('FINAL_DOM_TOO_SMALL', slug, { minimum: minDom, observed: diag.htmlLength ?? null });
    }

    const minControls = Number(policy.minimum_accessible_interactive_controls ?? 1);
    if (!Number.isFinite(diag.controlCount) || diag.controlCount < minControls) {
      fail('ACCESSIBLE_CONTROLS_BELOW_FLOOR', slug, { minimum: minControls, observed: diag.controlCount ?? null });
    }

    if (diag.pass !== true) {
      fail('ROLE_DIAGNOSTIC_NOT_PASSING', slug, { observed: diag.pass ?? null });
    }

    if (typeof diag.screenshotStatus === 'string' && diag.screenshotStatus.startsWith('BLOCKED:')) {
      warn('SCREENSHOT_CAPTURE_BLOCKED', slug, { status: diag.screenshotStatus });
    }

    if (!errors.some(e => e.role === slug)) metrics.convergedRoles += 1;
  }

  if (context.result === 'PASS' && metrics.genericShellInitiallyObserved > 0) {
    warn('WEAK_CONTEXT_ORACLE_REPORTED_PASS_ON_GENERIC_SHELL', null, {
      affectedRoles: [...new Set(warnings.filter(w => w.code === 'GENERIC_SHELL_OBSERVED_BEFORE_CONVERGENCE').map(w => w.role))]
    });
  }

  return {
    result: errors.length ? 'FAIL' : 'PASS',
    errors,
    warnings,
    metrics,
    preventionCoverage: 'authenticated API/context evidence is cross-correlated with final role-render convergence and accessible controls; generic-shell false greens are rejected'
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const [contextFile, diagnosticFile, policyFile = 'reliability/role-render-admission-policy.json'] = process.argv.slice(2);
  if (!contextFile || !diagnosticFile) {
    console.error('usage: node scripts/validate-role-render-evidence.mjs <context.json> <diagnostic.json> [policy.json]');
    process.exit(2);
  }
  const result = validateRoleRenderEvidence({
    context: readJson(contextFile),
    diagnostic: readJson(diagnosticFile),
    policy: readJson(policyFile),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.result !== 'PASS') process.exit(1);
}
