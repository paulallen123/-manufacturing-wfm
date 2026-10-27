'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/blob2.txt','utf8');
function render(summary,mask=7,prestart=false,learning){
 const context=vm.createContext({});vm.runInContext(source.slice(source.indexOf('const IMPL='),source.indexOf('function errorMarkup()')),context);
 context.input={learningSummary:summary,requirements:['role-learning','privileged-competency','frontline-readiness'].map((key,i)=>({key,satisfied:Boolean(mask&(1<<i))}))};context.learning=learning;context.prestart=prestart;
 return vm.runInContext('S.status=input; S.learning=learning; ({stage:stageMarkup(),panel:trainingPanel(prestart)})',context);
}
const complete=html=>/<b>Training<\/b><small>Complete<\/small>/.test(html);
test('512 population/combined/control permutations require exact true in both distinct backend gates',()=>{
 const values=[undefined,null,false,true,0,1,'true','false'];let count=0;
 for(const pop of values)for(const combined of values)for(let mask=0;mask<8;mask++){
  const view=render({roleLearningPopulationReady:pop,populationAndRoleCoverageReady:combined,masteryPercent:100},mask);
  const expected=pop===true&&combined===true&&mask===7;
  assert.equal(complete(view.stage),expected);assert.equal(/Team ready/.test(view.panel),expected);
  if(!expected)assert.match(view.panel,pop===true?/Training readiness evidence incomplete/:/Population coverage incomplete/);
  count++;
 }
 assert.equal(count,512);
});
test('prestart cannot claim Team ready even with both gates and all controls',()=>{
 const view=render({roleLearningPopulationReady:true,populationAndRoleCoverageReady:true},7,true);assert.doesNotMatch(view.panel,/Team ready/);
});
test('empty current summary cannot borrow a stale completed learning object',()=>{
 const view=render({},7,false,{roleLearningPopulationReady:true,populationAndRoleCoverageReady:true});assert.equal(complete(view.stage),false);assert.doesNotMatch(view.panel,/Team ready/);assert.match(view.panel,/Population coverage incomplete/);
});
