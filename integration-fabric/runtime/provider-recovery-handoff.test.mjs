import test from 'node:test';
import assert from 'node:assert/strict';
import {createProviderRecoveryHandoffAuthority,providerRecoveryDigest} from './provider-recovery-handoff.mjs';

function memoryStore(){
  const rows=new Map(),events=[],grants=new Set();
  return {
    rows,
    async create(row){
      if(rows.has(row.id)||grants.has(row.actionGrantJti)) return false;
      rows.set(row.id,structuredClone(row));grants.add(row.actionGrantJti);return true;
    },
    async get(id){const row=rows.get(id);return row?structuredClone(row):null;},
    async consume(id,when){
      const row=rows.get(id);
      if(!row||row.consumedAt) return false;
      row.consumedAt=when;return true;
    },
    async appendEvent(event){events.push(structuredClone(event));return true;},
    async events(handoffId,tenant){return events.filter(e=>e.handoffId===handoffId&&e.tenant===tenant).map(e=>structuredClone(e));}
  };
}
const d=value=>providerRecoveryDigest(value);
function input(overrides={}){
  const tenant='northstar-demo',actionType='integration.retry';
  return {
    actorType:'deterministic-recovery-executor',
    tenant,providerRunId:'provider-run-1',workerId:'normal-provider-worker-1',actionType,
    targetDigest:d({target:'netsuite-workers'}),evidenceDigest:d({evidence:'verified'}),
    verificationDigest:d({verification:'pass'}),stateDigest:d({state:'running',checkpoint:2}),
    actionGrantJti:'grant-1',
    safetyDecision:{allowed:true,type:actionType,tenant,targetTenant:tenant,decisionDigest:d({allowed:true})},
    nextRequest:{offset:2,limit:2},ttlMs:60_000,
    ...overrides
  };
}
function authority({nowValue=1_900_000_000_000,store=memoryStore()}={}){
  let now=nowValue;
  return {
    store,
    setNow:value=>{now=value;},
    authority:createProviderRecoveryHandoffAuthority({
      store,key:'0123456789abcdef0123456789abcdef0123456789abcdef',
      now:()=>now,maxTtlMs:120_000
    })
  };
}

test('public handoff receipt never exposes continuation payload',async()=>{
  const {authority:a}=authority();
  const issued=await a.issueInternal(input());
  assert.ok(issued.internalToken);
  assert.equal('nextRequest' in issued.publicReceipt,false);
  assert.equal(JSON.stringify(issued.publicReceipt).includes('"offset":2'),false);
  const status=await a.publicStatus({tenant:'northstar-demo',handoffId:issued.publicReceipt.handoffId});
  assert.equal(status.status,'ready');
  assert.equal('nextRequest' in status,false);
  assert.equal(status.continuationDigest,d({offset:2,limit:2}));
});

test('only deterministic recovery executor with matching safety authority can issue',async()=>{
  const {authority:a}=authority();
  await assert.rejects(
    ()=>a.issueInternal(input({actorType:'chat-agent'})),
    error=>error.code==='WFM_PROVIDER_HANDOFF_ACTOR'
  );
  await assert.rejects(
    ()=>a.issueInternal(input({safetyDecision:{...input().safetyDecision,targetTenant:'other'}})),
    error=>error.code==='WFM_PROVIDER_HANDOFF_SAFETY'
  );
  await assert.rejects(
    ()=>a.issueInternal(input({actionType:'payroll.write'})),
    error=>error.code==='WFM_PROVIDER_HANDOFF_ACTION'
  );
});

test('exact internal consumer receives continuation once',async()=>{
  const {authority:a}=authority();
  const x=input();
  const issued=await a.issueInternal(x);
  const consumed=await a.consumeInternal({
    token:issued.internalToken,tenant:x.tenant,providerRunId:x.providerRunId,
    workerId:x.workerId,currentStateDigest:x.stateDigest
  });
  assert.deepEqual(consumed.nextRequest,{limit:2,offset:2});
  assert.equal(consumed.continuationDigest,d({offset:2,limit:2}));
  await assert.rejects(
    ()=>a.consumeInternal({
      token:issued.internalToken,tenant:x.tenant,providerRunId:x.providerRunId,
      workerId:x.workerId,currentStateDigest:x.stateDigest
    }),
    error=>error.code==='WFM_PROVIDER_HANDOFF_REPLAY'
  );
});

test('wrong tenant run worker or changed state cannot consume handoff',async()=>{
  for(const mutate of [
    values=>({...values,tenant:'other'}),
    values=>({...values,providerRunId:'other-run'}),
    values=>({...values,workerId:'other-worker'}),
    values=>({...values,currentStateDigest:d({state:'changed'})})
  ]){
    const {authority:a}=authority();
    const x=input();
    const issued=await a.issueInternal(x);
    const base={token:issued.internalToken,tenant:x.tenant,providerRunId:x.providerRunId,workerId:x.workerId,currentStateDigest:x.stateDigest};
    await assert.rejects(()=>a.consumeInternal(mutate(base)),error=>[
      'WFM_PROVIDER_HANDOFF_SCOPE','WFM_PROVIDER_HANDOFF_STALE'
    ].includes(error.code));
  }
});

test('expired and signature-tampered handoffs fail closed',async()=>{
  const ctx=authority();
  const x=input({ttlMs:1000});
  const issued=await ctx.authority.issueInternal(x);
  ctx.setNow(1_900_000_001_001);
  await assert.rejects(
    ()=>ctx.authority.consumeInternal({token:issued.internalToken,tenant:x.tenant,providerRunId:x.providerRunId,workerId:x.workerId,currentStateDigest:x.stateDigest}),
    error=>error.code==='WFM_PROVIDER_HANDOFF_EXPIRED'
  );

  const fresh=authority();
  const issued2=await fresh.authority.issueInternal(input());
  const tampered=issued2.internalToken.slice(0,-1)+(issued2.internalToken.endsWith('A')?'B':'A');
  await assert.rejects(
    ()=>fresh.authority.consumeInternal({token:tampered,tenant:'northstar-demo',providerRunId:'provider-run-1',workerId:'normal-provider-worker-1',currentStateDigest:d({state:'running',checkpoint:2})}),
    error=>error.code==='WFM_PROVIDER_HANDOFF_SIGNATURE'
  );
});

test('continuation mutation in durable store is detected before disclosure',async()=>{
  const store=memoryStore();
  const ctx=authority({store});
  const x=input();
  const issued=await ctx.authority.issueInternal(x);
  const row=store.rows.get(issued.publicReceipt.handoffId);
  row.continuation={offset:999,limit:2};
  await assert.rejects(
    ()=>ctx.authority.consumeInternal({token:issued.internalToken,tenant:x.tenant,providerRunId:x.providerRunId,workerId:x.workerId,currentStateDigest:x.stateDigest}),
    error=>error.code==='WFM_PROVIDER_HANDOFF_TAMPER'
  );
});

test('one consumed action grant cannot mint multiple continuations',async()=>{
  const ctx=authority();
  await ctx.authority.issueInternal(input());
  await assert.rejects(
    ()=>ctx.authority.issueInternal(input({providerRunId:'provider-run-2'})),
    error=>error.code==='WFM_PROVIDER_HANDOFF_STORE'
  );
});

test('audit events contain digests but never raw continuation',async()=>{
  const {authority:a}=authority();
  const x=input();
  const issued=await a.issueInternal(x);
  await a.consumeInternal({token:issued.internalToken,tenant:x.tenant,providerRunId:x.providerRunId,workerId:x.workerId,currentStateDigest:x.stateDigest});
  const events=await a.events({tenant:x.tenant,handoffId:issued.publicReceipt.handoffId});
  assert.deepEqual(events.map(e=>e.type),['handoff-issued','handoff-consumed']);
  const serialised=JSON.stringify(events);
  assert.equal(serialised.includes('nextRequest'),false);
  assert.equal(serialised.includes('"offset":2'),false);
  assert.ok(serialised.includes(issued.publicReceipt.continuationDigest));
});
