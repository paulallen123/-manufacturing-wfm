'use strict';

const { DatabaseSync } = require('node:sqlite');
const { createHash, timingSafeEqual } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { createDecisionOutcomeProof, toAdaptiveOutcomeInput } = require('./decision-outcome-proof.cjs');

const PREFIX = '/api/learning/outcomes';
const INTERNAL_HEADER = 'x-wfm-learning-internal';

function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function pathOf(req) { return String(req?.url || '/').split('?')[0] || '/'; }
function cookieToken(req) {
  for (const part of String(req?.headers?.cookie || '').split(';')) {
    const item = part.trim();
    if (item.startsWith('wfm_session=')) return item.slice('wfm_session='.length);
  }
  return '';
}
function secureEqual(left, right) {
  const a=Buffer.from(String(left||'')), b=Buffer.from(String(right||''));
  return a.length>0 && a.length===b.length && timingSafeEqual(a,b);
}
function writeJson(res,status,body) {
  if (res.headersSent || res.writableEnded) return true;
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.end(JSON.stringify(body));
  return true;
}
async function readJson(req,max=256*1024) {
  let size=0; const chunks=[];
  for await (const chunk of req) {
    const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk); size+=b.length;
    if(size>max){const e=new Error('Request body too large.');e.statusCode=413;throw e;} chunks.push(b);
  }
  if(!chunks.length) return {};
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{const e=new Error('Invalid JSON body.');e.statusCode=400;throw e;}
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createOutcomeLearningService(options = {}) {
  const dbPath = options.dbPath || process.env.WFM_DB;
  const engineModulePath = options.engineModulePath || '/app/learning-runtime/evolution/engine.mjs';
  const minRepeatedWins = Math.max(2, Number(options.minRepeatedWins || 3));
  const internalToken = options.internalToken || process.env.WFM_LEARNING_INTERNAL_TOKEN || '';
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
      decisions: snapshot.decisions.filter(item => item.tenantScope === scope).map(clone)
    };
  }

  function authContext(req) {
    const token=cookieToken(req);
    if(!token) return null;
    try {
      return db.prepare('SELECT u.email,u.tenant,u.role FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?')
        .get(sha256(token),Date.now()) || null;
    } catch {
      return null;
    }
  }

  function requireManager(req,res) {
    const ctx=authContext(req);
    if(!ctx){writeJson(res,401,{error:'Sign in is required.'});return null;}
    if(String(ctx.role||'').toLowerCase()==='employee'){
      writeJson(res,403,{error:'Outcome learning status requires an authorised manager or administrator.'});return null;
    }
    return ctx;
  }

  function requireInternal(req,res) {
    if(!internalToken){writeJson(res,503,{error:'Trusted learning worker credential is not configured.'});return false;}
    if(!secureEqual(req?.headers?.[INTERNAL_HEADER],internalToken)){
      writeJson(res,403,{error:'Trusted learning worker is required.'});return false;
    }
    return true;
  }

  async function handleRequest(req,res) {
    const path=pathOf(req);
    if(!path.startsWith(PREFIX)) return false;
    try {
      if(req.method==='POST' && path===PREFIX+'/record'){
        if(!requireInternal(req,res)) return true;
        const result=await recordOutcome(await readJson(req));
        return writeJson(res,200,result);
      }
      if(req.method==='GET' && path===PREFIX+'/status'){
        const ctx=requireManager(req,res); if(!ctx) return true;
        return writeJson(res,200,{tenant:ctx.tenant,snapshot:await snapshotForTenant(ctx.tenant)});
      }
      return writeJson(res,404,{error:'Outcome learning endpoint not found.'});
    } catch(error) {
      return writeJson(res,Number(error?.statusCode||409),{error:error?.statusCode?error.message:'Outcome learning evidence was rejected.'});
    }
  }

  function close() {
    if (closed) return;
    closed = true;
    try { db.close(); } catch {}
  }

  return { ready, recordOutcome, snapshotForTenant, handleRequest, close };
}

module.exports = { createOutcomeLearningService };
