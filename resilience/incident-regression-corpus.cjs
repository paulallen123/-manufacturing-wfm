'use strict';

const { createHash } = require('node:crypto');

const HEX64 = /^[a-f0-9]{64}$/;
const ALLOWED_DECISIONS = new Set(['NEVER_AUTOMATE', 'SAFE_RUNBOOK_CANDIDATE']);
const CORPUS_SCHEMA_VERSION = 2;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
}

function clean(value, max = 160) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function deny(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function verifiedLearning(learning) {
  if (!learning || typeof learning !== 'object') return false;
  if (!HEX64.test(String(learning.learningDigest || ''))) return false;
  if (!HEX64.test(String(learning.sourceReceiptDigest || ''))) return false;
  if (!HEX64.test(String(learning.sourceEvidenceDigest || ''))) return false;
  if (learning.regressionFixture?.required !== true) return false;
  if (!HEX64.test(String(learning.regressionFixture?.fixtureDigest || ''))) return false;
  if (learning.regressionFixture?.sourceReceiptDigest !== learning.sourceReceiptDigest) return false;
  if (learning.regressionFixture?.containsCustomerText !== false) return false;
  if (learning.regressionFixture?.containsReusableSecret !== false) return false;
  if (learning.detectionRuleProposal?.required !== true) return false;
  if (!HEX64.test(String(learning.detectionRuleProposal?.signalDigest || ''))) return false;
  if (learning.detectionRuleProposal?.tenantScoped !== true) return false;
  if (learning.detectionRuleProposal?.crossTenantMatching !== false) return false;
  if (learning.detectionRuleProposal?.productionWriteAuthority !== false) return false;
  if (learning.supportKnowledgeProposal?.includeRawCustomerText !== false) return false;
  if (learning.supportKnowledgeProposal?.includeModelOutputAsAuthority !== false) return false;
  if (learning.supportKnowledgeProposal?.includeReusableCredential !== false) return false;
  if (!ALLOWED_DECISIONS.has(learning.runbookDecision?.decision)) return false;
  if (learning.runbookDecision?.automaticProductionAuthority !== false) return false;
  if (learning.authority?.actionAuthority !== false
    || learning.authority?.productionAuthority !== false
    || learning.authority?.releaseAuthority !== false
    || learning.authority?.credentialAuthority !== false
    || learning.authority?.customerMutation !== false
    || learning.authority?.crossTenantMutation !== false
    || learning.authority?.writeScope !== 'proposal-only') return false;
  const copy = { ...learning };
  delete copy.learningDigest;
  return digest(copy) === learning.learningDigest;
}

function validateTerminalReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') deny('WFM_CORPUS_RECEIPT', 'Terminal receipt is required.');
  const incidentId = clean(receipt.incidentId, 120);
  const tenant = clean(receipt.tenant, 100);
  const scenarioId = clean(receipt.scenarioId, 120);
  const tier = clean(receipt.tier, 8);
  const outcome = clean(receipt.outcome, 120);
  const receiptDigest = clean(receipt.receiptDigest, 64).toLowerCase();
  const evidenceDigest = clean(receipt.evidenceDigest, 64).toLowerCase();
  const safeTerminal = receipt.safeTerminal === true;
  if (!incidentId || !tenant || !scenarioId || !tier || !outcome) deny('WFM_CORPUS_RECEIPT', 'Receipt identity and terminal fields are required.');
  if (!HEX64.test(receiptDigest) || !HEX64.test(evidenceDigest)) deny('WFM_CORPUS_RECEIPT', 'Receipt and evidence digests must be SHA-256.');
  if (receipt.productionMutation === true || receipt.productionAuthorityGranted === true || receipt.customerMutation === true) {
    deny('WFM_CORPUS_AUTHORITY', 'Regression corpus accepts evidence-only receipts.');
  }
  if (!verifiedLearning(receipt.learning)) deny('WFM_CORPUS_LEARNING', 'Verified regression-required learning record is required.');
  if (receipt.learning.sourceReceiptDigest !== receiptDigest || receipt.learning.sourceEvidenceDigest !== evidenceDigest) {
    deny('WFM_CORPUS_BINDING', 'Learning record is not bound to this terminal receipt.');
  }
  if (receipt.learning.incidentId !== incidentId || receipt.learning.tenant !== tenant) {
    deny('WFM_CORPUS_BINDING', 'Learning incident/tenant identity does not match terminal receipt.');
  }
  if (receipt.learning.scenarioId !== scenarioId || receipt.learning.tier !== tier || receipt.learning.outcome !== outcome) {
    deny('WFM_CORPUS_BINDING', 'Learning identity does not match terminal receipt.');
  }
  if (receipt.learning.safeTerminal !== safeTerminal) {
    deny('WFM_CORPUS_BINDING', 'Learning terminal-safety state does not match terminal receipt.');
  }
  return { incidentId, tenant, scenarioId, tier, outcome, safeTerminal, receiptDigest, evidenceDigest };
}

function genesisDigest() {
  return digest({ schemaVersion: CORPUS_SCHEMA_VERSION, corpus: 'wfm-incident-regression-corpus', mode: 'append-only', tenantIsolation: 'digest-scoped' });
}

function expectedCaseKey(entry) {
  return digest({
    tenantScopeDigest: entry.tenantScopeDigest,
    tier: entry.tier,
    scenarioId: entry.scenarioId,
    outcome: entry.expectedOutcome,
    safeTerminal: entry.safeTerminalObserved,
    detectionSignalDigest: entry.detectionSignalDigest,
    runbookDecision: entry.runbookDecision,
  });
}

function createIncidentRegressionCorpus({ initialSnapshot = null, maxEntries = 10000 } = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 100000) {
    throw new Error('maxEntries must be between 1 and 100000.');
  }

  const entries = [];
  const byCaseKey = new Map();
  let tipDigest = genesisDigest();

  function verifyEntry(entry, expectedSequence, expectedPrevious) {
    if (!entry || entry.schemaVersion !== CORPUS_SCHEMA_VERSION || entry.sequence !== expectedSequence) return false;
    if (entry.previousEntryDigest !== expectedPrevious) return false;
    if (!HEX64.test(String(entry.entryDigest || '')) || !HEX64.test(String(entry.caseKeyDigest || ''))) return false;
    if (!HEX64.test(String(entry.regressionFixtureDigest || '')) || !HEX64.test(String(entry.learningDigest || ''))) return false;
    if (!HEX64.test(String(entry.sourceReceiptDigest || '')) || !HEX64.test(String(entry.sourceEvidenceDigest || ''))) return false;
    if (!HEX64.test(String(entry.tenantScopeDigest || ''))) return false;
    if (entry.caseKeyDigest !== expectedCaseKey(entry)) return false;
    if (entry.mandatoryReplay !== true || entry.containsCustomerText !== false || entry.containsReusableSecret !== false) return false;
    if (entry.authority?.actionAuthority !== false
      || entry.authority?.productionAuthority !== false
      || entry.authority?.releaseAuthority !== false
      || entry.authority?.credentialAuthority !== false
      || entry.authority?.customerMutation !== false
      || entry.authority?.crossTenantMutation !== false
      || entry.authority?.writeScope !== 'append-only-evidence') return false;
    const copy = { ...entry };
    delete copy.entryDigest;
    return digest(copy) === entry.entryDigest;
  }

  function verifySnapshot(snapshot) {
    if (!snapshot || snapshot.schemaVersion !== CORPUS_SCHEMA_VERSION || snapshot.mode !== 'append-only' || snapshot.tenantIsolation !== 'digest-scoped') return false;
    if (!Array.isArray(snapshot.entries) || !HEX64.test(String(snapshot.tipDigest || '')) || !HEX64.test(String(snapshot.corpusDigest || ''))) return false;
    if (!Number.isSafeInteger(snapshot.entryCount) || snapshot.entryCount !== snapshot.entries.length) return false;
    if (snapshot.entries.length > maxEntries) return false;
    let previous = genesisDigest();
    const seen = new Set();
    for (let index = 0; index < snapshot.entries.length; index += 1) {
      const entry = snapshot.entries[index];
      if (!verifyEntry(entry, index + 1, previous)) return false;
      if (seen.has(entry.caseKeyDigest)) return false;
      seen.add(entry.caseKeyDigest);
      previous = entry.entryDigest;
    }
    if (snapshot.tipDigest !== previous) return false;
    const core = {
      schemaVersion: CORPUS_SCHEMA_VERSION,
      mode: 'append-only',
      tenantIsolation: 'digest-scoped',
      entryCount: snapshot.entries.length,
      tipDigest: snapshot.tipDigest,
      entries: snapshot.entries,
      authority: snapshot.authority,
    };
    if (snapshot.authority?.actionAuthority !== false
      || snapshot.authority?.productionAuthority !== false
      || snapshot.authority?.releaseAuthority !== false
      || snapshot.authority?.credentialAuthority !== false
      || snapshot.authority?.customerMutation !== false
      || snapshot.authority?.crossTenantMutation !== false) return false;
    return digest(core) === snapshot.corpusDigest;
  }

  function load(snapshot) {
    if (!verifySnapshot(snapshot)) deny('WFM_CORPUS_SNAPSHOT', 'Initial corpus snapshot failed integrity verification.');
    if (snapshot.entries.length > maxEntries) deny('WFM_CORPUS_CAPACITY', 'Initial corpus exceeds maximum entry count.');
    for (const entry of snapshot.entries) {
      entries.push(structuredClone(entry));
      byCaseKey.set(entry.caseKeyDigest, entry.entryDigest);
    }
    tipDigest = snapshot.tipDigest;
  }

  function record(receipt) {
    const base = validateTerminalReceipt(receipt);
    const learning = receipt.learning;
    const tenantScopeDigest = digest(base.tenant);
    const caseKeyDigest = digest({
      tenantScopeDigest,
      tier: base.tier,
      scenarioId: base.scenarioId,
      outcome: base.outcome,
      safeTerminal: base.safeTerminal,
      detectionSignalDigest: learning.detectionRuleProposal.signalDigest,
      runbookDecision: learning.runbookDecision.decision,
    });

    const existingDigest = byCaseKey.get(caseKeyDigest);
    if (existingDigest) {
      const existing = entries.find((entry) => entry.entryDigest === existingDigest);
      return {
        status: 'DEDUPLICATED_EXISTING_MANDATORY_CASE',
        caseKeyDigest,
        entryDigest: existingDigest,
        sequence: existing?.sequence || null,
        mandatoryReplay: true,
      };
    }
    if (entries.length >= maxEntries) deny('WFM_CORPUS_CAPACITY', 'Regression corpus append limit reached.');

    const core = {
      schemaVersion: CORPUS_SCHEMA_VERSION,
      sequence: entries.length + 1,
      previousEntryDigest: tipDigest,
      caseKeyDigest,
      regressionFixtureDigest: learning.regressionFixture.fixtureDigest,
      learningDigest: learning.learningDigest,
      sourceReceiptDigest: base.receiptDigest,
      sourceEvidenceDigest: base.evidenceDigest,
      tenantScopeDigest,
      tier: base.tier,
      scenarioId: base.scenarioId,
      expectedOutcome: base.outcome,
      safeTerminalObserved: base.safeTerminal,
      detectionSignalDigest: learning.detectionRuleProposal.signalDigest,
      runbookDecision: learning.runbookDecision.decision,
      mandatoryReplay: true,
      containsCustomerText: false,
      containsReusableSecret: false,
      authority: {
        actionAuthority: false,
        productionAuthority: false,
        releaseAuthority: false,
        credentialAuthority: false,
        customerMutation: false,
        crossTenantMutation: false,
        writeScope: 'append-only-evidence',
      },
    };
    const entry = { ...core, entryDigest: digest(core) };
    entries.push(entry);
    byCaseKey.set(caseKeyDigest, entry.entryDigest);
    tipDigest = entry.entryDigest;
    return {
      status: 'APPENDED_MANDATORY_CASE',
      caseKeyDigest,
      entryDigest: entry.entryDigest,
      sequence: entry.sequence,
      mandatoryReplay: true,
    };
  }

  function snapshot() {
    const core = {
      schemaVersion: CORPUS_SCHEMA_VERSION,
      mode: 'append-only',
      tenantIsolation: 'digest-scoped',
      entryCount: entries.length,
      tipDigest,
      entries: structuredClone(entries),
      authority: {
        actionAuthority: false,
        productionAuthority: false,
        releaseAuthority: false,
        credentialAuthority: false,
        customerMutation: false,
        crossTenantMutation: false,
      },
    };
    return { ...core, corpusDigest: digest(core) };
  }

  if (initialSnapshot) load(initialSnapshot);

  return {
    record,
    snapshot,
    verifySnapshot,
    mandatoryCases: () => entries.map((entry) => ({
      caseKeyDigest: entry.caseKeyDigest,
      tenantScopeDigest: entry.tenantScopeDigest,
      scenarioId: entry.scenarioId,
      tier: entry.tier,
      expectedOutcome: entry.expectedOutcome,
      safeTerminalObserved: entry.safeTerminalObserved,
      detectionSignalDigest: entry.detectionSignalDigest,
      runbookDecision: entry.runbookDecision,
      mandatoryReplay: true,
    })),
  };
}

function createLearningRecordingControlLoop({ controlLoop, corpus } = {}) {
  if (!controlLoop?.run || !controlLoop?.verifyReceipt) throw new Error('Verified control loop is required.');
  if (!corpus?.record || !corpus?.snapshot) throw new Error('Incident regression corpus is required.');
  return {
    async run(input) {
      const receipt = await controlLoop.run(input);
      if (controlLoop.verifyReceipt(receipt) !== true) deny('WFM_CORPUS_RECEIPT_VERIFY', 'Control-loop terminal receipt failed verification.');
      if (receipt.learning?.regressionFixture?.required === true) corpus.record(receipt);
      return receipt;
    },
    verifyReceipt: (receipt) => controlLoop.verifyReceipt(receipt),
    corpusSnapshot: () => corpus.snapshot(),
    mandatoryCases: () => corpus.mandatoryCases(),
  };
}

module.exports = {
  createIncidentRegressionCorpus,
  createLearningRecordingControlLoop,
  verifiedLearning,
};
