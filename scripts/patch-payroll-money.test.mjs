import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { patchPayrollMoneySources } from './patch-payroll-money.mjs';
const require=createRequire(import.meta.url),money=require('../operations/runtime/payroll-money.cjs')();
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const archive=path.join(root,'artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz');
const originals=Object.fromEntries(['engine.js','cost-engine.js','work-rules.js','payroll-control.js'].map(name=>[name,execFileSync('tar',['-xOf',archive,'public/'+name],{encoding:'utf8',maxBuffer:2000000})]));
function modules(browser=false) {
  const fixed=process.env.VECTOR_PAYROLL_BASELINE==='1'?{cost:originals['cost-engine.js'],rules:originals['work-rules.js']}:patchPayrollMoneySources(originals['cost-engine.js'],originals['work-rules.js']);
  const sources={...originals,'cost-engine.js':fixed.cost,'work-rules.js':fixed.rules};
  const context=vm.createContext({console}),cache={};
  const load=name=>{name=name.replace(/^\.\//,'');if(cache[name])return cache[name];assert.ok(sources[name],name);const m={exports:{}};cache[name]=m.exports;vm.runInContext('(function(module,exports,require){'+sources[name]+'\n})',context,{filename:name})(m,m.exports,load);return cache[name]=m.exports;};
  if(browser){for(const name of Object.keys(originals))vm.runInContext(sources[name],context,{filename:name});return {C:context.WFMCost,R:context.WFMWorkRules,P:context.WFMPayroll};}
  return {C:load('cost-engine.js'),R:load('work-rules.js'),P:load('payroll-control.js')};
}
function fixture(rate,minutes,contract={}) {
  const start='2026-09-14T09:00:00.000Z',end=new Date(Date.parse(start)+minutes*60000).toISOString();
  const state={staff:[{id:'e1',name:'Synthetic payroll probe',payrollId:'SYNTH-001',manager:'s1',site:'Synthetic'}],profiles:{e1:{skills:[]}},
    workRules:{revision:1,contracts:{e1:[{id:'synthetic-contract',revision:1,effectiveFrom:'2026-09-01',type:'full_time',weeklyHours:40,fullTimeHours:40,overtimeBasis:'custom',overtimeAfter:168,overtimeMultiplier:1.5,secondAfter:null,dailyBasis:'calendar_day',dailyAfter:null,dailyMultiplier:1.5,nightMultiplier:1,weekendMultiplier:1,bankHolidayMultiplier:1,stacking:'highest',premiumNightStart:'23:00',premiumNightEnd:'06:00',jurisdiction:'GB-ENG',...contract}]},premiums:[],annualOpening:{}},
    costing:{employeePolicies:{},rates:{e1:[{effectiveFrom:'2026-09-01',hourlyRate:rate,currency:'GBP',basis:'hourly',oncostPercent:0,oncostHourly:0}]},policies:{Synthetic:[{version:'synthetic',effectiveFrom:'2026-09-01',weeklyTiers:[],dailyTiers:[],bankHolidayMultiplier:1,weekendMultiplier:1,nightMultiplier:1,stacking:'highest',region:'england-and-wales',warningPercent:90}]}}};
  const shift={id:'synthetic-observed-1',employee:'e1',start,end,breaks:[],kind:'approved-actual'};
  const period={id:'2026-09-14',start:'2026-09-14',end:'2026-09-20',expectedRoster:['e1'],teams:[{id:'s1',name:'Synthetic team',employees:['e1']}],reviews:{s1:{signature:{by:'synthetic-reviewer',at:'2026-09-21T10:00:00Z'}}},records:[{id:shift.id,employee:'e1',team:'s1',date:'2026-09-14',raw:{kind:'worked',clockIn:start,clockOut:end,breaks:[],breaksConfirmed:true,pendingSync:false,absenceMinutes:0}}]};
  return {state,shift,period};
}
// Independent oracle: rates are specified as integer ten-thousandths of a pound.
const independent=(rateUnits,minutes)=>Number((BigInt(rateUnits)*BigInt(minutes)+3000n)/6000n);
for(const browser of [false,true])for(const legacy of [false,true])test(`${browser?'browser':'server'} ${legacy?'legacy':'contract'} payroll preserves decimal half-penny rounding`,()=>{
  const {C,P}=modules(browser),{state,shift,period}=fixture(8.03,30);if(legacy)delete state.workRules;
  const calculated=C.priceShifts(state,'e1',[shift]);assert.equal(calculated.complete,true);assert.equal(calculated.grossPence,402);
  const lines=P.payrollLines(state,period);assert.equal(lines[0].grossPence,402);assert.equal(lines[0].gross,'4.02');
  assert.equal(P.reconcilePayroll(state,period,lines).ok,true);
  const tampered=lines.map(line=>({...line,grossPence:401}));assert.equal(P.reconcilePayroll(state,period,tampered).ok,false);
});
test('independent exact rate/minute matrix covers both real pricing paths',()=>{
  const {C}=modules();const rates=[80300,100000,101234,200100,159900,275050];
  for(const legacy of [false,true])for(const units of rates)for(const minutes of [1,3,6,15,30,60,75,90,450]){
    const {state,shift}=fixture(units/10000,minutes);if(legacy)delete state.workRules;
    const actual=C.priceShifts(state,'e1',[shift]);assert.equal(actual.complete,true);assert.equal(actual.grossPence,independent(units,minutes),JSON.stringify({legacy,units,minutes}));
  }
});
test('paid and unpaid breaks retain their observed durations and component rounding',()=>{
  const {C}=modules();for(const paid of [false,true]){
    const {state,shift}=fixture(8.03,90);shift.breaks=[{start:'2026-09-14T09:30:00Z',end:'2026-09-14T10:00:00Z',paid}];
    const result=C.priceShifts(state,'e1',[shift]);assert.equal(result.grossPence,paid?1205:804);assert.equal(result.hours,paid?1.5:1);
  }
});
test('effective rate changes at midnight use separately rounded original decimal rates',()=>{
  const {C}=modules();const {state,shift}=fixture(8.03,60);shift.start='2026-09-14T22:30:00Z';shift.end='2026-09-14T23:30:00Z';
  state.costing.rates.e1.push({...state.costing.rates.e1[0],effectiveFrom:'2026-09-15',hourlyRate:10.01});
  const result=C.priceShifts(state,'e1',[shift]);assert.equal(result.rows.length,2);assert.equal(result.grossPence,903);
});
test('overtime and allowance decimal factors preserve exact gross and allocated premiums',()=>{
  const {C}=modules();const {state,shift}=fixture(8.03,90,{dailyAfter:1,dailyMultiplier:1.5});
  state.workRules.premiums=[{id:'synthetic-window',name:'Synthetic allowance',trigger:'window',start:'00:00',end:'23:59',mode:'per_hour',amount:0.1,enabled:true,effectiveFrom:'2026-09-01'}];
  const result=C.priceShifts(state,'e1',[shift]);assert.equal(result.complete,true);assert.equal(result.grossPence,1420);assert.equal(result.overtimePremiumPence,201);
  assert.equal(result.basePence+result.overtimePremiumPence+result.otherPremiumPence,result.grossPence);
});
test('additive premium calculation and allowance sums use decimal operands',()=>{
  assert.equal(money.stack([1.1,1.2,1.35],'additive'),1.65);assert.equal(money.sum([0.1,0.2]),0.3);
  assert.equal(money.components({durationMs:1800000,rate:8.03,multiplier:1.65,otMultiplier:1.1,allowance:0.3}).grossPence,677);
});
for(const browser of [false,true])test(`${browser?'browser':'server'} contract keeps original long-decimal allowance operands until pence rounding`,()=>{
  const {C}=modules(browser),{state,shift}=fixture(8.03,30);
  state.workRules.premiums=[0.1234567890123456,0.17654321098765438].map((amount,i)=>({id:'synthetic-exact-'+i,name:'Synthetic allowance '+i,trigger:'window',start:'00:00',end:'23:59',mode:'per_hour',amount,enabled:true,effectiveFrom:'2026-09-01'}));
  // (8.03 + .1234567890123456 + .17654321098765438) / 2 = 4.16499999999999999.
  const result=C.priceShifts(state,'e1',[shift]);assert.equal(result.complete,true);assert.equal(result.grossPence,416);
  assert.doesNotThrow(()=>JSON.stringify(result));assert.equal(Object.keys(result.rows[0]).some(key=>key.startsWith('_money')),false);
});
test('exact additive factors stay unrounded when multiplied into gross pay',()=>{
  // 5 * (1.0000000000000002 + 1.1999999999999997 - 1) / 2 = 2.99999999999999975.
  // Add .01 per hour to put the true value just below the half-penny boundary.
  assert.equal(money.components({durationMs:1800000,rate:5,multipliers:[1.0000000000000002,1.1999999999999997],stacking:'additive',allowance:0.01}).grossPence,300);
});
test('equivalent allowance sums retain one continuous rounding component',()=>{
  const {C}=modules(),{state,shift}=fixture(8.03,60);
  state.workRules.premiums=[[0.1,0.2,'10:00','10:30'],[0.2,0.1,'10:30','11:00']].flatMap(([a,b,start,end],part)=>[a,b].map((amount,i)=>({id:'synthetic-window-'+part+'-'+i,name:'Allowance '+i,trigger:'window',start,end,mode:'per_hour',amount,enabled:true,effectiveFrom:'2026-09-01'})));
  const result=C.priceShifts(state,'e1',[shift]);assert.equal(result.complete,true);assert.equal(result.grossPence,833);assert.equal(result.rows.length,1);
});
test('oncosts use the rounded gross plus exact hourly allowance at the existing boundary',()=>{
  const result=money.components({durationMs:1800000,rate:8.03,oncostPercent:12.5,oncostHourly:0.1});
  assert.equal(result.grossPence,402);assert.equal(result.oncostPence,55);assert.equal(result.totalPence,457);
});
test('invalid and unsafe monetary values fail closed',()=>{
  for(const rate of [NaN,Infinity,-1,'8.03'])assert.throws(()=>money.components({durationMs:1800000,rate}));
  assert.throws(()=>money.components({durationMs:3600000,rate:Number.MAX_SAFE_INTEGER}));
  assert.throws(()=>money.stack([1,NaN],'additive'));assert.throws(()=>money.stack([1],'unknown'));
});
test('patching fails closed on source drift or duplicate application',()=>{
  assert.throws(()=>patchPayrollMoneySources(originals['cost-engine.js'].replace('const base=pence(','const changed=pence('),originals['work-rules.js']),/ANCHOR_CHANGED/);
  const fixed=patchPayrollMoneySources(originals['cost-engine.js'],originals['work-rules.js']);assert.throws(()=>patchPayrollMoneySources(fixed.cost,fixed.rules),/ALREADY_PATCHED/);
});
