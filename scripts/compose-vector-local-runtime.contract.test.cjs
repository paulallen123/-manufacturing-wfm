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
