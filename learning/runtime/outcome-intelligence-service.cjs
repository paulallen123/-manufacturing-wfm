'use strict';

const { createHash, timingSafeEqual } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PREFIX = '/api/learning/outcomes';
const INTERNAL_HEADER = 'x-wfm-learning-internal';

function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function nowIso() { return new Date().toISOString(); }
function compact(value, max = 240) { return String(value ?? '').trim().slice(0, max); }
function requestPath(req) { return String(req?.url || '/').split('?')[0] || '/'; }
function secureEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}
function cookieToken(req) {
  for (const part of String(req?.headers?.cookie || '').split(';')) {
    const item = part.trim();
    if (item.startsWith('wfm_session=')) return item.slice('wfm_session='.length);
  }
  return '';
}
function writeJson(res, status, body) {
  if (res.headersSent || res.writableEnded) return true;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
  return true;
}
async function readJson(req, maxBytes = 128 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      const error = new Error('Request body too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch {
    const error = new Error('Invalid JSON body.');
    error.statusCode = 400;
    throw error;
  }
}

function createOutcomeIntelligenceService(options = {}) {
  const dbPath = options.dbPath || process.env.WFM_DB;
  const internalToken = options.internalToken || process.env.WFM_LEARNING_INTERNAL_TOKEN || '';
  const minRepeatedWins = Math.max(2, Number(options.minRepeatedWins || 3));
  if (!dbPath) throw new Error('Outcome intelligence service requires WFM_DB.');

  const db = new DatabaseSync(dbPath);
  db.exec(
    'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;' +
    'CREATE TABLE IF NOT EXISTS vector_verified_outcomes(' +
      'id TEXT PRIMARY KEY,tenant TEXT NOT NULL,source TEXT NOT NULL,category TEXT NOT NULL,' +
      'fingerprint TEXT NOT NULL,baseline REAL NOT NULL,result REAL NOT NULL,delta REAL NOT NULL,' +
      'evidence_ref TEXT NOT NULL,proof_digest TEXT NOT NULL,created_at TEXT NOT NULL,' +
      'UNIQUE(tenant,evidence_ref),UNIQUE(tenant,proof_digest));' +
    'CREATE INDEX IF NOT EXISTS vector_verified_outcomes_fingerprint ON vector_verified_outcomes(tenant,fingerprint,created_at);' +
    'CREATE TRIGGER IF NOT EXISTS no_vector_verified_outcome_update BEFORE UPDATE ON vector_verified_outcomes ' +
      "BEGIN SELECT RAISE(ABORT,'Verified outcomes are append only.'); END;" +
    'CREATE TRIGGER IF NOT EXISTS no_vector_verified_outcome_delete BEFORE DELETE ON vector_verified_outcomes ' +
      "BEGIN SELECT RAISE(ABORT,'Verified outcomes are append only.'); END;" +
    'CREATE TABLE IF NOT EXISTS vector_outcome_evals(' +
      'id TEXT PRIMARY KEY,tenant TEXT NOT NULL,fingerprint TEXT NOT NULL,origin TEXT NOT NULL,' +
      'release_blocking INTEGER NOT NULL,evidence_ref TEXT NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL,' +
      'UNIQUE(tenant,origin,fingerprint));' +
    'CREATE TRIGGER IF NOT EXISTS no_vector_outcome_eval_update BEFORE UPDATE ON vector_outcome_evals ' +
      "BEGIN SELECT RAISE(ABORT,'Outcome evaluations are append only.'); END;" +
    'CREATE TRIGGER IF NOT EXISTS no_vector_outcome_eval_delete BEFORE DELETE ON vector_outcome_evals ' +
      "BEGIN SELECT RAISE(ABORT,'Outcome evaluations are append only.'); END;" +
    'CREATE TABLE IF NOT EXISTS vector_outcome_eval_resolutions(' +
      'id TEXT PRIMARY KEY,tenant TEXT NOT NULL,evaluation_id TEXT NOT NULL,fingerprint TEXT NOT NULL,' +
      'verification_source TEXT NOT NULL,verification_digest TEXT NOT NULL,evidence_refs_json TEXT NOT NULL,' +
      'created_at TEXT NOT NULL,UNIQUE(tenant,evaluation_id));' +
    'CREATE TRIGGER IF NOT EXISTS no_vector_outcome_resolution_update BEFORE UPDATE ON vector_outcome_eval_resolutions ' +
      "BEGIN SELECT RAISE(ABORT,'Outcome regression resolutions are append only.'); END;" +
    'CREATE TRIGGER IF NOT EXISTS no_vector_outcome_resolution_delete BEFORE DELETE ON vector_outcome_eval_resolutions ' +
      "BEGIN SELECT RAISE(ABORT,'Outcome regression resolutions are append only.'); END;" +
    'CREATE TABLE IF NOT EXISTS vector_skill_candidates(' +
      'id TEXT PRIMARY KEY,tenant TEXT NOT NULL,fingerprint TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL,' +
      'verified_win_count INTEGER NOT NULL,average_improvement REAL NOT NULL,evidence_refs_json TEXT NOT NULL,' +
      'authority TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(tenant,fingerprint,version));' +
    'CREATE TRIGGER IF NOT EXISTS no_vector_skill_candidate_update BEFORE UPDATE ON vector_skill_candidates ' +
      "BEGIN SELECT RAISE(ABORT,'Skill candidates are append only.'); END;" +
    'CREATE TRIGGER IF NOT EXISTS no_vector_skill_candidate_delete BEFORE DELETE ON vector_skill_candidates ' +
      "BEGIN SELECT RAISE(ABORT,'Skill candidates are append only.'); END;"
  );

  const auth = db.prepare(
    'SELECT u.email,u.tenant,u.role FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?'
  );
  const outcomeByEvidence = db.prepare(
    'SELECT * FROM vector_verified_outcomes WHERE tenant=? AND evidence_ref=?'
  );
  const insertOutcome = db.prepare(
    'INSERT INTO vector_verified_outcomes(id,tenant,source,category,fingerprint,baseline,result,delta,evidence_ref,proof_digest,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
  );
  const positiveOutcomes = db.prepare(
    'SELECT evidence_ref,delta FROM vector_verified_outcomes WHERE tenant=? AND fingerprint=? AND delta>0 ORDER BY created_at,id'
  );
  const evalByFingerprint = db.prepare(
    "SELECT * FROM vector_outcome_evals WHERE tenant=? AND origin='regression' AND fingerprint=?"
  );
  const insertEval = db.prepare(
    'INSERT INTO vector_outcome_evals(id,tenant,fingerprint,origin,release_blocking,evidence_ref,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?)'
  );
  const evalById = db.prepare('SELECT * FROM vector_outcome_evals WHERE tenant=? AND id=?');
  const resolutionByEval = db.prepare('SELECT * FROM vector_outcome_eval_resolutions WHERE tenant=? AND evaluation_id=?');
  const insertResolution = db.prepare(
    'INSERT INTO vector_outcome_eval_resolutions(id,tenant,evaluation_id,fingerprint,verification_source,verification_digest,evidence_refs_json,created_at) VALUES(?,?,?,?,?,?,?,?)'
  );
  const latestSkill = db.prepare(
    'SELECT * FROM vector_skill_candidates WHERE tenant=? AND fingerprint=? ORDER BY version DESC LIMIT 1'
  );
  const insertSkill = db.prepare(
    'INSERT INTO vector_skill_candidates(id,tenant,fingerprint,version,status,verified_win_count,average_improvement,evidence_refs_json,authority,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
  );
  const countOutcomes = db.prepare('SELECT COUNT(*) AS count FROM vector_verified_outcomes WHERE tenant=?');
  const countBlocking = db.prepare("SELECT COUNT(*) AS count FROM vector_outcome_evals e WHERE e.tenant=? AND e.release_blocking=1 AND NOT EXISTS (SELECT 1 FROM vector_outcome_eval_resolutions r WHERE r.tenant=e.tenant AND r.evaluation_id=e.id)");
  const countResolved = db.prepare('SELECT COUNT(*) AS count FROM vector_outcome_eval_resolutions WHERE tenant=?');
  const listEvals = db.prepare('SELECT * FROM vector_outcome_evals WHERE tenant=? ORDER BY created_at DESC,id DESC LIMIT ?');
  const listSkills = db.prepare('SELECT * FROM vector_skill_candidates WHERE tenant=? ORDER BY created_at DESC,id DESC LIMIT ?');

  function context(req) {
    const token = cookieToken(req);
    return token ? auth.get(sha256(token), Date.now()) || null : null;
  }
  function requireManager(req, res) {
    const ctx = context(req);
    if (!ctx) { writeJson(res, 401, { error: 'Sign in is required.' }); return null; }
    if (String(ctx.role).toLowerCase() === 'employee') {
      writeJson(res, 403, { error: 'Outcome intelligence requires an authorised manager or administrator.' });
      return null;
    }
    return ctx;
  }
  function requireInternal(req, res) {
    if (!internalToken) {
      writeJson(res, 503, { error: 'Trusted learning worker credential is not configured.' });
      return false;
    }
    if (!secureEqual(req?.headers?.[INTERNAL_HEADER], internalToken)) {
      writeJson(res, 403, { error: 'Trusted learning worker is required.' });
      return false;
    }
    return true;
  }

  function ingestAdaptiveInput(input = {}) {
    const tenant = compact(input.tenantScope, 120);
    const source = compact(input.source, 120);
    const category = compact(input.category, 120);
    const fingerprint = compact(input.fingerprint, 200);
    const evidenceRef = compact(input.evidenceRef, 240);
    const baseline = Number(input.baseline);
    const result = Number(input.result);
    if (!tenant || !source || !category || !fingerprint || !evidenceRef) {
      const error = new Error('Verified outcome requires tenantScope, source, category, fingerprint and evidenceRef.');
      error.statusCode = 400;
      throw error;
    }
    if (input.verified !== true) {
      const error = new Error('Only independently verified outcomes may enter learning memory.');
      error.statusCode = 409;
      throw error;
    }
    if (input.crossTenantRawMemory === true || input.containsSecret === true || input.memoryGrantsAuthority === true) {
      const error = new Error('Unsafe learning memory refused.');
      error.statusCode = 409;
      throw error;
    }
    if (!Number.isFinite(baseline) || !Number.isFinite(result)) {
      const error = new Error('Verified outcome requires numeric baseline and result.');
      error.statusCode = 400;
      throw error;
    }

    const existing = outcomeByEvidence.get(tenant, evidenceRef);
    if (existing) {
      if (
        existing.fingerprint !== fingerprint ||
        Number(existing.baseline) !== baseline ||
        Number(existing.result) !== result
      ) {
        const error = new Error('Evidence reference was already bound to a different outcome.');
        error.statusCode = 409;
        throw error;
      }
      return {
        idempotent: true,
        receipt: publicOutcome(existing),
        regressionEvaluation: evalByFingerprint.get(tenant, fingerprint) ? publicEval(evalByFingerprint.get(tenant, fingerprint)) : null,
        skillCandidate: latestSkill.get(tenant, fingerprint) ? publicSkill(latestSkill.get(tenant, fingerprint)) : null,
        executionAuthority: 'NONE'
      };
    }

    const delta = result - baseline;
    const proofDigest = sha256(JSON.stringify({
      tenant, source, category, fingerprint, baseline, result, evidenceRef
    }));
    const id = 'out-' + proofDigest.slice(0, 32);
    const createdAt = nowIso();
    insertOutcome.run(id, tenant, source, category, fingerprint, baseline, result, delta, evidenceRef, proofDigest, createdAt);
    const row = outcomeByEvidence.get(tenant, evidenceRef);

    let regressionEvaluation = null;
    if (delta < 0) {
      regressionEvaluation = evalByFingerprint.get(tenant, fingerprint);
      if (!regressionEvaluation) {
        const evalId = 'eval-' + sha256(tenant + ':regression:' + fingerprint).slice(0, 32);
        insertEval.run(
          evalId, tenant, fingerprint, 'regression', 1, evidenceRef,
          JSON.stringify({ baseline, result, delta, category, source }), createdAt
        );
        regressionEvaluation = evalByFingerprint.get(tenant, fingerprint);
      }
    }

    let skillCandidate = null;
    if (delta > 0) {
      const wins = positiveOutcomes.all(tenant, fingerprint);
      if (wins.length >= minRepeatedWins) {
        const current = latestSkill.get(tenant, fingerprint);
        if (!current || Number(current.verified_win_count) < wins.length) {
          const version = Number(current?.version || 0) + 1;
          const avg = wins.reduce((sum, item) => sum + Number(item.delta), 0) / wins.length;
          const evidenceRefs = wins.map(item => item.evidence_ref);
          const skillId = 'skill-' + sha256(tenant + ':' + fingerprint + ':' + version + ':' + evidenceRefs.join('|')).slice(0, 32);
          insertSkill.run(
            skillId, tenant, fingerprint, version, 'candidate', wins.length, avg,
            JSON.stringify(evidenceRefs), 'none', createdAt
          );
        }
        skillCandidate = latestSkill.get(tenant, fingerprint);
      }
    }

    return {
      idempotent: false,
      receipt: publicOutcome(row),
      regressionEvaluation: regressionEvaluation ? publicEval(regressionEvaluation) : null,
      skillCandidate: skillCandidate ? publicSkill(skillCandidate) : null,
      executionAuthority: 'NONE'
    };
  }


  function resolveRegression(input = {}) {
    const tenant=compact(input.tenant,120);
    const evaluationId=compact(input.evaluationId,120);
    const verificationSource=compact(input.verificationSource,160);
    const verificationDigest=compact(input.verificationDigest,64).toLowerCase();
    const evidenceRefs=Array.isArray(input.evidenceRefs)
      ? [...new Set(input.evidenceRefs.map(item=>compact(item,220)).filter(Boolean))].slice(0,50)
      : [];
    if(!tenant||!evaluationId||!verificationSource||!evidenceRefs.length||!/^[0-9a-f]{64}$/.test(verificationDigest)){
      const error=new Error('Regression resolution requires tenant, evaluationId, verificationSource, SHA-256 verificationDigest and evidenceRefs.');
      error.statusCode=400;throw error;
    }
    if(input.verified!==true||input.memoryGrantsAuthority===true||input.containsSecret===true||input.crossTenantRawMemory===true){
      const error=new Error('Unsafe or unverified regression resolution refused.');
      error.statusCode=409;throw error;
    }
    const evaluation=evalById.get(tenant,evaluationId);
    if(!evaluation||!Boolean(evaluation.release_blocking)){
      const error=new Error('Release-blocking regression evaluation was not found for this tenant.');
      error.statusCode=404;throw error;
    }
    const existing=resolutionByEval.get(tenant,evaluationId);
    if(existing){
      if(existing.verification_digest!==verificationDigest||existing.verification_source!==verificationSource||JSON.stringify(JSON.parse(existing.evidence_refs_json))!==JSON.stringify(evidenceRefs)){
        const error=new Error('Regression evaluation was already resolved with different evidence.');
        error.statusCode=409;throw error;
      }
      return {idempotent:true,resolution:publicResolution(existing),releaseAdmission:releaseAdmissionForTenant(tenant),executionAuthority:'NONE'};
    }
    const createdAt=nowIso();
    const id='resolution-'+sha256(tenant+':'+evaluationId+':'+verificationDigest+':'+evidenceRefs.join('|')).slice(0,32);
    insertResolution.run(id,tenant,evaluationId,evaluation.fingerprint,verificationSource,verificationDigest,JSON.stringify(evidenceRefs),createdAt);
    const row=resolutionByEval.get(tenant,evaluationId);
    return {idempotent:false,resolution:publicResolution(row),releaseAdmission:releaseAdmissionForTenant(tenant),executionAuthority:'NONE'};
  }

  function recommendationPrior({tenant,decisionType,optionId,metric}={}) {
    const safeTenant=compact(tenant,120),safeDecision=compact(decisionType,120),safeOption=compact(optionId,120),safeMetric=compact(metric,80);
    const fingerprint=[safeDecision,safeOption,safeMetric].join(':');
    if(!safeTenant||!safeDecision||!safeOption||!safeMetric){
      return {eligible:false,reason:'INCOMPLETE_SCOPE',fingerprint,advisoryOnly:true,rankingAuthority:false,executionAuthority:'NONE'};
    }
    const evaluation=evalByFingerprint.get(safeTenant,fingerprint);
    const resolution=evaluation?resolutionByEval.get(safeTenant,evaluation.id):null;
    if(evaluation&&!resolution){
      return {eligible:false,reason:'VERIFIED_REGRESSION_BLOCK',fingerprint,evaluation:publicEval(evaluation),advisoryOnly:true,rankingAuthority:false,executionAuthority:'NONE'};
    }
    const skill=latestSkill.get(safeTenant,fingerprint);
    if(!skill||Number(skill.verified_win_count)<minRepeatedWins){
      return {eligible:false,reason:'INSUFFICIENT_VERIFIED_WINS',fingerprint,resolution:resolution?publicResolution(resolution):null,advisoryOnly:true,rankingAuthority:false,executionAuthority:'NONE'};
    }
    if(resolution&&Date.parse(skill.created_at)<=Date.parse(resolution.created_at)){
      return {eligible:false,reason:'POST_RESOLUTION_WINS_REQUIRED',fingerprint,resolution:publicResolution(resolution),advisoryOnly:true,rankingAuthority:false,executionAuthority:'NONE'};
    }
    return {eligible:true,reason:'REPEATED_VERIFIED_WIN',fingerprint,skillCandidate:publicSkill(skill),resolution:resolution?publicResolution(resolution):null,advisoryOnly:true,rankingAuthority:false,executionAuthority:'NONE'};
  }

  function publicResolution(row) {
    return {
      id:row.id,tenant:row.tenant,evaluationId:row.evaluation_id,fingerprint:row.fingerprint,
      verificationSource:row.verification_source,verificationDigest:row.verification_digest,
      evidenceRefs:JSON.parse(row.evidence_refs_json),createdAt:row.created_at,
      executionAuthority:'NONE'
    };
  }

  function publicOutcome(row) {
    return {
      id: row.id, tenant: row.tenant, source: row.source, category: row.category,
      fingerprint: row.fingerprint, baseline: row.baseline, result: row.result, delta: row.delta,
      evidenceRef: row.evidence_ref, proofDigest: row.proof_digest, createdAt: row.created_at,
      verified: true, executionAuthority: 'NONE'
    };
  }
  function publicEval(row) {
    return {
      id: row.id, tenant: row.tenant, fingerprint: row.fingerprint, origin: row.origin,
      releaseBlocking: Boolean(row.release_blocking), evidenceRef: row.evidence_ref,
      detail: JSON.parse(row.detail_json), createdAt: row.created_at
    };
  }
  function publicSkill(row) {
    return {
      id: row.id, tenant: row.tenant, fingerprint: row.fingerprint, version: row.version,
      status: row.status, verifiedWinCount: row.verified_win_count,
      averageImprovement: row.average_improvement, evidenceRefs: JSON.parse(row.evidence_refs_json),
      authority: row.authority, createdAt: row.created_at
    };
  }
  function releaseAdmissionForTenant(tenant) {
    const blocking=listEvals.all(tenant,100).filter(row=>Boolean(row.release_blocking)&&!resolutionByEval.get(tenant,row.id)).map(publicEval);
    return {
      contractVersion:'VECTOR_OUTCOME_RELEASE_ADMISSION_V1',
      tenant,
      releasePromotionAllowed:blocking.length===0,
      blockerCount:blocking.length,
      blockerRefs:blocking.map(item=>({id:item.id,fingerprint:item.fingerprint,evidenceRef:item.evidenceRef})),
      reason:blocking.length?'VERIFIED_OUTCOME_REGRESSION':null,
      executionAuthority:'NONE'
    };
  }

  function summaryForTenant(tenant) {
    return {
      tenant,
      verifiedOutcomeCount: Number(countOutcomes.get(tenant)?.count || 0),
      releaseBlockingEvaluationCount: Number(countBlocking.get(tenant)?.count || 0),
      resolvedRegressionCount: Number(countResolved.get(tenant)?.count || 0),
      skillCandidates: listSkills.all(tenant, 20).map(publicSkill),
      evaluations: listEvals.all(tenant, 20).map(publicEval),
      executionAuthority: 'NONE'
    };
  }

  async function handleRequest(req, res) {
    const path = requestPath(req);
    if (!path.startsWith(PREFIX)) return false;
    try {
      if (req.method === 'POST' && path === PREFIX + '/ingest') {
        if (!requireInternal(req, res)) return true;
        return writeJson(res, 200, ingestAdaptiveInput(await readJson(req)));
      }
      if (req.method === 'POST' && path === PREFIX + '/release-admission') {
        if (!requireInternal(req, res)) return true;
        const body=await readJson(req),tenant=compact(body.tenant,120);
        if(!tenant)return writeJson(res,400,{error:'tenant is required for release admission.',executionAuthority:'NONE'});
        const admission=releaseAdmissionForTenant(tenant);
        return writeJson(res,admission.releasePromotionAllowed?200:409,admission);
      }
      if (req.method === 'POST' && path === PREFIX + '/resolve-regression') {
        if (!requireInternal(req, res)) return true;
        return writeJson(res,200,resolveRegression(await readJson(req)));
      }
      const ctx = requireManager(req, res);
      if (!ctx) return true;
      if (req.method === 'GET' && path === PREFIX + '/summary') {
        return writeJson(res, 200, summaryForTenant(ctx.tenant));
      }
      if (req.method === 'GET' && path === PREFIX + '/release-admission') {
        const admission=releaseAdmissionForTenant(ctx.tenant);
        return writeJson(res,admission.releasePromotionAllowed?200:409,admission);
      }
      if (req.method === 'GET' && path === PREFIX + '/skills') {
        return writeJson(res, 200, { tenant: ctx.tenant, skills: listSkills.all(ctx.tenant, 50).map(publicSkill), executionAuthority: 'NONE' });
      }
      if (req.method === 'GET' && path === PREFIX + '/evaluations') {
        return writeJson(res, 200, { tenant: ctx.tenant, evaluations: listEvals.all(ctx.tenant, 50).map(publicEval), executionAuthority: 'NONE' });
      }
      return writeJson(res, 404, { error: 'Outcome intelligence endpoint not found.' });
    } catch (error) {
      return writeJson(res, Number(error?.statusCode || 500), {
        error: error?.statusCode ? error.message : 'Outcome intelligence failed safely.',
        executionAuthority: 'NONE'
      });
    }
  }

  return {
    handleRequest,
    ingestAdaptiveInput,
    summaryForTenant,
    releaseAdmissionForTenant,
    resolveRegression,
    recommendationPrior,
    close() { try { db.close(); } catch {} }
  };
}

module.exports = { createOutcomeIntelligenceService, PREFIX, INTERNAL_HEADER };
