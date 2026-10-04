'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const {createAutonomyControlLoop,digest}=require('../resilience/autonomy-control-loop.cjs'),contract=require('../resilience/support-tier-contract.json'),failureScenarios=require('../resilience/failure-scenarios.json');
for(const reopen of [false,true]) test(`missing witness fails closed with reopen=${reopen}`,async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-witness-loss-')),file=path.join(dir,'authority.sqlite'),db=new DatabaseSync(file);let calls=0;
 const options={contract,failureScenarios,authorityDb:db,recoveryExecutor:{execute:async()=>{calls++;return {};}}};
 try {let loop=createAutonomyControlLoop(options);const input={tenant:'isolated-a',incidentId:'first',scenarioId:'worker-unhealthy',evidenceDigest:digest('evidence')};await loop.run(input);assert.equal(calls,1);fs.unlinkSync(file+'.consumed-authority.sqlite');if(reopen)loop=createAutonomyControlLoop(options);const receipt=await loop.run({...input,incidentId:'second'});assert.equal(receipt.outcome,'contained');assert.equal(receipt.containedErrorCode,'WFM_AUTONOMY_WITNESS_REQUIRED');assert.equal(calls,1);assert.equal(fs.existsSync(file+'.consumed-authority.sqlite'),false);}finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('replaced empty witness is not adopted on reopen',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-witness-replaced-')),file=path.join(dir,'authority.sqlite'),db=new DatabaseSync(file);let calls=0;
 const options={contract,failureScenarios,authorityDb:db,recoveryExecutor:{execute:async()=>{calls++;return {};}}};
 try {createAutonomyControlLoop(options);fs.writeFileSync(file+'.consumed-authority.sqlite','');const loop=createAutonomyControlLoop(options);const receipt=await loop.run({tenant:'isolated-a',incidentId:'first',scenarioId:'worker-unhealthy',evidenceDigest:digest('evidence')});assert.equal(receipt.containedErrorCode,'WFM_AUTONOMY_WITNESS_REQUIRED');assert.equal(calls,0);}finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
