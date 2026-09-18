'use strict';

const KNOWLEDGE = Object.freeze([
  {
    id: 'environment-production-status',
    patterns: [/production approved/i,/is this production/i,/live production/i,/real customer data/i],
    answer: 'This customer-proof environment is isolated fictional-data staging and is not production approved.',
    sources: ['DEPLOYMENT_MANIFEST.json','CUSTOMER_DEMO_RUNBOOK.md'],
    roles: ['employee','manager','payroll','company-admin','support']
  },
  {
    id: 'provider-certification-status',
    patterns: [/netsuite|successfactors|sap|oracle hcm|provider certification/i],
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
    id: 'integration-recovery',
    patterns: [/integration.*(timeout|failed|failure|retry)|provider.*(timeout|failed|failure)|transfer.*failed/i],
    answer: 'A customer report creates evidence and investigation work but cannot grant repair authority. Known recovery requires same-tenant deterministic system evidence plus independent verification before an allowlisted retry/replay can execute.',
    sources: ['resilience/proofs/2026-09-17-support-incident-bounded-recovery.json','resilience/security-baseline.json'],
    roles: ['manager','payroll','company-admin','support']
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
  return String(value || '').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F]/g, '').trim().slice(0, 4000);
}

function answer({ text, role='support', version='0.6.76-hosted-staging-rc1' } = {}) {
  const q = normalise(text);
  const r = normalise(role).toLowerCase();
  if (!q) return { status:'abstain', reason:'empty-question', version, actionAuthority:false, sources:[] };

  const instructionShaped = /(ignore|override|bypass|disable).{0,40}(safeguard|policy|approval|security)|reveal.{0,20}(secret|password|token)|system prompt/i.test(q);
  if (instructionShaped && !/can (the )?(ai|assistant|bot).*change|autonomous.*(payroll|permission|schedule)/i.test(q)) {
    return { status:'abstain', reason:'untrusted-instruction-shaped-input', version, actionAuthority:false, sources:['resilience/security-baseline.json'] };
  }

  for (const item of KNOWLEDGE) {
    if (!item.roles.includes(r)) continue;
    if (item.patterns.some(re => re.test(q))) {
      return {
        status:'answered',
        intent:item.id,
        answer:item.answer,
        version,
        role:r,
        actionAuthority:false,
        sources:[...item.sources]
      };
    }
  }
  return {
    status:'abstain',
    reason:'unknown-or-unverified-procedure',
    version,
    role:r,
    actionAuthority:false,
    sources:['SUPPORT_TIER_CONTRACT.md']
  };
}

module.exports = { answer, KNOWLEDGE };
