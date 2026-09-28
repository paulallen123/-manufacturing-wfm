'use strict';

const core = require('./workforce-lifecycle-core.cjs');
const {
  PREFIX: ACTION_EVIDENCE_PREFIX,
  createWorkflowActionEvidenceBridge
} = require('./workflow-action-evidence-bridge.cjs');

function requestPath(req) {
  return String(req?.url || '/').split('?')[0] || '/';
}

function createWorkforceLifecycleGuard(options = {}) {
  const dbPath = options.dbPath || process.env.WFM_DB;
  const lifecycle = core.createWorkforceLifecycleGuard(options);
  const actionEvidence = createWorkflowActionEvidenceBridge({
    dbPath,
    ...(typeof options.timeReviewSourceProvider === 'function'
      ? { timeReviewSourceProvider: options.timeReviewSourceProvider }
      : {})
  });

  return Object.freeze({
    async handleRequest(req, res) {
      if (requestPath(req).startsWith(ACTION_EVIDENCE_PREFIX)) {
        return await actionEvidence.handleRequest(req, res);
      }
      return await lifecycle.handleRequest(req, res);
    },
    applyTrustedEvent(input = {}) {
      if (typeof lifecycle.applyTrustedEvent !== 'function') {
        throw new Error('Trusted workforce lifecycle mutation adapter is unavailable.');
      }
      return lifecycle.applyTrustedEvent(input);
    },
    getTrustedEvent(input = {}) {
      if (typeof lifecycle.getTrustedEvent !== 'function') {
        throw new Error('Trusted workforce lifecycle readback adapter is unavailable.');
      }
      return lifecycle.getTrustedEvent(input);
    },
    close() {
      try { actionEvidence.close(); } catch {}
      try { lifecycle.close(); } catch {}
    }
  });
}

module.exports = Object.freeze({
  ...core,
  createWorkforceLifecycleGuard
});
