'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createDecisionEpisode,selectDecisionOption,recordDecisionOutcome}=require('./decision-episode.cjs');
const {createOutcomeLearningService}=require('./outcome-learning-service.cjs');

function completed({tenant='A',trigger,actual}){
  const episode=createDecisionEpisode({
    tenant,site:'S1',decisionType:'absence-recovery',triggerId:trigger,
    triggeredAt:new Date().toISOString(),contextRevision:'ctx-'+trigger,mode:'HUMAN_APPROVAL',
    sourceEvidence:['attendance:'+trigger,'demand:'+trigger],
    objective:{labourCost:1,uncertaintyPenalty:.1},
    options:[
      {id:'do-nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:.05,prediction:{labourCost:500}},
      {id:'overtime',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:.05,prediction:{labourCost:300}}
    ]
  });
  const selected=selectDecisionOption(episode,{
    optionId:'overtime',selectedAt:new Date().toISOString(),
    actorRef:'manager@example.invalid',authorityDecision:'HUMAN_APPROVED'
  });
  return recordDecisionOutcome(selected,{
    observedAt:new Date().toISOString(),
    evidenceRefs:['payroll:result:'+trigger,'mes:result:'+trigger],
    actual:{labourCost:actual}
  });
}

function verifiedInput(trigger,actual,tenant='A'){
  return {
    episode:completed({tenant,trigger,actual}),
    metric:'labourCost',
    direction:'MINIMIZE',
    classification:'VERIFIED_OPERATIONAL',
    baselineActual:520,
    baselineEvidenceRefs:['payroll:baseline:'+trigger]
  };
}

test('verified operational learning persists across restart without granting authority',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-outcome-learning-'));
  const dbPath=path.join(dir,'proof.sqlite');
  const engineModulePath=path.resolve(__dirname,'../../adaptive-intelligence/engine.mjs');

  let service=createOutcomeLearningService({dbPath,engineModulePath});
  await service.ready();

  const inputs=[
    verifiedInput('win-1',320),
    verifiedInput('win-2',315),
    verifiedInput('win-3',310)
  ];
  const receipts=[];
  for(const input of inputs) receipts.push(await service.recordOutcome(input));
  assert.ok(receipts.every(x=>x.duplicate===false));

  const duplicate=await service.recordOutcome(inputs[0]);
  assert.equal(duplicate.duplicate,true,'same proof must be idempotent');

  const before=await service.snapshotForTenant('A');
  assert.equal(before.outcomes.length,3);
  assert.equal(before.skills.length,1);
  assert.equal(before.skills[0].status,'candidate');
  assert.equal(before.skills[0].authority,'none');
  assert.equal(before.skills[0].verifiedWinCount,3);

  await assert.rejects(
    service.recordOutcome({
      episode:completed({tenant:'A',trigger:'simulated',actual:320}),
      metric:'labourCost',direction:'MINIMIZE',classification:'SIMULATED'
    }),
    /verified|learning/i
  );

  service.close();

  service=createOutcomeLearningService({dbPath,engineModulePath});
  await service.ready();
  const after=await service.snapshotForTenant('A');
  assert.equal(after.outcomes.length,3,'persisted proofs must replay exactly once');
  assert.equal(after.skills.length,1,'restart must recreate one candidate, not duplicate it');
  assert.equal(after.skills[0].authority,'none');
  assert.equal(after.skills[0].verifiedWinCount,3);

  const other=await service.snapshotForTenant('B');
  assert.deepEqual(other.outcomes,[]);
  assert.deepEqual(other.skills,[]);
  assert.deepEqual(other.evals,[]);

  service.close();
  fs.rmSync(dir,{recursive:true,force:true});
});
