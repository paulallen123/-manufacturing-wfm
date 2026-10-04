'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process'),{DatabaseSync}=require('node:sqlite');
const sealedRoot=process.env.VECTOR_SEALED_PROOF_ROOT||path.resolve(__dirname,'../../advisory/recovery-regression/sealed-recovery-proof');
for(const mode of ['audit-outage','crash-after-acquire','crash-after-consume','crash-inside-acquire','state-changed-after-consume'])test(`mandatory recovery audit survives or lease rolls back: ${mode}`,()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-corrected-recovery-audit-'));let db;
 try{
  const child=spawnSync(process.execPath,[path.join(__dirname,'recovery-fault-child.mjs')],{cwd:__dirname,env:{...process.env,SEALED_PROOF_ROOT:sealedRoot,TAR_OPTIONS:'--no-same-owner',ISOLATED_PROOF_DIR:dir,ISOLATED_PROOF_MODE:mode},encoding:'utf8',timeout:15000});
  if(mode==='audit-outage'||mode==='state-changed-after-consume')assert.equal(child.status,0,child.stderr);else assert.equal(child.signal,'SIGKILL',child.stderr);
  db=new DatabaseSync(path.join(dir,'proof.sqlite'));
  const run=db.prepare('SELECT state,lease_owner,lease_generation FROM provider_adapter_runs ORDER BY created_at LIMIT 1').get();
  const events=db.prepare('SELECT event_type,grant_jti,detail_json FROM provider_recovery_authority_events ORDER BY id').all();
  const outcome=events.filter(x=>x.event_type==='bounded-recovery-lease-acquired');
  const stored=JSON.parse(fs.readFileSync(path.join(dir,'synthetic-permit.json'),'utf8'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM agent_action_grants WHERE consumed_at IS NOT NULL').get().n,1);
  if(mode==='crash-after-acquire'){
   assert.equal(run.state,'running');assert.equal(run.lease_owner,'isolated-fault-worker');assert.equal(outcome.length,1);
   assert.equal(outcome[0].grant_jti,stored.grant.jti);assert.equal(JSON.parse(outcome[0].detail_json).leaseGeneration,run.lease_generation);
  }else{
   assert.equal(run.state,'retry');assert.equal(run.lease_owner,null);assert.equal(outcome.length,0);
   assert.equal(db.prepare("SELECT COUNT(*) n FROM provider_adapter_run_events WHERE worker_id='isolated-fault-worker'").get().n,0);
  }
  if(mode==='audit-outage'||mode==='state-changed-after-consume')assert.equal(events.filter(x=>x.event_type==='permit-consumed-acquire-failed').length,1);
  const ATA=require(path.join(dir,'runtime/lib/agent-tool-authority.cjs'));
  const authority=ATA.createAuthority({key:'ci-only-agent-authority-key-0123456789abcdef0123456789abcdef',db,toolPolicy:{'provider-recovery-executor':['integration.retry','integration.replay-idempotent']}}),g=stored.grant;
  assert.throws(()=>authority.consumeActionToken({token:stored.permit,tenant:g.tenant,agentScope:g.agentScope,toolId:g.toolId,actionType:g.actionType,targetDigest:g.targetDigest,decisionDigest:g.decisionDigest,executorId:'reopened-worker'}),{code:'WFM_AGENT_ACTION_REPLAY'});
 }finally{if(db)db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
