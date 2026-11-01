import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDurableIncidentMemoryConsumer } from './durable-incident-memory.mjs';

const fields=['schemaVersion','tenantScope','source','category','fingerprint','baseline','result','verified','evidenceRef','createdAt'];
const childSource=`
import { createDurableIncidentMemoryConsumer } from ${JSON.stringify(new URL('./durable-incident-memory.mjs',import.meta.url).href)};
let input='';for await(const chunk of process.stdin)input+=chunk;
const config=JSON.parse(input), records=new Map(config.records);delete config.records;
const c=createDurableIncidentMemoryConsumer({...config,readAttestation:async ({evidenceRef})=>records.get(evidenceRef)});
try{const ack=await c.consume({evidenceRef:'incident-2'});if(ack.authority!=='none')throw new Error('unexpected authority');process.stdout.write(JSON.stringify(await c.recurrence({fingerprint:'worker-restart'})));}finally{c.close();}
`;
function appendFromProcess(config) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--input-type=module','--eval',childSource],{stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';const timer=setTimeout(()=>{child.kill();reject(new Error('isolated child timed out'));},15000);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{clearTimeout(timer);if(code!==0)reject(new Error('isolated child failed: '+stderr));else{try{resolve(JSON.parse(stdout));}catch(error){reject(error);}}});
    child.stdin.end(JSON.stringify(config));
  });
}

test('a separate process append during source verification is authenticated before recurrence and survives reopen',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'vector-memory-process-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const storePath=path.join(dir,'state.sqlite'),keys=generateKeyPairSync('ed25519'),records=new Map();
  for(const evidenceRef of ['incident-1','incident-2']){
    const payload={schemaVersion:1,tenantScope:'test-tenant',source:'test-source',category:'support-incidents',fingerprint:'worker-restart',baseline:0,result:1,verified:true,evidenceRef,createdAt:'2026-11-01T00:00:00.000Z'};
    records.set(evidenceRef,{payload,signature:sign(null,Buffer.from('VECTOR_INCIDENT_MEASUREMENT_V1\n'+JSON.stringify(fields.map(field=>payload[field]))),keys.privateKey).toString('base64url')});
  }
  const config={path:storePath,tenantScope:'test-tenant',source:'test-source',publicKey:keys.publicKey.export({format:'pem',type:'spki'}),minRepeatedWins:2};
  let armed=false,inserted=false,childAdvice=null;const reads=[];
  const readAttestation=async ({evidenceRef})=>{
    reads.push(evidenceRef);
    if(armed&&!inserted&&evidenceRef==='incident-1'){
      inserted=true;
      childAdvice=await appendFromProcess({...config,mode:'open',records:[...records]});
    }
    return records.get(evidenceRef);
  };
  let c=createDurableIncidentMemoryConsumer({...config,mode:'create',readAttestation});
  try{
    await c.consume({evidenceRef:'incident-1'});armed=true;
    const advice=await c.recurrence({fingerprint:'worker-restart'});
    assert.equal(childAdvice.knownOccurrences,2);
    assert.equal(advice.knownOccurrences,2);assert.equal(advice.authority,'none');assert.equal(advice.skills[0].authority,'none');
    assert.ok(reads.includes('incident-2'),'new process evidence was authenticated by the parent');
    const original=await c.consume({evidenceRef:'incident-2'});c.close();
    c=createDurableIncidentMemoryConsumer({...config,mode:'open',readAttestation});
    assert.deepEqual(await c.consume({evidenceRef:'incident-2'}),original);
    assert.deepEqual(await c.recurrence({fingerprint:'worker-restart'}),advice);
  }finally{c.close();}
});
