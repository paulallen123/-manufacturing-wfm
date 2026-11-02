'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),test=require('node:test'),assert=require('node:assert/strict');
const helper=path.join(__dirname,'vector-reporting-lifecycle.test.cjs');
const source=process.env.V079_UI||path.join(__dirname,'vector-reporting-ui.js');
// Reuse only the already accepted DOM collaborator, independently specifying cases and oracles.
const text=fs.readFileSync(helper,'utf8').split('\nconst os=require')[0].replace("path.join(__dirname,'vector-reporting-ui.js')",'SOURCE');
const box={require,module:{exports:{}},SOURCE:source,__dirname:path.dirname(helper)};
vm.runInNewContext(text+'\nmodule.exports=fixture;',box);const fixture=box.module.exports;
const response=body=>({ok:true,status:200,json:async()=>body});
async function setup(filters,{empty=false,hold=false}={}){
 const calls=[];let release;const wait=new Promise(r=>release=r);
 const definition={sourceId:'payroll-control',columns:['team'],filters};
 const x=fixture(1280,null,async(url)=>{
  calls.push(url);
  if(url==='/api/reporting/reports/private'){if(hold)await wait;return response({report:{id:'private',definition}});}
  if(url==='/api/payroll-run')return response({rows:empty?[]:[{team:'FictionalAlpha',period:'2026-11'},{team:'FictionalBeta',period:'2026-10'}]});
  return null;
 });await x.api.open();return {x,calls,release};
}
async function assertRejected(filters,options){
 const {x,calls}=await setup(filters,options);await x.click('[data-report-saved-id="private"]');
 const run=x.nodes.get('[data-report-run]');if(run)await x.click('[data-report-run]');
 assert.equal(calls.filter(u=>u==='/api/payroll-run').length,0,'unsupported saved definition must be rejected before source request');
 const exportButton=x.nodes.get('[data-report-export]');assert.ok(!exportButton||exportButton.disabled,'rejected report has no exportable rows');
 assert.ok(!x.markup().includes('FictionalAlpha'),'rejected rows never appear');
 assert.match(x.notifications.join(' ')+' '+x.markup(),/unsupported|cannot|could not|unavailable|not supported|invalid/i,'visible refusal');
}
for(const operator of ['in','not_in','between','is_empty','not_empty','future_operator'])test('saved '+operator+' refuses before run/export',()=>assertRejected([{field:'team',operator,value:'FictionalAlpha'}]));
for(const [name,filters] of [['unknown field',[{field:'unapproved',operator:'eq',value:'x'}]],['null entry',[null]],['string entry',['team']],['object collection',{field:'team',operator:'eq',value:'x'}],['string collection','team'],['missing operator',[{field:'team',value:'x'}]]])test('saved invalid '+name+' refuses',()=>assertRejected(filters));
test('unsupported filter rejected even when source would be empty',()=>assertRejected([{field:'team',operator:'in',value:'FictionalAlpha'}],{empty:true}));
test('supported eq saved filter remains usable',async()=>{const {x,calls}=await setup([{field:'team',operator:'eq',value:'FictionalAlpha'}]);await x.click('[data-report-saved-id="private"]');await x.click('[data-report-run]');assert.equal(calls.filter(u=>u==='/api/payroll-run').length,1);assert.match(x.markup(),/FictionalAlpha/);assert.doesNotMatch(x.markup(),/FictionalBeta/);assert.equal(x.nodes.get('[data-report-export]').disabled,false);});
test('late rejected saved selection cannot replace a newer template',async()=>{const {x,calls,release}=await setup([{field:'team',operator:'in',value:'x'}],{hold:true});const pending=x.click('[data-report-saved-id="private"]');await Promise.resolve();await x.click('[data-report-template="payroll"]');release();await pending;await x.click('[data-report-run]');assert.equal(calls.filter(u=>u==='/api/payroll-run').length,1);assert.match(x.markup(),/FictionalBeta/);assert.equal(x.nodes.get('[data-report-export]').disabled,false);});
test('non-list object filter value refuses before source access',()=>assertRejected([{field:'team',operator:'eq',value:{value:'FictionalAlpha'}}]));
for(const filters of [undefined,null])test('legacy absent/null filter collection remains runnable '+String(filters),async()=>{const {x,calls}=await setup(filters);await x.click('[data-report-saved-id="private"]');await x.click('[data-report-run]');assert.equal(calls.filter(u=>u==='/api/payroll-run').length,1);assert.match(x.markup(),/FictionalBeta/);});
for(const status of [401,403])test('current source '+status+' retains catalog refresh and row clearing',async()=>{
 let deny=false;const calls=[];
 const x=fixture(1280,null,async(url)=>{calls.push(url);if(url==='/api/payroll-run')return deny?{ok:false,status,json:async()=>({error:'Fictional denied source'})}:response({rows:[{team:'FictionalAlpha'}]});return null;});
 await x.api.open();await x.click('[data-report-template="payroll"]');await x.click('[data-report-run]');assert.match(x.markup(),/FictionalAlpha/);
 const catalogs=calls.filter(u=>u.endsWith('/catalog')).length;deny=true;x.failRefresh(status);await x.click('[data-report-run]');
 assert.equal(calls.filter(u=>u.endsWith('/catalog')).length,catalogs+1);assert.doesNotMatch(x.markup(),/FictionalAlpha/);assert.equal(x.nodes.get('[data-report-export]'),null);
});
test('old source response cannot repopulate a rejected saved selection',async()=>{
 let resolveSource,started;const sourceStarted=new Promise(r=>started=r),sourceResponse=new Promise(r=>resolveSource=r);
 const x=fixture(1280,null,async(url)=>{
  if(url==='/api/payroll-run'){started();return sourceResponse;}
  if(url==='/api/reporting/reports/private')return response({report:{id:'private',definition:{sourceId:'payroll-control',columns:['team'],filters:[{field:'team',operator:'not_in',value:['x']}]}}});return null;
 });await x.api.open();await x.click('[data-report-template="payroll"]');const pending=x.click('[data-report-run]');await sourceStarted;
 await x.click('[data-report-saved-id="private"]');resolveSource(response({rows:[{team:'FictionalObsolete'}]}));await pending;
 assert.doesNotMatch(x.markup(),/FictionalObsolete/);const main=x.nodes.get('[data-report-main]');assert.match(main.textContent,/cannot|unavailable/i);
 for(const action of ['run','export','print','save','pin','schedule'])assert.equal(main.querySelector('[data-report-'+action+']'),null,'rejected panel removes '+action);
});
function refusedPanel(x){const main=x.nodes.get('[data-report-main]');assert.match(main.textContent,/cannot|unavailable/i);assert.doesNotMatch(main.textContent,/FictionalPreviouslyVisible/);for(const action of ['run','save','pin','schedule','export','print'])assert.equal(main.querySelector('[data-report-'+action+']'),null,'refusal removes '+action);}
test('populated valid saved report is fully cleared by unsupported saved selection',async()=>{
 let choose=0;const x=fixture(1280,null,async(url)=>{
 if(url==='/api/reporting/reports/private')return response({report:{id:'private',definition:{sourceId:'payroll-control',columns:['team'],filters:++choose===1?[]:[{field:'team',operator:'between',value:['a','z']}]}}});
 if(url==='/api/payroll-run')return response({rows:[{team:'FictionalPreviouslyVisible'}]});return null;});
 await x.api.open();await x.click('[data-report-saved-id="private"]');await x.click('[data-report-run]');assert.match(x.markup(),/FictionalPreviouslyVisible/);assert.equal(x.nodes.get('[data-report-export]').disabled,false);
 await x.click('[data-report-saved-id="private"]');refusedPanel(x);
});
for(const action of ['save','pin','schedule'])test('unsupported selection fences in-flight '+action+' automatic save completion',async()=>{
 let began,release;const started=new Promise(r=>began=r),completion=new Promise(r=>release=r),posts=[];
 const x=fixture(1280,null,async(url,options)=>{
 if(options?.method==='POST'){posts.push(url);if(url==='/api/reporting/reports'){const sent=JSON.parse(options.body);began();await completion;return response({report:{id:'created-earlier',definition:sent.definition}});}return response({});}
 if(url==='/api/reporting/reports/private')return response({report:{id:'private',definition:{sourceId:'payroll-control',columns:['team'],filters:[{field:'team',operator:'is_empty',value:null}]}}});return null;});
 await x.api.open();await x.click('[data-report-template="payroll"]');if(action==='schedule')await x.click('[data-report-schedule]');
 const pending=x.click(action==='schedule'?'[data-report-schedule-confirm]':'[data-report-'+action+']');await started;
 await x.click('[data-report-saved-id="private"]');release();await pending;refusedPanel(x);
 assert.deepEqual(posts,['/api/reporting/reports'],'earlier save must not trigger pin or schedule');
 assert.match(x.notifications.join(' '),/earlier.*version.*created/i,'successful earlier creation is disclosed');assert.doesNotMatch(x.notifications.join(' '),/Report saved as an immutable/);
});
test('refusal preserves pending save exclusion across a subsequent template',async()=>{
 let began,release;const started=new Promise(r=>began=r),completion=new Promise(r=>release=r);let creates=0;
 const x=fixture(1280,null,async(url,options)=>{
 if(url==='/api/reporting/reports'&&options?.method==='POST'){creates++;const sent=JSON.parse(options.body);if(creates===1){began();await completion;}return response({report:{id:'created-'+creates,definition:sent.definition}});}
 if(url==='/api/reporting/reports/private')return response({report:{id:'private',definition:{sourceId:'payroll-control',columns:['team'],filters:[{field:'team',operator:'not_empty',value:null}]}}});return null;});
 await x.api.open();await x.click('[data-report-template="payroll"]');const earlier=x.click('[data-report-save]');await started;
 await x.click('[data-report-saved-id="private"]');await x.click('[data-report-template="payroll"]');await x.click('[data-report-save]');
 release();await earlier;assert.equal(creates,1,'refusal must not unlock a second save while first is pending');
 await x.click('[data-report-save]');assert.equal(creates,2,'save unlocks after first settles');
});
