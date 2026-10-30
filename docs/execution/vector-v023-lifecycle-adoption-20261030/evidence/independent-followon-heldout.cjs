const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const root=process.env.V023_REVIEW_ROOT;
const B=require(path.join(root,'integrations/staffology/canonical-runtime-bridge.cjs'));
const S=require(path.join(root,'integrations/staffology/staffology-adapter.cjs'));
const baseRecord={externalId:'review-person',revision:'review-revision',operation:'upsert',data:{identity:{employeeId:'review-person',payrollCode:'R001'},person:{firstName:'Review',lastName:'Synthetic'},employment:{effectiveFrom:'2026-01-01'}}};
const receipt={approved:true,idempotencyKey:'independent-v023',mappings:[{externalId:'review-person',payrollId:'R001',managerId:'manager-1',site:'Factory',job:'Operator',contractType:'full_time',weeklyHours:'37.5'}]};
function acquisition(employment){const record=structuredClone(baseRecord);Object.assign(record.data.employment,employment);return {objectType:'people',cursor:'complete',sourceVersion:'synthetic-v1',paginationComplete:true,atomicProviderSnapshot:false,records:[record]};}
function guarded(){let calls=0;const runtime=B.createRuntime({loadState:()=>({}),stagePeople:()=>{calls++;return {id:'stage-review',status:'staged'};}});return {run:(a,r=receipt)=>runtime.stageEmployeeAcquisition({tenant:'review-tenant'},a,r),count:()=>calls};}
function employee(extra){return {id:'review-person',personalDetails:{firstName:'Review',lastName:'Synthetic'},employmentDetails:{payrollCode:'R001',starterDetails:{startDate:'2026-01-01'},leaverDetails:extra}};}

test('missing/null lifecycle authority rejects before staging for both past and future end dates',()=>{
 for(const date of ['2026-02-01','2026-12-31'])for(const status of [undefined,null])for(const hasLeft of [undefined,null]){
  const g=guarded(),a=acquisition({status,hasLeft,effectiveTo:date}),before=JSON.stringify(a);
  assert.throws(()=>g.run(a),{code:'STAFFOLOGY_EMPLOYEE_LIFECYCLE_UNRESOLVED'});assert.equal(g.count(),0);assert.equal(JSON.stringify(a),before);
 }
});
test('Current/Upcoming without explicit leaver flag refuse dated staging',()=>{
 for(const status of ['Current','Upcoming']){const g=guarded();assert.throws(()=>g.run(acquisition({status,effectiveTo:'2026-12-31'})),{code:'STAFFOLOGY_EMPLOYEE_LIFECYCLE_UNRESOLVED'});assert.equal(g.count(),0);}
});
test('contradictory lifecycle assertions refuse before staging',()=>{
 for(const [status,hasLeft] of [['Current',true],['Upcoming',true],['Former',false]]){const g=guarded();assert.throws(()=>g.run(acquisition({status,hasLeft,effectiveTo:'2026-12-31'})),{code:'STAFFOLOGY_EMPLOYEE_LIFECYCLE_UNRESOLVED'});assert.equal(g.count(),0);}
});
test('actual raw mapper refuses dated missing-status data without hasLeft',()=>{
 const record=employee({leaveDate:'2026-12-31'}),before=JSON.stringify(record);assert.throws(()=>S.mapEmployee(record,{employerId:'review-employer'}),{code:'STAFFOLOGY_EMPLOYEE_LIFECYCLE_UNRESOLVED'});assert.equal(JSON.stringify(record),before);
});
test('dated nonformer source evidence survives acquisition but refuses before staging without date loss',()=>{
 for(const leaveDate of ['2026-02-01','2026-12-31'])for(const status of [undefined,null,'Current','Upcoming']){
  const record=employee({hasLeft:false,leaveDate});if(status!==undefined&&status!==null)record.status=status;
  const mapped=S.mapEmployee(record,{employerId:'review-employer'});assert.equal(mapped.data.employment.effectiveTo,leaveDate);assert.equal(mapped.data.employment.hasLeft,false);
  const a=acquisition({});a.records=[mapped];if(status===null)a.records[0].data.employment.status=null;const before=JSON.stringify(a);const g=guarded();
  assert.throws(()=>g.run(a),{code:'STAFFOLOGY_EMPLOYEE_LIFECYCLE_UNRESOLVED'});assert.equal(g.count(),0);assert.equal(JSON.stringify(a),before);
 }
 const noEnd=S.mapEmployee(employee({hasLeft:false}),{employerId:'review-employer'});const a=acquisition({});a.records=[noEnd];const g=guarded();g.run(a);assert.equal(g.count(),1);assert.equal(B.peopleEnvelope(a,receipt).records[0].operation,'upsert');
});
test('explicit confirmed leaver is represented only as held delete, never applicable onboarding',()=>{
 const output=B.peopleEnvelope(acquisition({status:null,hasLeft:true,effectiveTo:'2026-02-01'}),receipt).records[0];assert.equal(output.operation,'delete');assert.throws(()=>B.assertPeopleApplicationRecord(output),{code:'STAFFOLOGY_EMPLOYEE_LIFECYCLE_REQUIRED'});
 const g=guarded();assert.throws(()=>g.run(acquisition({status:null,hasLeft:true})),{code:'STAFFOLOGY_EMPLOYEE_LIFECYCLE_UNRESOLVED'});assert.equal(g.count(),0);
});
test('review flag absence refuses before any staging callback',()=>{
 const g=guarded();assert.throws(()=>g.run(acquisition({status:'Current',hasLeft:false}),{...receipt,approved:false}),{code:'STAFFOLOGY_EMPLOYEE_MAPPING_REQUIRED'});assert.equal(g.count(),0);
});
test('no provider write authority means the injected client is never reached',async()=>{
 let calls=0;await assert.rejects(S.request(async()=>{calls++;throw Error('client must not run');},{apiKey:'SYNTHETIC-NONSECRET',baseUrl:'https://api.staffology.co.uk',timeoutMs:100},'/employers/review-employer/payrun/Monthly/importpay',{method:'POST',body:[]}));assert.equal(calls,0);
});
