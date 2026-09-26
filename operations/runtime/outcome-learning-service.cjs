'use strict';

const { DatabaseSync } = require('node:sqlite');
const { pathToFileURL } = require('node:url');
const { createDecisionOutcomeProof, toAdaptiveOutcomeInput } = require('./decision-outcome-proof.cjs');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createOutcomeLearningService(options = {}) {
  const dbPath = options.dbPath || process.env.WFM_DB;
  const engineModulePath = options.engineModulePath || '/app/learning-runtime/evolution/engine.mjs';
  const minRepeatedWins = Math.max(2, Number(options.minRepeatedWins || 3));
  if (!dbPath) throw new Error('Outcome learning service requires WFM_DB.');
  if (!engineModulePath) throw new Error('Outcome learning service requires an adaptive intelligence engine module.');

  const db = new DatabaseSync(dbPath);
  db.exec(
    'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;' +
    'CREATE TABLE IF NOT EXISTS vector_outcome_learning_proofs(' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
      'proof_digest TEXT NOT NULL UNIQUE,' +
      'tenant TEXT NOT NULL,' +
      'proof_json TEXT NOT NULL,' +
      'created_at TEXT NOT NULL);' +
    'CREATE TRIGGER IF NOT EXISTS no_outcome_learning_proof_update BEFORE UPDATE ON vector_outcome_learning_proofs ' +
      "BEGIN SELECT RAISE(ABORT,'Outcome learning proofs are append only.'); END;" +
    'CREATE TRIGGER IF NOT EXISTS no_outcome_learning_proof_delete BEFORE DELETE ON vector_outcome_learning_proofs ' +
      "BEGIN SELECT RAISE(ABORT,'Outcome learning proofs are append only.'); END;"
  );

  const insertProof = db.prepare(
    'INSERT OR IGNORE INTO vector_outcome_learning_proofs(proof_digest,tenant,proof_json,created_at) VALUES(?,?,?,?)'
  );
  const proofByDigest = db.prepare(
    'SELECT proof_digest,tenant,proof_json,created_at FROM vector_outcome_learning_proofs WHERE proof_digest=?'
  );
  const allProofs = db.prepare(
    'SELECT proof_digest,tenant,proof_json,created_at FROM vector_outcome_learning_proofs ORDER BY id'
  );

  let engine = null;
  let readyPromise = null;
  let closed = false;

  async function ready() {
    if (closed) throw new Error('Outcome learning service is closed.');
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      const moduleUrl = pathToFileURL(engineModulePath).href;
      const mod = await import(moduleUrl);
      if (typeof mod.AdaptiveIntelligenceEngine !== 'function') {
        throw new Error('Adaptive intelligence engine export is unavailable.');
      }
      engine = new mod.AdaptiveIntelligenceEngine({ minRepeatedWins });
      for (const row of allProofs.all()) {
        const proof = JSON.parse(row.proof_json);
        const input = toAdaptiveOutcomeInput(proof);
        engine.ingestOutcome(input);
      }
      return true;
    })();
    return readyPromise;
  }

  async function recordOutcome(input = {}) {
    await ready();
    const proof = createDecisionOutcomeProof(input);
    const adaptiveInput = toAdaptiveOutcomeInput(proof);
    const inserted = insertProof.run(
      proof.proofDigest,
      proof.tenant,
      JSON.stringify(proof),
      new Date().toISOString()
    );
    if (Number(inserted.changes) === 0) {
      const existing = proofByDigest.get(proof.proofDigest);
      return {
        duplicate: true,
        proofDigest: proof.proofDigest,
        tenant: existing?.tenant || proof.tenant,
        receipt: null
      };
    }
    const receipt = engine.ingestOutcome(adaptiveInput);
    return {
      duplicate: false,
      proofDigest: proof.proofDigest,
      tenant: proof.tenant,
      receipt: clone(receipt)
    };
  }

  async function snapshotForTenant(tenant) {
    await ready();
    const scope = String(tenant || '').trim();
    const snapshot = engine.snapshot();
    return {
      outcomes: snapshot.outcomes.filter(item => item.tenantScope === scope).map(clone),
      evals: snapshot.evals.filter(item => item.tenantScope === scope).map(clone),
      skills: snapshot.skills.filter(item => item.tenantScope === scope).map(clone),
      decisions: snapshot.decisions
        .filter(item => item.tenantScope == null || item.tenantScope === scope)
        .map(clone)
    };
  }

  function close() {
    if (closed) return;
    closed = true;
    try { db.close(); } catch {}
  }

  return { ready, recordOutcome, snapshotForTenant, close };
}

module.exports = { createOutcomeLearningService };
