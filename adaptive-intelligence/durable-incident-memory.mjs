import { createHash, createPublicKey, verify } from 'node:crypto';
import { closeSync, lstatSync, openSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { types } from 'node:util';
import { AdaptiveIntelligenceEngine } from './engine.mjs';
import { DurableOutcomeLedger, readOutcomeReplayState } from './durable-outcome-ledger.mjs';

const fields = ['schemaVersion','tenantScope','source','category','fingerprint','baseline','result','verified','evidenceRef','createdAt'];
const bindingName = 'incidentMemoryConsumer.v1';
const fail = code => { throw new Error(code); };

// Neither caller queries nor producer records may execute code during inspection.
function record(raw, keys) {
  if (!raw || typeof raw !== 'object' || types.isProxy(raw)) fail('MEASUREMENT_INERT_RECORD_REQUIRED');
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) fail('MEASUREMENT_INERT_RECORD_REQUIRED');
  const descriptors = Object.getOwnPropertyDescriptors(raw), out = Object.create(null);
  const ownKeys = Reflect.ownKeys(descriptors);
  for (const key of ownKeys) {
    const descriptor = descriptors[key];
    if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor,'value')) fail('MEASUREMENT_INERT_RECORD_REQUIRED');
    out[key] = descriptor.value;
  }
  if (ownKeys.length !== keys.length || keys.some(key => !Object.hasOwn(out,key))) fail('MEASUREMENT_FIELDS_INVALID');
  return out;
}

function identity(value, max = 120) {
  if (typeof value !== 'string' || !value || value.length > max || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) fail('MEASUREMENT_IDENTITY_INVALID');
  return value;
}

function measurement(raw) {
  const value = record(raw, fields);
  identity(value.tenantScope,100);
  for (const key of ['source','fingerprint','evidenceRef']) identity(value[key]);
  if (value.schemaVersion !== 1 || value.category !== 'support-incidents' || typeof value.verified !== 'boolean') fail('MEASUREMENT_SCHEMA_INVALID');
  if (typeof value.baseline !== 'number' || !Number.isFinite(value.baseline) || typeof value.result !== 'number' || !Number.isFinite(value.result) || !Number.isFinite(value.result-value.baseline)) fail('MEASUREMENT_NUMERIC_RANGE');
  if (typeof value.createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt)) || new Date(value.createdAt).toISOString() !== value.createdAt) fail('MEASUREMENT_TIMESTAMP_INVALID');
  value.baseline = value.baseline === 0 ? 0 : value.baseline;
  value.result = value.result === 0 ? 0 : value.result;
  return value;
}

function assertFiniteAdvice(engine) {
  const snapshot = engine.snapshot();
  if (snapshot.outcomes.some(row => !Number.isFinite(row.delta)) || snapshot.skills.some(row => !Number.isFinite(row.averageImprovement))) fail('MEASUREMENT_NUMERIC_RANGE');
  return snapshot;
}

/**
 * Opt-in consumer of independently signed incident/engineering measurements.
 * readAttestation is a trusted, server-side read adapter; evidenceRef is its stable
 * identity for one incident observation. No user-supplied measurement is accepted.
 * One explicitly created store is permanently bound to one tenant/source/key.
 */
export function createDurableIncidentMemoryConsumer({
  path: storePath, tenantScope, source, publicKey, readAttestation, mode, minRepeatedWins = 3,
} = {}) {
  identity(tenantScope,100); identity(source);
  if (typeof storePath !== 'string' || !path.isAbsolute(storePath) || storePath.includes('\0')) fail('MEMORY_EXPLICIT_ABSOLUTE_PATH_REQUIRED');
  if (!['create','open'].includes(mode)) fail('MEMORY_EXPLICIT_MODE_REQUIRED');
  if (typeof readAttestation !== 'function') fail('MEMORY_PRODUCER_REQUIRED');
  if (!Number.isInteger(minRepeatedWins) || minRepeatedWins < 2 || minRepeatedWins > 1000) fail('LEARNING_THRESHOLD_INVALID');
  let key;
  try { key = publicKey?.type === 'public' ? publicKey : createPublicKey(publicKey); }
  catch { fail('MEMORY_ED25519_PUBLIC_KEY_REQUIRED'); }
  if (key.asymmetricKeyType !== 'ed25519' || key.type !== 'public') fail('MEMORY_ED25519_PUBLIC_KEY_REQUIRED');
  const keyFingerprint = createHash('sha256').update(key.export({format:'der',type:'spki'})).digest('hex');
  const binding = JSON.stringify({schemaVersion:1,tenantScope,source,keyFingerprint,minRepeatedWins});
  let closed = false, ledger = null, storeIdentity = null;
  const assertOpen = () => { if (closed) fail('MEMORY_CONSUMER_CLOSED'); };

  function inspectStore() {
    if (mode === 'create' && !storeIdentity) fail('MEMORY_NOT_INITIALIZED');
    let stat;
    try { stat = lstatSync(storePath); }
    catch { fail(mode === 'create' && !storeIdentity ? 'MEMORY_NOT_INITIALIZED' : 'MEMORY_STORE_UNAVAILABLE'); }
    if (!stat.isFile() || stat.size === 0) fail('MEMORY_STORE_UNAVAILABLE');
    const observed = `${stat.dev}:${stat.ino}`;
    if (storeIdentity && storeIdentity !== observed) fail('MEMORY_STORE_UNAVAILABLE');
    const db = new DatabaseSync(storePath,{readOnly:true});
    try {
      if (db.prepare('SELECT value FROM outcome_replay_config WHERE name=?').get(bindingName)?.value !== binding) fail('MEMORY_BINDING_MISMATCH');
      if (db.prepare('SELECT value FROM outcome_replay_config WHERE name=?').get('minRepeatedWins')?.value !== String(minRepeatedWins)) fail('MEMORY_BINDING_MISMATCH');
      db.prepare('SELECT tenant,source,evidence,input_json FROM outcome_replay LIMIT 0').all();
    } finally { db.close(); }
    storeIdentity = observed;
  }

  function writableLedger() {
    if (ledger) { inspectStore(); return ledger; }
    if (mode === 'create' && !storeIdentity) {
      // Exclusive creation follows successful source authentication. Existing paths,
      // including symlinks, cannot be adopted or overwritten by create mode.
      const fd = openSync(storePath,'wx',0o600); closeSync(fd);
      const stat = lstatSync(storePath); storeIdentity = `${stat.dev}:${stat.ino}`;
      ledger = new DurableOutcomeLedger({path:storePath,minRepeatedWins});
      const db = new DatabaseSync(storePath);
      try { db.prepare('INSERT INTO outcome_replay_config (name,value) VALUES (?,?)').run(bindingName,binding); }
      catch (error) { ledger.close(); ledger=null; throw error; }
      finally { db.close(); }
    } else {
      inspectStore();
      ledger = new DurableOutcomeLedger({path:storePath,minRepeatedWins});
    }
    inspectStore(); return ledger;
  }

  async function authenticated(evidenceRef) {
    assertOpen();
    const raw = await readAttestation(Object.freeze({tenantScope,source,evidenceRef}));
    assertOpen();
    const envelope = record(raw,['payload','signature']);
    const payload = measurement(envelope.payload);
    // The inherited engine sums the first threshold distinct wins. Bound each
    // delta conservatively so independent concurrent consumers cannot commit a
    // combination whose derived average overflows, even from stale read views.
    if (payload.result-payload.baseline > Number.MAX_VALUE/(minRepeatedWins+1)) fail('MEASUREMENT_NUMERIC_RANGE');
    if (payload.tenantScope !== tenantScope || payload.source !== source || payload.evidenceRef !== evidenceRef) fail('MEASUREMENT_SCOPE_MISMATCH');
    if (typeof envelope.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature)) fail('MEASUREMENT_SIGNATURE_INVALID');
    const bytes = Buffer.from('VECTOR_INCIDENT_MEASUREMENT_V1\n' + JSON.stringify(fields.map(field => payload[field])));
    if (!verify(null,bytes,key,Buffer.from(envelope.signature,'base64url'))) fail('MEASUREMENT_SIGNATURE_INVALID');
    const {schemaVersion,...outcome} = payload;
    return outcome;
  }

  function retainedState() {
    inspectStore();
    const db = new DatabaseSync(storePath,{readOnly:true});
    let state;
    try {
      db.exec('BEGIN');
      state = readOutcomeReplayState(db);
      if (state.config.find(row => row.name === bindingName)?.value !== binding || state.config.find(row => row.name === 'minRepeatedWins')?.value !== String(minRepeatedWins)) fail('MEMORY_BINDING_MISMATCH');
      db.exec('COMMIT');
    }
    finally { db.close(); }
    inspectStore();
    return state;
  }

  function assertAppendOnly(before, after) {
    if (JSON.stringify(before.config) !== JSON.stringify(after.config) || before.rows.length > after.rows.length || before.rows.some((row,index) => JSON.stringify(row) !== JSON.stringify(after.rows[index]))) fail('MEMORY_REPLAY_CHANGED');
  }

  async function authenticatedEngine() {
    let previous = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const state = retainedState(), engine = new AdaptiveIntelligenceEngine({minRepeatedWins});
      if (previous) assertAppendOnly(previous,state);
      for (const row of state.rows) {
        if (row.tenant !== tenantScope || row.source !== source) fail('MEMORY_SCOPE_INTEGRITY');
        const expected = await authenticated(identity(row.evidence));
        const stored = record(JSON.parse(row.input_json),fields.filter(field => field !== 'schemaVersion'));
        if (Object.keys(expected).some(field => stored[field] !== expected[field])) fail('MEMORY_PROVENANCE_MISMATCH');
        engine.ingestOutcome(expected);
      }
      assertOpen();
      const current = retainedState();
      assertAppendOnly(state,current);
      if (state.digest === current.digest) {
        assertFiniteAdvice(engine);
        return {engine,state};
      }
      // A concurrent append is never trusted from its presence alone. Re-read
      // and authenticate the entire extended history before returning advice.
      previous = current;
    }
    fail('MEMORY_REPLAY_BUSY');
  }

  async function consume(raw) {
    assertOpen();
    const query = record(raw,['evidenceRef']), evidenceRef = identity(query.evidenceRef);
    const outcome = await authenticated(evidenceRef);
    // No store is opened or created for unauthenticated producer data.
    const store = writableLedger();
    for (let attempt = 0; attempt < 8; attempt++) {
      const {engine,state} = await authenticatedEngine();
      engine.ingestOutcome(outcome); assertFiniteAdvice(engine);
      assertOpen(); inspectStore();
      let receipt;
      try { receipt = store.ingestOutcome(outcome,state.digest); }
      catch (error) {
        if (error.message !== 'OUTCOME_REPLAY_CHANGED') throw error;
        const current = retainedState();
        assertAppendOnly(state,current);
        if (state.digest === current.digest) throw error;
        continue; // a concurrent extension must first pass source authentication
      }
      inspectStore();
      return {outcome:receipt,authority:'none'}; // committed before acknowledgement
    }
    fail('MEMORY_REPLAY_BUSY');
  }

  async function recurrence(raw) {
    assertOpen();
    const query = record(raw,['fingerprint']), fingerprint = identity(query.fingerprint);
    const authenticatedState = (await authenticatedEngine()).engine.snapshot();
    // Rebuild only after authenticating every row, so moved/invalidated fingerprints
    // cannot be concealed behind a no-known-match response.
    const engine = new AdaptiveIntelligenceEngine({minRepeatedWins});
    const matching = authenticatedState.outcomes.filter(row => row.fingerprint === fingerprint);
    for (const row of matching) engine.ingestOutcome(row);
    const state = assertFiniteAdvice(engine), count = matching.length;
    return {
      tenantScope,source,fingerprint,authority:'none',
      status:count > 1 ? 'recurrence-observed' : count === 1 ? 'observed' : 'no-known-match',
      knownOccurrences:count,evidenceRefs:matching.map(row => row.evidenceRef),
      evals:state.evals,skills:state.skills,
      recommendedAction:count > 1 ? 'review-recurrence-prevention' : state.evals.length ? 'review-regression' : 'none',
    };
  }

  function close() { if (!closed) { closed=true; ledger?.close(); ledger=null; } }
  return Object.freeze({consume,recurrence,close});
}
