'use strict';

const core = require('./workforce-lifecycle-core.cjs');
const {
  PREFIX: ACTION_EVIDENCE_PREFIX,
  createWorkflowActionEvidenceBridge
} = require('./workflow-action-evidence-bridge.cjs');
const {
  PREFIX: OPERATIONS_BOT_PREFIX,
  createVectorOperationsBot
} = require('./vector-operations-bot.cjs');

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
  const operationsBot = createVectorOperationsBot({
    dbPath,
    ...(options.operationsBotLanguageProvider
      ? { languageProvider: options.operationsBotLanguageProvider }
      : {}),
    ...(typeof options.operationsBotIntentProvider === 'function'
      ? { intentProvider: options.operationsBotIntentProvider }
      : {})
  });

  return Object.freeze({
    async handleRequest(req, res) {
      if (requestPath(req).startsWith(OPERATIONS_BOT_PREFIX)) {
        return await operationsBot.handleRequest(req, res);
      }
      if (requestPath(req).startsWith(ACTION_EVIDENCE_PREFIX)) {
        return await actionEvidence.handleRequest(req, res);
      }
      return await lifecycle.handleRequest(req, res);
    },
    close() {
      try { operationsBot.close(); } catch {}
      try { actionEvidence.close(); } catch {}
      try { lifecycle.close(); } catch {}
    }
  });
}

module.exports = Object.freeze({
  ...core,
  createWorkforceLifecycleGuard
});
