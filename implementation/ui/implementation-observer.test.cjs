'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/implementation-journey.js','utf8');
test('repeated implementation observer delivery settles without rewriting an unchanged navigation label',()=>{
 const start=source.indexOf('function apply(){'),end=source.indexOf("document.addEventListener('submit'",start);
 let label='Employee onboarding',writes=0,queued=1;
 const nav={get textContent(){return label;},set textContent(v){label=v;writes++;queued++;}};
 const content={dataset:{wfmImplementationJourney:'version-d-3'}};
 const context={currentPage:()=> 'onboarding',isEmployeeRole:()=>false,stop(){},VERSION:'version-d-3',S:{loading:false,timer:1},schedule(){},renderView(){throw Error('unexpected render');},load(){throw Error('unexpected implementation work');},document:{querySelector:s=>s==='.content'?content:nav}};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 for(let i=0;i<20&&queued;i++){queued--;context.apply();}
 assert.equal(queued,0,'observer must become idle');assert.equal(writes,1,'only an actual label change may mutate DOM');assert.equal(label,'Implementation');
});


test('implementation integrations separate current readiness from discovery and history',()=>{
 assert.match(source,/function nonCurrentIntegrationRows\(/);
 assert.match(source,/Discovery & historical systems/);
 assert.match(source,/do not count toward current launch readiness/);
 assert.match(source,/Mandatory provider journey remains unproved/);
});
