'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const {spawnSync}=require('node:child_process'),os=require('node:os');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'vector-cost-calendar-'));
const runtime=process.env.VECTOR_COST_TEST_RUNTIME||path.join(temporary,'runtime');
if(!process.env.VECTOR_COST_TEST_RUNTIME){const composed=spawnSync(process.execPath,[path.join(__dirname,'compose-vector-local-runtime.mjs'),runtime],{cwd:path.join(__dirname,'..'),env:{PATH:process.env.PATH},encoding:'utf8',timeout:120000});assert.equal(composed.status,0,composed.stderr);}
test.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
const instant='2026-01-15T00:30:00Z';
process.env.NODE_ENV='test';process.env.WFM_TENANT_CLOCK_ISO=instant;process.env.WFM_TENANT_TIMEZONE='America/Los_Angeles';
const currentCalendar=zone=>require(path.join(runtime,'operations-runtime/tenant-calendar.cjs')).createTenantCalendar({env:{NODE_ENV:'test',WFM_TENANT_TIMEZONE:zone},now:()=>Date.parse(instant)}).snapshot({tenant:'synthetic-only'});
function api(browser){
 if(!browser){const E=require(path.join(runtime,'public/engine.js')),C=require(path.join(runtime,'public/cost-engine.js'));return {E,C,zone:z=>{process.env.WFM_TENANT_TIMEZONE=z;}};}
 const context=vm.createContext({WFMTenantCalendarSnapshot:currentCalendar('America/Los_Angeles')});for(const n of ['engine.js','cost-engine.js','work-rules.js'])vm.runInContext(fs.readFileSync(path.join(runtime,'public',n),'utf8'),context,{filename:n});return {E:context.WFMEngine,C:context.WFMCost,zone:z=>{context.WFMTenantCalendarSnapshot=currentCalendar(z);},context};
}
const policy={effectiveFrom:'2026-01-01',stacking:'highest',weeklyTiers:[],dailyTiers:[],bankHolidayMultiplier:1,weekendMultiplier:1,nightMultiplier:2,region:'england-and-wales',warningPercent:90,version:'synthetic-only'};
function state(rates){return {staff:[{id:'w',site:'synthetic'}],costing:{rates:{w:rates},policies:{synthetic:[policy]},employeePolicies:{}}};}
const rate=(from,value,currency='GBP')=>({effectiveFrom:from,currency,basis:'hourly',hourlyRate:value,oncostPercent:0,oncostHourly:0});
const shift=(start,end)=>[{id:'synthetic-shift',start,end,employee:'w',breaks:[]}];
for(const browser of [false,true]){
 const prefix=browser?'browser':'server';let a=api(browser);
 test(prefix+': cost localDay uses explicitly configured tenant timezone',()=>{a.zone('America/Los_Angeles');assert.equal(a.C.localDay(instant),'2026-01-14');a.zone('Asia/Tokyo');assert.equal(a.C.localDay(instant),'2026-01-15');});
 test(prefix+': explicit report timestamp and live calendar use the same tenant timezone',()=>{a.zone('America/Los_Angeles');const p=a.E.periodBounds('daily',instant);assert.equal(p.end,'2026-01-14');assert.equal(p.timezone,'America/Los_Angeles');assert.equal(p.cutoffLocal,'16:30:00');assert.equal(a.E.periodBounds('daily').end,p.end);});
 test(prefix+': local midnight splits effective rates without moving instant boundaries',()=>{a.zone('America/Los_Angeles');const b=a.C.priceShifts(state([rate('2026-01-01',10),rate('2026-01-15',20)]),'w',shift('2026-01-15T07:30:00Z','2026-01-15T08:30:00Z'));assert.equal(b.status,'priced');assert.equal(b.hours,1);assert.equal(b.basePence,1500);assert.equal(b.grossPence,3000);assert.deepEqual(Array.from(b.rows,x=>x.date),['2026-01-14','2026-01-15']);});
 test(prefix+': local night boundary uses the same tenant timezone as date and rate',()=>{a.zone('America/Los_Angeles');const b=a.C.priceShifts(state([rate('2026-01-01',10)]),'w',shift('2026-01-15T06:30:00Z','2026-01-15T07:30:00Z'));assert.equal(b.hours,1);assert.equal(b.basePence,1000);assert.equal(b.grossPence,1500);});
 test(prefix+': spring gap and autumn fold preserve elapsed hours with synthetic GBP policy',()=>{a.zone('America/Los_Angeles');for(const [start,end,hours]of [['2026-03-08T08:30:00Z','2026-03-08T10:30:00Z',2],['2026-11-01T07:30:00Z','2026-11-01T11:30:00Z',4]]){const b=a.C.priceShifts(state([rate('2026-01-01',10)]),'w',shift(start,end));assert.equal(b.status,'priced');assert.equal(b.hours,hours);assert.equal(b.basePence,hours*1000);assert.equal(b.grossPence,hours*2000);}});
 test(prefix+': resolver cache follows timezone change and London results remain correct',()=>{const s=state([rate('2026-01-01',10),rate('2026-01-15',20)]);a.zone('Europe/London');const b=a.C.priceShifts(s,'w',shift('2026-01-14T23:30:00Z','2026-01-15T00:30:00Z'));assert.equal(b.basePence,1500);assert.equal(b.grossPence,3000);a.zone('America/Los_Angeles');const c=a.C.priceShifts(s,'w',shift('2026-01-15T07:30:00Z','2026-01-15T08:30:00Z'));assert.equal(c.basePence,1500);assert.equal(c.grossPence,3000);});
 test(prefix+': non-GBP currency remains explicitly unavailable, no FX authority invented',()=>{a.zone('Europe/London');const b=a.C.priceShifts(state([rate('2026-01-01',10,'EUR')]),'w',shift('2026-01-15T08:00:00Z','2026-01-15T09:00:00Z'));assert.equal(b.status,'review');assert.equal(b.complete,false);assert.match(b.issues[0].reason,/Only GBP/);assert.equal(a.E.employmentRate(state([rate('2026-01-01',10,'EUR')]),'w','2026-01-15'),null);});
 test(prefix+': invalid explicit server zone or missing browser calendar fails closed',()=>{if(browser)a.context.WFMTenantCalendarSnapshot=null;else process.env.WFM_TENANT_TIMEZONE='Invalid/Zone';assert.throws(()=>a.C.localDay(instant),/Tenant calendar authority unavailable/);a.zone('Europe/London');});
}
test('unchanged inherited browser/server timezone and ambiguity oracle remains valid',()=>{const context=vm.createContext({assert,vm,process,require,readFileSync:fs.readFileSync,join:path.join});vm.runInContext((()=>{const source=fs.readFileSync(path.join(__dirname,'compose-vector-local-runtime.contract.test.cjs'),'utf8');const start='function assertLocalTimezoneConsumers(',end='function assertCompiledTimezone(';assert.equal(source.split(start).length,2);assert.equal(source.split(end).length,2);return source.slice(source.indexOf(start),source.indexOf(end));})(),context);context.assertLocalTimezoneConsumers(runtime);});

test('fresh direct Node cost import preserves first/repeated legacy pricing without creating global work-rules',()=>{const result=JSON.parse(execFileSync(process.execPath,[path.join(__dirname,'tenant-cost-calendar-direct-probe.cjs'),runtime],{encoding:'utf8'}));assert.deepEqual(result,{before:false,between:false,after:false,first:1000,second:1000,stateUnchanged:true});});
test('explicitly loaded Node work-rules preserve first/repeated contract allowance pricing',()=>{const result=JSON.parse(execFileSync(process.execPath,[path.join(__dirname,'tenant-cost-calendar-direct-probe.cjs'),runtime,'eager'],{encoding:'utf8'}));assert.deepEqual(result,{before:true,between:true,after:true,first:1300,second:1300,stateUnchanged:true});});
test('browser missing work-rules resolver refuses cost evaluation instead of choosing another clock resolver',()=>{const context=vm.createContext({WFMTenantCalendarSnapshot:currentCalendar('America/Los_Angeles')});for(const name of ['engine.js','cost-engine.js'])vm.runInContext(fs.readFileSync(path.join(runtime,'public',name),'utf8'),context);assert.equal(context.WFMWorkRules,undefined);assert.throws(()=>context.WFMCost.priceShifts(state([rate('2026-01-01',10)]),'w',shift('2026-01-15T08:00:00Z','2026-01-15T09:00:00Z')),/Tenant local-time resolver unavailable/);});

test('proposal extraction refuses drift in copied resolver and referenced validators/constants',()=>{const proposal=require('./tenant-cost-calendar-overlay.cjs'),rules=fs.readFileSync(path.join(runtime,'public/work-rules.js'),'utf8'),cost=fs.readFileSync(path.join(runtime,'public/cost-engine.js'),'utf8');assert.ok(proposal.exactCostResolver(rules,cost).includes('function localResolve('));assert.throws(()=>proposal.exactCostResolver(rules.replace('hour<=48','hour<=47'),cost),/DIGEST_CHANGED/);assert.throws(()=>proposal.exactCostResolver(rules.replace(proposal.timeOK,proposal.timeOK.replace('2[0-3]','2[0-4]')),cost),/VALIDATORS_CHANGED/);assert.throws(()=>proposal.exactCostResolver(rules,cost.replace(proposal.validDate,'const validDate=()=>true;')),/VALIDATORS_CHANGED/);assert.throws(()=>proposal.exactCostResolver(rules,cost.replace('HOUR=3600000','HOUR=7200000')),/HELPERS_CHANGED/);});

test('runtime Docker COPY supplies and resolves every relative composer import',()=>{
 const sourceRoot=path.join(__dirname,'..'),docker=fs.readFileSync(process.env.VECTOR_COST_TEST_DOCKERFILE||path.join(sourceRoot,'Dockerfile'),'utf8');
 const runAt=docker.indexOf('RUN node /workspace/scripts/compose-vector-local-runtime.mjs /app');assert.ok(runAt>0);
 const copyLines=docker.slice(docker.lastIndexOf('\nFROM ',runAt),runAt).split(/\r?\n/).filter(line=>/^COPY .* \/workspace\/scripts\/$/.test(line));assert.equal(copyLines.length,1,'Runtime composer COPY must be unique');
 const copied=copyLines[0].trim().split(/\s+/).slice(1,-1),layout=path.join(temporary,'docker-layout');fs.mkdirSync(layout);
 for(const file of copied)fs.copyFileSync(path.join(sourceRoot,file),path.join(layout,path.basename(file)));
 const composer=fs.readFileSync(path.join(layout,'compose-vector-local-runtime.mjs'),'utf8'),relativeImports=Array.from(composer.matchAll(/import\s+[^;]+?from\s+['"](\.[^'"]+)['"]/g),match=>match[1]);assert.ok(relativeImports.includes('./tenant-cost-calendar-overlay.cjs'));
 const imports=relativeImports.map((file,index)=>'import dependency'+index+' from '+JSON.stringify(file)+';').join('\n');
 fs.writeFileSync(path.join(layout,'check-imports.mjs'),imports+'\n');
 assert.doesNotThrow(()=>execFileSync(process.execPath,[path.join(layout,'check-imports.mjs')],{encoding:'utf8'}));
});

test('existing Docker composition gate executes both calendar regressions against its composed runtime',()=>{
 const docker=fs.readFileSync(process.env.VECTOR_COST_TEST_DOCKERFILE||path.join(__dirname,'..','Dockerfile'),'utf8');
 const commands=docker.split(/\r?\n/).filter(line=>line.includes('node --test scripts/compose-vector-local-runtime.contract.test.cjs'));assert.equal(commands.length,1,'Preserve the existing composition gate');
 const command=commands[0];for(const name of ['compose-vector-local-runtime.contract.test.cjs','workspace-compiler-composition.test.cjs','organisation-calendar-composition.test.cjs','tenant-cost-calendar-composition.test.cjs'])assert.ok(command.includes('scripts/'+name),'Missing composed gate regression: '+name);
 assert.ok(command.includes('verification/first-use-regressions-20261012/existing-output-compiler.test.cjs'));
 for(const key of ['VECTOR_ORG_TEST_RUNTIME','VECTOR_COST_TEST_RUNTIME'])assert.ok(command.includes(key+'=/proof/staffology-full-runtime'),'Regressions must reuse the precomposed proof runtime');
});
