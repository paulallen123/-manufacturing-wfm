'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,mkdirSync,rmSync,existsSync,readFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {spawnSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const vm=require('node:vm');
function assertLocalTimezoneConsumers(runtime) {
 const saved={NODE_ENV:process.env.NODE_ENV,WFM_TENANT_TIMEZONE:process.env.WFM_TENANT_TIMEZONE,WFM_TENANT_CLOCK_ISO:process.env.WFM_TENANT_CLOCK_ISO};
 try {
  process.env.NODE_ENV='test';process.env.WFM_TENANT_CLOCK_ISO='2026-01-15T00:30:00Z';
  for(const browser of [false,true]) {
   let rules,context;
   if(browser){
    context=vm.createContext({WFMTenantCalendarSnapshot:{asOf:'2026-01-15T00:30:00Z',localDate:'2026-01-15',timeZone:'Europe/London'}});
    for(const name of ['engine.js','cost-engine.js','work-rules.js'])vm.runInContext(readFileSync(join(runtime,'public',name),'utf8'),context,{filename:name});
    rules=context.WFMWorkRules;
   }else rules=require(join(runtime,'public/work-rules.js'));
   const zone=timeZone=>{if(browser)context.WFMTenantCalendarSnapshot={asOf:'2026-01-15T00:30:00Z',localDate:'2026-01-15',timeZone};else process.env.WFM_TENANT_TIMEZONE=timeZone;};
   for(const [timeZone,local,expected]of [
    ['Europe/London','2026-01-15T09:00','2026-01-15T09:00:00.000Z'],
    ['Europe/London','2026-07-15T09:00','2026-07-15T08:00:00.000Z'],
    ['Europe/Berlin','2026-07-15T09:00','2026-07-15T07:00:00.000Z'],
    ['America/Los_Angeles','2026-01-15T09:00','2026-01-15T17:00:00.000Z'],
    ['Pacific/Auckland','2026-01-15T09:00','2026-01-14T20:00:00.000Z'],
    ['Pacific/Kiritimati','2026-01-15T09:00','2026-01-14T19:00:00.000Z'],
    ['Asia/Kolkata','2026-01-15T09:00','2026-01-15T03:30:00.000Z'],
    ['Asia/Kathmandu','2026-01-15T09:00','2026-01-15T03:15:00.000Z']
   ]){zone(timeZone);assert.equal(rules.localResolve(local),expected,`${browser?'browser':'server'} ${timeZone}`);}
   for(const [timeZone,local,earlier,later]of [
    ['Europe/London','2026-10-25T01:30','2026-10-25T00:30:00.000Z','2026-10-25T01:30:00.000Z'],
    ['Australia/Lord_Howe','2026-04-05T01:45','2026-04-04T14:45:00.000Z','2026-04-04T15:15:00.000Z'],
    ['America/Los_Angeles','2026-11-01T01:30','2026-11-01T08:30:00.000Z','2026-11-01T09:30:00.000Z']
   ]){zone(timeZone);assert.throws(()=>rules.localResolve(local),/occurs twice/);assert.equal(rules.localResolve(local,'earlier'),earlier);assert.equal(rules.localResolve(local,'later'),later);}
   for(const [timeZone,local]of [['Europe/London','2026-03-29T01:30'],['Australia/Lord_Howe','2026-10-04T02:15'],['America/Los_Angeles','2026-03-08T02:30'],['Pacific/Apia','2011-12-30T12:00']]){zone(timeZone);assert.throws(()=>rules.localResolve(local),/does not exist/);}
   zone('Europe/London');assert.throws(()=>rules.localResolve('2026-02-30T09:00'),/Invalid local/);assert.throws(()=>rules.localResolve('2026-01-15T09:00','automatic'),/Unknown clock-change/);
   zone('America/Los_Angeles');const leave=rules.normaliseLeave({},{employee:'fictional-worker',start:'2026-11-15T09:00',end:'2026-11-15T17:00'});assert.equal(leave.start,'2026-11-15T17:00:00.000Z');assert.equal(leave.end,'2026-11-16T01:00:00.000Z');
   zone('Australia/Lord_Howe');const patternState={staff:[{id:'fictional-worker',job:'operator'}],workRules:{contracts:{},templates:[{id:'early',name:'Fictional early shift',start:'01:00',end:'03:00',endDayOffset:0,kind:'custom',breaks:[]}],patterns:[{id:'daily',name:'Fictional pattern',cycleDays:1,anchor:'2026-04-05',days:[{offset:0,template:'early'}]}]}};
   const shifts=rules.expandPattern(patternState,'fictional-worker','daily','2026-04-05',1);assert.equal(shifts.length,1);assert.equal(shifts[0].start,'2026-04-04T14:00:00.000Z');assert.equal(shifts[0].end,'2026-04-04T16:30:00.000Z');assert.equal(shifts[0].elapsedHours,2.5);assert.equal(shifts[0].clockChange,true);
   const instant=Date.parse('2026-01-15T00:30:00Z');zone('Europe/London');assert.deepEqual(JSON.parse(JSON.stringify(rules.localInfo(instant))),{date:'2026-01-15',minute:30});
   zone('America/Los_Angeles');assert.deepEqual(JSON.parse(JSON.stringify(rules.localInfo(instant))),{date:'2026-01-14',minute:990});
   if(browser)context.WFMTenantCalendarSnapshot=null;else process.env.WFM_TENANT_TIMEZONE='Invalid/Unavailable';
   assert.throws(()=>rules.localInfo(instant),/Tenant calendar authority unavailable/);assert.throws(()=>rules.localResolve('2026-01-15T09:00'),/Tenant calendar authority unavailable/);
  }
 }finally{for(const [key,value]of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;}
}
function assertCompiledTimezone(runtime) {
 const compilerPath=join(runtime,'lib/configuration-compiler.cjs');
 assert.equal(createHash('sha256').update(readFileSync(compilerPath)).digest('hex'),'c16762100bef6c7516ec77a139c9f792adbc04f5a2363b21c32cfc86eaff584e');
 const result=require(compilerPath).compile({sites:[{code:'AA',name:'Factory',timezone:'America/Argentina/Buenos_Aires'}],modules:['core'],workforce:{count:1,languages:['en'],shiftPatterns:1},integrations:[],trainingRoles:['employee']});
 assert.equal(result.status,'compiled');
 assert.equal(result.scope.sites[0].timezone,'America/Argentina/Buenos_Aires');
}
const fixtureEnv = temporary => process.platform === 'win32'
 ? {PATH: process.env.SystemRoot + '\\System32', SystemRoot: process.env.SystemRoot, HOME: temporary, USERPROFILE: temporary, TEMP: temporary, TMP: temporary}
 : {PATH:'/usr/bin:/bin',HOME:temporary};

test('composer preserves the absent-directory canonical caller contract',()=>{
 const source=join(__dirname,'compose-vector-local-runtime.mjs');
 const temporary=mkdtempSync(join(tmpdir(),'vector-canonical-composer-'));
 const runtime=join(temporary,'runtime');
 assert.equal(existsSync(runtime),false);
 try{
  const result=spawnSync(process.execPath,[source,runtime],{cwd:join(__dirname,'..'),env:fixtureEnv(temporary),encoding:'utf8',timeout:120000});
  assert.equal(result.status,0,`Canonical composition failed. Actual stderr:\n${result.stderr}`);
  assertCompiledTimezone(runtime);
  assertLocalTimezoneConsumers(runtime);
  assert.equal(existsSync(join(runtime,'LOCAL_PROOF_PROVENANCE.json')),true);
  assert.equal(existsSync(join(runtime,'security-runtime/bootstrap.cjs')),true);
  assert.equal(existsSync(join(runtime,'STAFFOLOGY_ASSEMBLY.json')),true);
  const provenance=JSON.parse(readFileSync(join(runtime,'LOCAL_PROOF_PROVENANCE.json'),'utf8'));
  assert.ok(provenance.runtimeFiles.some(file=>file.path==='integrations/staffology/canonical-production-boundaries.cjs'));
  assert.ok(provenance.runtimeFiles.some(file=>file.path==='integrations/staffology/canonical-operations.cjs'));
  const assembly=JSON.parse(readFileSync(join(runtime,'STAFFOLOGY_ASSEMBLY.json'),'utf8'));
  assert.equal(assembly.sealedRuntimePreserved,true);
  assert.equal(assembly.activationAvailable,false);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});

test('composer preserves the extracted-runtime container caller contract',()=>{
 const source=join(__dirname,'compose-vector-local-runtime.mjs');
 const root=join(__dirname,'..');
 const temporary=mkdtempSync(join(tmpdir(),'vector-container-composer-'));
 const runtime=join(temporary,'runtime');
 try{
  mkdirSync(runtime);
  const extracted=spawnSync('tar',['--no-same-owner','-xzf',join(root,'artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz'),'-C',runtime],{encoding:'utf8',timeout:120000});
  assert.equal(extracted.status,0,`Sealed runtime extraction failed. Actual stderr:\n${extracted.stderr}`);
  const result=spawnSync(process.execPath,[source,runtime],{cwd:root,env:fixtureEnv(temporary),encoding:'utf8',timeout:120000});
  assert.equal(result.status,0,`Container composition failed. Actual stderr:\n${result.stderr}`);
  assertCompiledTimezone(runtime);
  assertLocalTimezoneConsumers(runtime);
  assert.equal(existsSync(join(runtime,'STAFFOLOGY_ASSEMBLY.json')),true);
  assert.equal(existsSync(join(runtime,'LOCAL_PROOF_PROVENANCE.json')),false);
  const assembly=JSON.parse(readFileSync(join(runtime,'STAFFOLOGY_ASSEMBLY.json'),'utf8'));
  assert.equal(assembly.sealedRuntimePreserved,true);
  assert.equal(assembly.activationAvailable,false);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});

// Annual-only request admission: use real composed modules and explicit synthetic
// dated openings. This is not delegation, customer policy or live balance proof.
{
 const fs=require('node:fs'),path=require('node:path');
 const sourceRoot=join(__dirname,'..');
 const requestKindAnchor="assert(a.role==='employee','Employee access is required.',403);const v=normaliseLeave(s,{...p,employee:a.personId});";
 function composeKindRuntime(caller,drift){
  const temporary=mkdtempSync(join(tmpdir(),'vector-annual-kind-')),runtime=join(temporary,'runtime');
  if(caller==='container'){
   mkdirSync(runtime);
   const extracted=spawnSync('tar',['--no-same-owner','-xzf',join(sourceRoot,'artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz'),'-C',runtime],{encoding:'utf8',timeout:120000});
   assert.equal(extracted.status,0,extracted.stderr);
   if(drift){
    const file=join(runtime,'public/work-rules.js'),text=readFileSync(file,'utf8');assert.equal(text.split(requestKindAnchor).length,2);
    fs.writeFileSync(file,drift==='missing'?text.replace('Employee access is required.','Fixture employee-access wording changed.'):text+'\n// '+requestKindAnchor+'\n');
   }
  }
  const result=spawnSync(process.execPath,[join(sourceRoot,'scripts/compose-vector-local-runtime.mjs'),runtime],{cwd:sourceRoot,env:fixtureEnv(temporary),encoding:'utf8',timeout:120000});
  return {temporary,runtime,result};
 }
 for(const caller of ['canonical','container']){
  const composed=composeKindRuntime(caller);assert.equal(composed.result.status,0,composed.result.stderr);test.after(()=>rmSync(composed.temporary,{recursive:true,force:true}));
  const root=composed.runtime;
const names=['engine','cost-engine','economic-cost-engine','work-rules','payroll-control','demand-engine','operations-engine','availability-control','personal-view'];
const sources=Object.fromEntries(names.map(n=>[n+'.js',fs.readFileSync(path.join(root,'public',n+'.js'),'utf8')]));
const clock='2026-10-29T12:00:00.000Z';
function modules(browser){
 const context=vm.createContext({console,process:{env:{NODE_ENV:'test',WFM_TENANT_TIMEZONE:'Europe/London',WFM_TENANT_CLOCK_ISO:clock}},WFMTenantCalendarSnapshot:{asOf:clock,localDate:'2026-10-29',timeZone:'Europe/London'}}),cache={};
 function load(name){
  if(name==='../operations-runtime/tenant-calendar.cjs')return require(path.join(root,'operations-runtime/tenant-calendar.cjs'));
  name=name.replace(/^\.\//,'');if(!name.endsWith('.js'))name+='.js';assert.ok(Object.hasOwn(sources,name),name);
  if(cache[name])return cache[name].exports;const m={exports:{}};cache[name]=m;vm.runInContext('(function(module,exports,require){'+sources[name]+'\n})',context,{filename:name})(m,m.exports,load);return m.exports;
 }
 if(browser){for(const n of ['engine','cost-engine','economic-cost-engine','work-rules','payroll-control','demand-engine','operations-engine','personal-view'])vm.runInContext(sources[n+'.js'],context,{filename:n+'.js'});return {R:context.WFMWorkRules,O:context.WFMOps,V:context.WFMPersonalView};}
 return {R:load('work-rules'),O:load('operations-engine'),V:load('personal-view')};
}
function fixture(){
 // Reuse the declared reviewed-opening shape from the admitted dated-leave
 // suite. These are explicit synthetic values, not customer entitlement proof.
 return {version:1,audit:[],staff:[{id:'worker1',name:'Synthetic Worker',manager:'mgr',site:'site1',team:'mgr',workerType:'employee'}],org:[{id:'mgr',parent:null}],requests:[],
 operations:{leaveOpenings:{worker1:{yearStart:'2026-01-01',yearEnd:'2026-12-31',asOf:'2026-10-29',remainingMinutes:600,usedBeforeMinutes:600,annualMinutes:1200,source:'Synthetic reviewed opening',revision:1}}},
 workRules:{revision:1,leaveBalances:{},absences:[],leaveRules:[{id:'rule1',team:'mgr',denominator:'scheduled',percent:null,maxOff:1,minPresent:0,reservePending:true,skills:[],numerator:'scheduled_requests'}],roster:[{id:'shift',employee:'worker1',department:'mgr',site:'site1',start:'2026-11-02T08:00:00.000Z',end:'2026-11-02T16:00:00.000Z',breaks:[]}]}};
}
const employee={role:'employee',personId:'worker1',permissions:[]},manager={role:'manager',personId:'mgr',permissions:[]};
const input={date:'2026-11-02',hours:8};
function submit(h,entry,s,p,actor=employee){return entry==='personal'?h.V.workCommand(s,actor,'leave-request',p):h.R.dispatch(s,actor,'rules-leave-request',p);}
function unchanged(s,fn,predicate){const before=JSON.stringify(s);assert.throws(fn,predicate);assert.equal(JSON.stringify(s),before);}
const unsupported=[['Sickness','Sickness'],['Unpaid leave','Unpaid leave'],['Parental leave','Parental leave'],['empty string',''],['null',null],['number',0],['object',{name:'Annual leave'}],['array',['Annual leave']]];
for(const browser of [false,true]){
 const mode=caller+' '+(browser?'browser-global':'CommonJS'),h=modules(browser);
 for(const entry of ['rules','personal']){
  for(const [label,kind]of unsupported)test(`${mode} ${entry}: explicit ${label} is refused instead of saved as Annual leave`,()=>{
   const s=fixture();assert.equal(h.O.leaveBudget(s,'worker1'),10,'Actual dated-budget consumer is loaded, not the legacy balance fallback');
   unchanged(s,()=>submit(h,entry,s,{...input,kind}),e=>e.status===409&&/Annual leave.*only|Only Annual leave/.test(e.message));
  });
  for(const explicit of [false,true])test(`${mode} ${entry}: ${explicit?'exact Annual leave':'omitted kind'} preserves request and normal manager approval`,()=>{
   const s=fixture(),opening=JSON.stringify(s.operations.leaveOpenings);const r=submit(h,entry,s,{...input,...(explicit?{kind:'Annual leave'}:{})});assert.equal(r.status,'pending');assert.equal(r.capacity.status,'prechecks_clear');assert.equal(s.requests[0].kind,'Annual leave');assert.equal(h.O.leaveBudget(s,'worker1'),2);
   assert.equal(h.R.decideLeave(s,manager,{id:r.id,decision:'approved',reviewed:true}).status,'approved');assert.equal(JSON.stringify(s.operations.leaveOpenings),opening);assert.equal(s.audit.filter(x=>x.type==='leave-request').length,1);assert.equal(s.audit.filter(x=>x.type==='leave-decision').length,1);
  });
  test(`${mode} ${entry}: missing reviewed opening still denies Annual leave without invented credit`,()=>{
   const s=fixture();delete s.operations.leaveOpenings.worker1;unchanged(s,()=>submit(h,entry,s,input),e=>/Insufficient recorded leave balance/.test(e.message));
  });
  test(`${mode} ${entry}: agency coordination refusal remains ahead of unsupported kind`,()=>{
   const s=fixture();s.staff[0].workerType='agency';unchanged(s,()=>submit(h,entry,s,{...input,kind:'Sickness'}),e=>e.status===409&&/Agency-managed leave/.test(e.message));
  });
 }
 test(`${mode}: rules entry preserves employee-only refusal before unsupported kind`,()=>{const s=fixture();unchanged(s,()=>submit(h,'rules',s,{...input,kind:'Sickness'},manager),e=>e.status===403);});
 test(`${mode}: personal subject rejection remains before unsupported kind`,()=>{const s=fixture();unchanged(s,()=>submit(h,'personal',s,{...input,kind:'Sickness',employee:'other'}),e=>e.status===403&&/personal subject/.test(e.message));});
 test(`${mode}: missing personal employment still refuses before unsupported kind`,()=>{const s=fixture();s.staff=[];unchanged(s,()=>submit(h,'personal',s,{...input,kind:'Sickness'}),e=>e.status===409&&/Link an employment record/.test(e.message));});
 test(`${mode}: existing Annual same-person overlap still refuses without changing state`,()=>{const s=fixture();submit(h,'rules',s,input);unchanged(s,()=>submit(h,'rules',s,{...input,kind:'Annual leave'}),e=>e.status===409&&/Overlapping request/.test(e.message));});
}

 }
 for(const drift of ['missing','duplicate'])test('container refuses '+drift+' Annual-only request-kind patch anchor',()=>{
  const composed=composeKindRuntime('container',drift);
  try{assert.notEqual(composed.result.status,0);assert.match(composed.result.stderr,/ANNUAL_LEAVE_KIND_ANCHOR_CHANGED/);}
  finally{rmSync(composed.temporary,{recursive:true,force:true});}
 });
}
