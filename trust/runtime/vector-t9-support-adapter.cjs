'use strict';

const {
  EvidenceLedger,
  createCausalEpisode,
  digest,
} = require('./vector-trust-spine.cjs');

function clean(value, max = 180) {
  return String(value ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function isoFromEpoch(value, fallbackNow = Date.now) {
  const n = Number(value);
  const ms = Number.isFinite(n) ? n : Number(fallbackNow());
  return new Date(ms).toISOString();
}

function recordSupportReceipt({ ledger, receipt, input = {}, now = Date.now } = {}) {
  if (!(ledger instanceof EvidenceLedger)) throw new Error('T9 support adapter requires an EvidenceLedger.');
  const tenant = clean(receipt?.tenant, 120);
  const incidentId = clean(receipt?.incidentId, 160);
  const scenarioId = clean(receipt?.scenarioId, 160);
  const tier = clean(receipt?.tier, 20);
  const outcome = clean(receipt?.outcome, 120);
  const evidenceDigest = clean(receipt?.evidenceDigest, 64).toLowerCase();

  if (!tenant || !incidentId || !scenarioId || !tier || !outcome) {
    throw new Error('T9 support evidence requires a complete support terminal receipt.');
  }
  if (receipt?.safeTerminal !== true) throw new Error('T9 support evidence accepts only safe terminal receipts.');
  if (!/^[a-f0-9]{64}$/.test(evidenceDigest)) throw new Error('T9 support evidence requires the retained incident evidence digest.');
  if (input?.tenant && clean(input.tenant, 120) !== tenant) throw new Error('T9 support receipt tenant does not match the incident request.');

  const observedAt = isoFromEpoch(receipt.endedAt, now);
  const incidentEvidence = ledger.append({
    id: 'support-incident:' + incidentId,
    tenant,
    subjectId: incidentId,
    claimKey: 'support.incident.classification',
    value: {
      scenarioId,
      tier,
      evidenceDigest,
      crossTenantAttempt: Boolean(input?.targetTenant && clean(input.targetTenant, 120) !== tenant),
    },
    epistemicType: 'DERIVED_FACT',
    sourceSystem: 'vector-autonomy-control-loop',
    sourceIdentity: 'resilience/autonomy-control-loop.cjs',
    observedAt,
    effectiveAt: isoFromEpoch(receipt.startedAt, now),
    sourceTrust: 1,
    confidence: 1,
    transformationRef: 'support-tier-classification',
  });

  const terminalEvidence = ledger.append({
    id: 'support-terminal:' + incidentId,
    tenant,
    subjectId: incidentId,
    claimKey: 'support.incident.terminal_outcome',
    value: {
      outcome,
      safeTerminal: true,
      actionCount: Number(receipt.actionCount || 0),
      productionMutation: receipt.productionMutation === true,
      productionAuthorityGranted: receipt.productionAuthorityGranted === true,
      customerMutation: receipt.customerMutation === true,
      receiptDigest: clean(receipt.receiptDigest, 64),
    },
    epistemicType: 'OBSERVED_FACT',
    sourceSystem: 'vector-autonomy-control-loop',
    sourceIdentity: 'resilience/autonomy-control-loop.cjs',
    observedAt,
    effectiveAt: observedAt,
    sourceTrust: 1,
    confidence: 1,
    authorityRef: clean(receipt.receiptDigest, 64) || null,
  });

  let causalEpisode = null;
  if (outcome === 'recovered' || outcome === 'rolled_back_to_known_good') {
    causalEpisode = createCausalEpisode({
      episodeId: 'support-learning:' + incidentId,
      tenant,
      observedAt,
      contextRevision: clean(receipt.receiptDigest, 64) || 'support-terminal',
      evidenceRefs: [incidentEvidence.id],
      alternatives: [
        { id: 'contain', description: 'Contain and preserve minimum safe service.' },
        { id: 'verified-recovery', description: 'Execute the bounded verified recovery selected by the support control loop.' },
      ],
      selectedActionId: 'verified-recovery',
      prediction: null,
      outcomeRefs: [terminalEvidence.id],
      causalHypothesis: {
        statement: 'The bounded verified recovery may have contributed to the observed safe terminal outcome.',
        status: 'HYPOTHESIS_REQUIRES_COUNTERFACTUAL_SUPPORT',
      },
      counterfactualStatus: 'NOT_EVALUATED',
    });
  }

  return Object.freeze({
    contractVersion: 'VECTOR_T9_SUPPORT_EVIDENCE_V1',
    incidentEvidenceId: incidentEvidence.id,
    terminalEvidenceId: terminalEvidence.id,
    evidenceLedgerHeadDigest: ledger.headDigest,
    causalEpisode,
    recordDigest: digest({
      tenant,
      incidentId,
      scenarioId,
      tier,
      outcome,
      incidentEvidenceId: incidentEvidence.id,
      terminalEvidenceId: terminalEvidence.id,
      causalEpisodeDigest: causalEpisode?.episodeDigest || null,
    }),
  });
}

function createT9SupportLoop({ controlLoop, ledger = new EvidenceLedger(), now = Date.now } = {}) {
  if (!controlLoop || typeof controlLoop.run !== 'function') throw new Error('T9 support loop requires the existing autonomous support control loop.');

  async function run(input = {}) {
    const receipt = await controlLoop.run(input);
    const t9 = recordSupportReceipt({ ledger, receipt, input, now });
    return Object.freeze({ ...receipt, t9 });
  }

  function verifyReceipt(receipt) {
    const base = { ...receipt };
    delete base.t9;
    return typeof controlLoop.verifyReceipt === 'function'
      ? controlLoop.verifyReceipt(base)
      : Boolean(base.safeTerminal && base.receiptDigest);
  }

  return Object.freeze({
    run,
    verifyReceipt,
    ledger,
  });
}

module.exports = Object.freeze({
  recordSupportReceipt,
  createT9SupportLoop,
});
