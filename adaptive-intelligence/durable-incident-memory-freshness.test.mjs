import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createDurableIncidentMemoryConsumer } from './durable-incident-memory.mjs';

const fields=['schemaVersion','tenantScope','source','category','fingerprint','baseline','result','verified','evidenceRef','createdAt'];
function fixture(t) {
  const dir=mkdtempSync(path.join(os.tmpdir(),'vector-memory-freshness-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const storePath=path.join(dir,'state.sqlite');
  const keys=generateKeyPairSync('ed25519'), records=new Map(); let hook=null;
  function put(evidenceRef,changes={}) {
    const payload={schemaVersion:1,tenantScope:'test-tenant',source:'test-incident-source',category:'support-incidents',fingerprint:'worker-restart',baseline:0,result:1,verified:true,evidenceRef,createdAt:'2026-11-01T00:00:00.000Z',...changes};
    const bytes=Buffer.from('VECTOR_INCIDENT_MEASUREMENT_V1\n'+JSON.stringify(fields.map(field=>payload[field])));
    records.set(evidenceRef,{payload,signature:sign(null,bytes,keys.privateKey).toString('base64url')});
    return payload;
  }
  const readAttestation=async ({evidenceRef})=>{
    if(hook) await hook(evidenceRef);
    return records.get(evidenceRef);
  };
  const make=(mode='create')=>createDurableIncidentMemoryConsumer({path:storePath,mode,tenantScope:'test-tenant',source:'test-incident-source',publicKey:keys.publicKey,readAttestation,minRepeatedWins:2});
  const mutate=fn=>{const db=new DatabaseSync(storePath); try{return fn(db);}finally{db.close();}};
  const rows=()=>mutate(db=>db.prepare('SELECT evidence,input_json FROM outcome_replay ORDER BY seq').all());
  return {dir,storePath,records,put,make,mutate,rows,setHook:fn=>{hook=fn;}};
}

test('recurrence refuses a retained-row rewrite during asynchronous source verification',async t=>{
  const f=fixture(t),c=f.make(); t.after(()=>c.close()); f.put('incident-1'); await c.consume({evidenceRef:'incident-1'});
  let changed=false;
  f.setHook(async ref=>{if(ref==='incident-1'&&!changed){changed=true;f.mutate(db=>{
    const original=JSON.parse(db.prepare('SELECT input_json FROM outcome_replay').get().input_json);
    original.fingerprint='concealed-by-local-rewrite';
    db.prepare('UPDATE outcome_replay SET input_json=?').run(JSON.stringify(original));
  });}});
  await assert.rejects(c.recurrence({fingerprint:'worker-restart'}),/MEMORY_REPLAY_CHANGED|MEMORY_PROVENANCE_MISMATCH/);
});

test('an unsigned concurrent insertion cannot be replayed by a later signed append',async t=>{
  const f=fixture(t),c=f.make(); t.after(()=>c.close()); f.put('incident-1'); await c.consume({evidenceRef:'incident-1'}); f.put('incident-2');
  let changed=false;
  f.setHook(async ref=>{if(ref==='incident-1'&&!changed){changed=true;f.mutate(db=>{
    const unsigned={...f.records.get('incident-1').payload,evidenceRef:'unsigned-incident'};delete unsigned.schemaVersion;
    db.prepare('INSERT INTO outcome_replay(tenant,source,evidence,input_json) VALUES(?,?,?,?)').run(unsigned.tenantScope,unsigned.source,unsigned.evidenceRef,JSON.stringify(unsigned));
  });}});
  await assert.rejects(c.consume({evidenceRef:'incident-2'}),/MEASUREMENT_INERT_RECORD_REQUIRED|MEMORY_REPLAY_CHANGED/);
  assert.deepEqual(f.rows().map(row=>row.evidence),['incident-1','unsigned-incident']);
});

test('deleting retained rows during verification cannot acknowledge an outdated recurrence',async t=>{
  const f=fixture(t),c=f.make(); t.after(()=>c.close());
  for(const ref of ['incident-1','incident-2']){f.put(ref);await c.consume({evidenceRef:ref});}
  let changed=false;
  f.setHook(async ref=>{if(ref==='incident-1'&&!changed){changed=true;f.mutate(db=>db.prepare('DELETE FROM outcome_replay WHERE evidence=?').run('incident-2'));}});
  await assert.rejects(c.recurrence({fingerprint:'worker-restart'}),/MEMORY_REPLAY_CHANGED/);
});

test('a local trigger cannot change already authenticated rows inside the append transaction',async t=>{
  const f=fixture(t),c=f.make(); t.after(()=>c.close()); f.put('incident-1');await c.consume({evidenceRef:'incident-1'});
  f.mutate(db=>db.exec("CREATE TRIGGER rewrite_memory AFTER INSERT ON outcome_replay BEGIN DELETE FROM outcome_replay WHERE evidence='incident-1'; END"));
  f.put('incident-2');
  await assert.rejects(c.consume({evidenceRef:'incident-2'}),/OUTCOME_REPLAY_CHANGED/);
  assert.deepEqual(f.rows().map(row=>row.evidence),['incident-1']);
});

test('a valid older database remains an explicit external custody limit after close and restore',async t=>{
  const f=fixture(t); let c=f.make(); f.put('incident-1');await c.consume({evidenceRef:'incident-1'});c.close();
  const backup=path.join(f.dir,'older-valid.sqlite');copyFileSync(f.storePath,backup);
  c=f.make('open');f.put('incident-2');await c.consume({evidenceRef:'incident-2'});assert.equal((await c.recurrence({fingerprint:'worker-restart'})).knownOccurrences,2);c.close();
  copyFileSync(backup,f.storePath);c=f.make('open');t.after(()=>c.close());
  assert.equal((await c.recurrence({fingerprint:'worker-restart'})).knownOccurrences,1);
});
