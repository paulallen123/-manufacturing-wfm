import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createDurableIncidentMemoryConsumer } from './durable-incident-memory.mjs';

const fields = ['schemaVersion','tenantScope','source','category','fingerprint','baseline','result','verified','evidenceRef','createdAt'];
const outcome = (evidenceRef, changes = {}) => ({schemaVersion:1,tenantScope:'tenant-a',source:'incident-verifier',category:'support-incidents',fingerprint:'worker-restart',baseline:0,result:1,verified:true,evidenceRef,createdAt:'2026-11-01T00:00:00.000Z',...changes});
function attestation(payload, key) {
  const bytes = Buffer.from('VECTOR_INCIDENT_MEASUREMENT_V1\n' + JSON.stringify(fields.map(field => payload[field])));
  return {payload,signature:sign(null,bytes,key).toString('base64url')};
}
function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(),'vector-incident-memory-'));
  t.after(() => rmSync(dir,{recursive:true,force:true}));
  const keys=generateKeyPairSync('ed25519'), records=new Map(); let reads=0;
  const dbPath=path.join(dir,'memory.sqlite');
  const config={path:dbPath,tenantScope:'tenant-a',source:'incident-verifier',publicKey:keys.publicKey,minRepeatedWins:2,
    readAttestation:async scope => { reads++; return records.get(scope.evidenceRef); }};
  const create=(mode='create',change={})=>createDurableIncidentMemoryConsumer({...config,mode,...change});
  const put=(ref,change={})=>records.set(ref,attestation(outcome(ref,change),keys.privateKey));
  return {keys,records,dbPath,config,create,put,reads:()=>reads};
}

test('explicit opt-in is inert until an authenticated measurement is consumed',async t=>{
  const f=fixture(t), c=f.create(); t.after(()=>c.close());
  assert.equal(existsSync(f.dbPath),false);
  await assert.rejects(c.recurrence({fingerprint:'worker-restart'}),/MEMORY_NOT_INITIALIZED/);
  assert.equal(existsSync(f.dbPath),false);
  f.put('incident-1'); const ack=await c.consume({evidenceRef:'incident-1'});
  assert.equal(ack.authority,'none'); assert.equal(ack.outcome.evidenceRef,'incident-1');
  const advice=await c.recurrence({fingerprint:'worker-restart'});
  assert.equal(advice.status,'observed'); assert.equal(advice.knownOccurrences,1);
  assert.equal(advice.authority,'none'); assert.deepEqual(advice.skills,[]);
  const absent=await c.recurrence({fingerprint:'different-scenario'});
  assert.equal(absent.status,'no-known-match'); assert.equal(absent.knownOccurrences,0);
});

test('restart, stable evidence replay, recurrence and regression advice survive revalidation',async t=>{
  const f=fixture(t); let c=f.create();
  for(const ref of ['incident-1','incident-2']){ f.put(ref); await c.consume({evidenceRef:ref}); }
  f.put('incident-3',{baseline:2,result:1}); await c.consume({evidenceRef:'incident-3'});
  const before=await c.recurrence({fingerprint:'worker-restart'}); c.close(); c=f.create('open'); t.after(()=>c.close());
  assert.deepEqual(await c.recurrence({fingerprint:'worker-restart'}),before);
  const original=await c.consume({evidenceRef:'incident-1'});
  assert.deepEqual(await c.consume({evidenceRef:'incident-1'}),original);
  const advice=await c.recurrence({fingerprint:'worker-restart'});
  assert.equal(advice.status,'recurrence-observed'); assert.equal(advice.knownOccurrences,3);
  assert.equal(advice.skills.length,1); assert.equal(advice.skills[0].authority,'none');
  assert.equal(advice.evals.length,1); assert.equal(advice.recommendedAction,'review-recurrence-prevention');
});

for(const [label,change] of [['tenant',{tenantScope:'tenant-b'}],['source',{source:'other-source'}],['reference',{evidenceRef:'another-incident'}]]){
  test(`signed ${label} mismatch is refused before creating a store`,async t=>{
    const f=fixture(t),c=f.create();t.after(()=>c.close()); f.put('incident-1',change);
    await assert.rejects(c.consume({evidenceRef:'incident-1'}),/MEASUREMENT_SCOPE_MISMATCH/);
    assert.equal(existsSync(f.dbPath),false);
  });
}

test('wrong signer and signed-field tampering fail before creating a store',async t=>{
  const f=fixture(t),c=f.create();t.after(()=>c.close());
  f.records.set('incident-1',attestation(outcome('incident-1'),generateKeyPairSync('ed25519').privateKey));
  await assert.rejects(c.consume({evidenceRef:'incident-1'}),/MEASUREMENT_SIGNATURE_INVALID/);
  f.put('incident-1'); f.records.get('incident-1').payload.result=50;
  await assert.rejects(c.consume({evidenceRef:'incident-1'}),/MEASUREMENT_SIGNATURE_INVALID/);
  assert.equal(existsSync(f.dbPath),false);
});

test('unverified signed observations cannot produce learned wins or regression evaluations',async t=>{
  const f=fixture(t),c=f.create();t.after(()=>c.close());
  for(const [ref,result] of [['i-1',1],['i-2',1],['i-3',-1]]) { f.put(ref,{verified:false,result});await c.consume({evidenceRef:ref}); }
  const advice=await c.recurrence({fingerprint:'worker-restart'});
  assert.equal(advice.knownOccurrences,3);assert.deepEqual(advice.skills,[]);assert.deepEqual(advice.evals,[]);
});

test('conflicting signed evidence retry rolls back without changing retained memory',async t=>{
  const f=fixture(t),c=f.create();t.after(()=>c.close());f.put('incident-1');await c.consume({evidenceRef:'incident-1'});
  f.put('incident-1',{result:10});
  await assert.rejects(c.consume({evidenceRef:'incident-1'}),/MEMORY_PROVENANCE_MISMATCH/);
  f.put('incident-1');assert.equal((await c.recurrence({fingerprint:'worker-restart'})).knownOccurrences,1);
});

test('write outage has no acknowledgement and the exact retry commits once',async t=>{
  const f=fixture(t),c=f.create();t.after(()=>c.close());f.put('incident-1');await c.consume({evidenceRef:'incident-1'});
  const db=new DatabaseSync(f.dbPath);t.after(()=>db.close());
  db.exec("CREATE TRIGGER fail_incident_append BEFORE INSERT ON outcome_replay BEGIN SELECT RAISE(ABORT,'simulated incident write outage'); END");
  f.put('incident-2');await assert.rejects(c.consume({evidenceRef:'incident-2'}),/simulated incident write outage/);
  assert.equal((await c.recurrence({fingerprint:'worker-restart'})).knownOccurrences,1);
  db.exec('DROP TRIGGER fail_incident_append');
  const receipt=await c.consume({evidenceRef:'incident-2'});assert.deepEqual(await c.consume({evidenceRef:'incident-2'}),receipt);
  assert.equal((await c.recurrence({fingerprint:'worker-restart'})).knownOccurrences,2);
});

test('all bound rows are authenticated before a no-known-match answer',async t=>{
  const f=fixture(t),c=f.create();t.after(()=>c.close());f.put('incident-1');await c.consume({evidenceRef:'incident-1'});
  f.records.delete('incident-1');
  await assert.rejects(c.recurrence({fingerprint:'different-scenario'}),/MEASUREMENT_INERT_RECORD_REQUIRED/);
  f.put('incident-1');const db=new DatabaseSync(f.dbPath);t.after(()=>db.close());
  const row=db.prepare('SELECT input_json FROM outcome_replay').get();const changed=JSON.parse(row.input_json);changed.fingerprint='hidden-by-tamper';
  db.prepare('UPDATE outcome_replay SET input_json=?').run(JSON.stringify(changed));
  await assert.rejects(c.recurrence({fingerprint:'worker-restart'}),/MEMORY_PROVENANCE_MISMATCH/);
});

test('missing, empty, corrupt or differently bound stores never reopen as clean memory',async t=>{
  const f=fixture(t);const missing=f.create('open');t.after(()=>missing.close());f.put('incident-1');
  await assert.rejects(missing.consume({evidenceRef:'incident-1'}),/MEMORY_STORE_UNAVAILABLE/);assert.equal(existsSync(f.dbPath),false);
  const c=f.create();await c.consume({evidenceRef:'incident-1'});c.close();
  const wrongKey=f.create('open',{publicKey:generateKeyPairSync('ed25519').publicKey});t.after(()=>wrongKey.close());
  await assert.rejects(wrongKey.recurrence({fingerprint:'worker-restart'}),/MEMORY_BINDING_MISMATCH/);
  const wrongSource=f.create('open',{source:'other-source'});t.after(()=>wrongSource.close());
  await assert.rejects(wrongSource.recurrence({fingerprint:'worker-restart'}),/MEMORY_BINDING_MISMATCH/);
  const db=new DatabaseSync(f.dbPath);db.exec('DELETE FROM outcome_replay_config');db.close();
  const unbound=f.create('open');t.after(()=>unbound.close());
  await assert.rejects(unbound.recurrence({fingerprint:'worker-restart'}),/MEMORY_BINDING_MISMATCH/);
});

test('consumer refuses caller getters and proxies before source access',async t=>{
  const f=fixture(t),c=f.create();t.after(()=>c.close());let touched=0;
  const getter=Object.defineProperty({},'evidenceRef',{enumerable:true,get(){touched++;return 'incident-1';}});
  await assert.rejects(c.consume(getter),/MEASUREMENT_INERT_RECORD_REQUIRED/);
  await assert.rejects(c.consume(new Proxy({evidenceRef:'incident-1'},{ownKeys(){touched++;throw Error('proxy');}})),/MEASUREMENT_INERT_RECORD_REQUIRED/);
  assert.equal(touched,0);assert.equal(f.reads(),0);assert.equal(existsSync(f.dbPath),false);
});

test('a store is bound to one source and foreign outcomes cannot blend into advice',async t=>{
  const f=fixture(t),c=f.create();t.after(()=>c.close());f.put('incident-1');await c.consume({evidenceRef:'incident-1'});
  const db=new DatabaseSync(f.dbPath);t.after(()=>db.close());
  const raw={...outcome('foreign'),source:'foreign-source'};delete raw.schemaVersion;
  db.prepare('INSERT INTO outcome_replay (tenant,source,evidence,input_json) VALUES (?,?,?,?)').run(raw.tenantScope,raw.source,raw.evidenceRef,JSON.stringify(raw));
  await assert.rejects(c.recurrence({fingerprint:'worker-restart'}),/MEMORY_SCOPE_INTEGRITY/);
});

test('individually finite deltas cannot commit an overflowing concurrent learning aggregate',async t=>{
  const f=fixture(t),c=f.create('create',{minRepeatedWins:3});t.after(()=>c.close());
  for(const ref of ['incident-1','incident-2','incident-3'])f.put(ref,{result:Number.MAX_VALUE*0.6});
  const results=await Promise.allSettled(['incident-1','incident-2','incident-3'].map(evidenceRef=>c.consume({evidenceRef})));
  assert.ok(results.every(row=>row.status==='rejected' && /MEASUREMENT_NUMERIC_RANGE/.test(row.reason.message)));
  assert.equal(existsSync(f.dbPath),false);
});

for(const separateHandles of [false,true])test(`bounded finite aggregates survive concurrent ${separateHandles?'separate handles':'same handle'}`,async t=>{
  const f=fixture(t),c=f.create('create',{minRepeatedWins:3});t.after(()=>c.close());
  for(const ref of ['incident-1','incident-2','incident-3'])f.put(ref,{result:Number.MAX_VALUE/8});
  await c.consume({evidenceRef:'incident-1'});
  const second=separateHandles?f.create('open',{minRepeatedWins:3}):c;
  if(separateHandles)t.after(()=>second.close());
  await Promise.all([c.consume({evidenceRef:'incident-2'}),second.consume({evidenceRef:'incident-3'})]);
  const advice=await c.recurrence({fingerprint:'worker-restart'});
  assert.equal(advice.knownOccurrences,3);assert.equal(advice.skills.length,1);
  assert.equal(Number.isFinite(advice.skills[0].averageImprovement),true);
});
