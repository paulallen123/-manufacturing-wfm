'use strict';

const { validateDurableStageReceipt } = require('./runtime-ingestion-gate.cjs');

const SETTLEMENT = Object.freeze({
  webhook: 'ACKNOWLEDGE',
  'queue-stream': 'ACKNOWLEDGE_OR_COMMIT',
  'secure-file': 'MARK_PROCESSED',
  'on-prem-agent': 'ACKNOWLEDGE',
  ipaas: 'ACKNOWLEDGE'
});

const NO_EXTERNAL_SETTLEMENT = new Set(['api', 'read-only-db', 'identity']);
const DIGEST = /^[a-f0-9]{32,128}$/i;

function evaluateSourceSettlement(review, observation, stageReceipt, input = {}, now = Date.now()) {
  const transport = String(review?.transport || '').trim().toLowerCase();
  if (NO_EXTERNAL_SETTLEMENT.has(transport)) {
    return Object.freeze({
      action: 'NO_EXTERNAL_SETTLEMENT',
      reason: 'polling-or-directory-transport',
      safe: true
    });
  }
  if (!SETTLEMENT[transport]) {
    return Object.freeze({
      action: 'BLOCK',
      reason: 'unsupported-settlement-transport',
      safe: false,
      blockers: ['External source settlement is not defined for this transport.']
    });
  }

  const stage = validateDurableStageReceipt(review, observation, stageReceipt, now);
  if (!stage.valid) {
    return Object.freeze({
      action: 'BLOCK',
      reason: 'durable-stage-required-before-source-settlement',
      safe: false,
      blockers: stage.blockers
    });
  }

  if (transport === 'secure-file') {
    const sourceDigest = String(input.sourceArtifactDigest || '').trim().toLowerCase();
    const stagedDigest = String(input.stagedArtifactDigest || '').trim().toLowerCase();
    const blockers = [];
    if (input.fileCompletenessVerified !== true) blockers.push('Secure file must be proven complete and stable before it can be marked processed.');
    if (!DIGEST.test(sourceDigest) || !DIGEST.test(stagedDigest)) blockers.push('Secure file settlement requires bounded source and staged artifact digests.');
    if (sourceDigest && stagedDigest && sourceDigest !== stagedDigest) blockers.push('Secure file source and staged artifact digests do not match.');
    if (blockers.length) {
      return Object.freeze({
        action: 'BLOCK',
        reason: 'secure-file-completeness-proof-required',
        safe: false,
        blockers
      });
    }
  }

  return Object.freeze({
    action: SETTLEMENT[transport],
    reason: 'durable-stage-proven',
    safe: true,
    operationKey: stageReceipt.operationKey
  });
}

module.exports = {
  evaluateSourceSettlement
};
