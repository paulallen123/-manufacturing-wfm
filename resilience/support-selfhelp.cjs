'use strict';

const EVIDENCE_VERSION = '0.6.76-hosted-staging-rc1';
const KNOWN_ROLES = Object.freeze(['employee','manager','payroll','company-admin','support']);

const KNOWLEDGE = Object.freeze([
  {
    id: 'environment-production-status',
    patterns: [/production approved/i,/is this production/i,/live production/i,/real customer data/i],
    answer: 'This customer-proof environment is isolated fictional-data staging and is not production approved.',
    sources: ['DEPLOYMENT_MANIFEST.json','CUSTOMER_DEMO_RUNBOOK.md'],
    roles: ['employee','manager','payroll','company-admin','support']
  },
  {
    id: 'integration-recovery',
    patterns: [/integration.*(timeout|failed|failure|retry)|provider.*(timeout|failed|failure)|transfer.*failed/i],
    answer: 'A customer report creates evidence and investigation work but cannot grant repair authority. Known recovery requires same-tenant deterministic system evidence plus independent verification before an allowlisted retry/replay can execute.',
    sources: ['resilience/proofs/2026-09-17-support-incident-bounded-recovery.json','resilience/security-baseline.json'],
    roles: ['manager','payroll','company-admin','support']
  },
  {
    id: 'provider-certification-status',
    patterns: [/\b(?:netsuite|successfactors|sap|oracle hcm)\b|provider certification/i],
    answer: 'Do not claim a genuine live NetSuite, SAP SuccessFactors or Oracle HCM production integration unless a separately authorised provider test has been completed and evidenced.',
    sources: ['CUSTOMER_DEMO_RUNBOOK.md','DEPLOYMENT_MANIFEST.json'],
    roles: ['manager','payroll','company-admin','support']
  },
  {
    id: 'clocking-hardware',
    patterns: [/clock(ing)? hardware|terminal|kiosk|tablet|clock in/i],
    answer: 'The current product includes a low-friction browser/tablet kiosk path and is designed not to require an expensive proprietary terminal.',
    sources: ['CUSTOMER_DEMO_RUNBOOK.md'],
    roles: ['employee','manager','company-admin','support']
  },
  {
    id: 'payroll-control',
    patterns: [/(missed clock|clock.?out|time correction|attendance exception|payroll (review|control|handoff))/i],
    answer: 'Attendance exceptions are reviewed through time-review/payroll-control evidence before payroll handoff. The autonomous support layer does not have direct payroll-write or payroll-release authority.',
    sources: ['CUSTOMER_DEMO_RUNBOOK.md','resilience/security-baseline.json','resilience/failure-scenarios.json'],
    roles: ['employee','manager','payroll','company-admin','support']
  },
  {
    id: 'autonomous-authority',
    patterns: [/can (the )?(ai|assistant|bot).*change|autonomous.*(payroll|permission|schedule)|ignore.*safeguard|bypass.*approval/i],
    answer: 'No language model has direct authority over consequential actions. Payroll writes, identity grants/disables, security policy/secrets, tenant-boundary changes and other prohibited action classes remain blocked by deterministic policy.',
    sources: ['resilience/security-baseline.json','resilience/support-tier-contract.json'],
    roles: ['employee','manager','payroll','company-admin','support']
  }
]);

function normalise(value) {
  return String(value || '').normalize('NFKC').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F]/g, '').trim().slice(0, 4000);
}

function abstain(reason, { version=EVIDENCE_VERSION, role='support', sources=['SUPPORT_TIER_CONTRACT.md'] } = {}) {
  return { status:'abstain', reason, version, role, actionAuthority:false, sources:[...sources] };
}

function answer({ text, role='support', version=EVIDENCE_VERSION, tenant='', targetTenant='' } = {}) {
  const q = normalise(text);
  const r = normalise(role).toLowerCase();
  const requestedVersion = normalise(version) || EVIDENCE_VERSION;
  const sourceTenant = normalise(tenant);
  const requestedTenant = normalise(targetTenant || sourceTenant);

  if (!q) return abstain('empty-question', { version:EVIDENCE_VERSION, role:r || 'support', sources:[] });
  if (!KNOWN_ROLES.includes(r)) return abstain('unrecognised-role', { version:EVIDENCE_VERSION, role:r || 'unknown' });
  if (requestedVersion !== EVIDENCE_VERSION) {
    return abstain('unsupported-or-stale-version', { version:EVIDENCE_VERSION, role:r });
  }
  if (sourceTenant && requestedTenant && sourceTenant !== requestedTenant) {
    return abstain('tenant-context-mismatch', {
      version:EVIDENCE_VERSION,
      role:r,
      sources:['resilience/security-baseline.json','resilience/support-tier-contract.json']
    });
  }

  const compact = q.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const secretExfiltration = /reveal.{0,30}(secret|password|token)|system prompt/i.test(q)
    || /reveal.{0,30}(secret|password|token)|systemprompt/.test(compact);
  if (secretExfiltration) {
    return abstain('untrusted-instruction-shaped-input', {
      version:EVIDENCE_VERSION,
      role:r,
      sources:['resilience/security-baseline.json']
    });
  }

  const authorityQuestion = /can (the )?(ai|assistant|bot).*change|autonomous.*(payroll|permission|schedule)/i.test(q);
  const instructionShaped = /(ignore|override|bypass|disable).{0,40}(safeguard|policy|approval|security)/i.test(q)
    || /(ignore|override|bypass|disable).{0,40}(safeguard|policy|approval|security)/.test(compact);
  if (instructionShaped && !authorityQuestion) {
    return abstain('untrusted-instruction-shaped-input', {
      version:EVIDENCE_VERSION,
      role:r,
      sources:['resilience/security-baseline.json']
    });
  }

  let matches = KNOWLEDGE.filter(item => item.roles.includes(r) && item.patterns.some(re => re.test(q)));

  // A named provider inside an explicit failure/retry question is recovery evidence,
  // not a second certification-status intent. Keep that known overlap deterministic.
  if (matches.some(item => item.id === 'integration-recovery')) {
    matches = matches.filter(item => item.id !== 'provider-certification-status');
  }

  if (matches.length > 1) {
    return abstain('ambiguous-multi-intent', {
      version:EVIDENCE_VERSION,
      role:r,
      sources:['SUPPORT_TIER_CONTRACT.md','resilience/security-baseline.json']
    });
  }

  const item = matches[0];
  if (item) {
    return {
      status:'answered',
      intent:item.id,
      answer:item.answer,
      version:EVIDENCE_VERSION,
      role:r,
      actionAuthority:false,
      sources:[...item.sources]
    };
  }

  return abstain('unknown-or-unverified-procedure', { version:EVIDENCE_VERSION, role:r });
}

module.exports = { answer, KNOWLEDGE, EVIDENCE_VERSION, KNOWN_ROLES };
