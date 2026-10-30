'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {DatabaseSync}=require('node:sqlite');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {
  createSchedulingIntelligenceService,INTERNAL_HEADER
}=require(process.env.V032_SERVICE || '../../operations/runtime/scheduling-intelligence-service.cjs');

test('shadow plan rejects adjacent cross-site work without the required travel interval and survives reopen',async()=>{
  const home=mkdtempSync(join(tmpdir(),'vector-v032-consumer-'));
  const dbPath=join(home,'vector.sqlite');
  const db=new DatabaseSync(dbPath);
  db.exec('CREATE TABLE users(email TEXT,tenant TEXT,role TEXT,person_id TEXT,costs TEXT,permissions TEXT);'+
    'CREATE TABLE sessions(email TEXT,token_hash TEXT,expires TEXT);'+
    'CREATE TABLE tenants(id TEXT,version TEXT,state TEXT);');
  db.close();
  const svc=createSchedulingIntelligenceService({dbPath,internalToken:'fixture-secret'});
  try{
    const at=t=>'2026-10-12T'+t+'Z';
    const worker={id:'w1',type:'EMPLOYEE',status:'ACTIVE',homeSite:'A',eligibleSites:['A','B'],
      skills:['operator'],certifications:[],availability:[{start:at('00:00:00'),end:at('23:59:59')}],
      previousShiftEnd:null,hoursWorkedWeek:0,contractedHours:40,hourlyCost:20,
      travelMinutesBySite:{B:60}};
    const req=(id,site,start,end)=>({id,site,role:'operator',start:at(start),end:at(end),
      headcount:1,productionPriority:90,requiredSkills:['operator'],requiredCertifications:[]});
    const input={tenant:'fixture-alpha',contextRevision:'fixture-r1',
      sourceEvidence:['fixture:staff','fixture:routes'],createdAt:at('00:00:00'),workers:[worker],
      requirements:[req('first','A','08:00:00','10:00:00'),req('second','B','10:00:00','12:00:00')],
      policy:{minRestHours:0,maxWeeklyHours:168,maxOvertimeHours:100,ruleVersion:'fixture'}};
    const request=Object.assign(Readable.from([JSON.stringify({tenant:'fixture-alpha',input})]),
      {method:'POST',url:'/api/operations/scheduling/plan/shadow',
        headers:{[INTERNAL_HEADER]:'fixture-secret'}});
    const response={headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},
      end(v){this.body=JSON.parse(v);this.writableEnded=true;}};
    await svc.handleRequest(request,response);
    assert.equal(response.statusCode,201,JSON.stringify(response.body));
    assert.equal(response.body.authority,'NO_EXECUTION');
    assert.equal(response.body.plan.executionPermitted,false);
    assert.deepEqual(response.body.plan.assignments.filter(a=>a.workerId==='w1').map(a=>a.requirementId),
      ['first']);
    assert.equal(response.body.plan.unfilled[0].requirementId,'second');
    assert.ok(response.body.plan.unfilled[0].topReasons.some(r=>r.reason==='INSUFFICIENT_TRANSFER_TIME'));
    assert.deepEqual(svc.recentPlans('fixture-alpha').map(p=>p.planId),[response.body.plan.planId]);
    svc.close();
    const reopened=createSchedulingIntelligenceService({dbPath,internalToken:'fixture-secret'});
    try{
      assert.deepEqual(reopened.recentPlans('fixture-alpha').map(p=>p.planId),[response.body.plan.planId]);
    }finally{reopened.close();}
  }finally{svc.close();rmSync(home,{recursive:true,force:true});}
});
