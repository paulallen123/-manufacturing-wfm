'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const factory=require('./blob1.cjs'),baseline=require('./blob0.cjs')();
for(const [name,money] of [['server',factory()],['serialized factory',vm.runInNewContext('('+factory.toString()+')()')]]){
 test(name+': array traversal accessors are never invoked',()=>{
  let reads=0;const factors=[1.05,1.2];
  for(const key of ['reduce','some',Symbol.iterator])Object.defineProperty(factors,key,{get(){reads++;throw Error('UNEXPECTED_TRAVERSAL');}});
  assert.equal(money.sum(factors),2.25);assert.equal(money.stack(factors,'highest'),1.2);assert.equal(money.stack(factors,'additive'),1.25);
  assert.equal(money.components({durationMs:3600000,rate:10,multipliers:factors,stacking:'additive',allowances:factors}).grossPence,1475);assert.equal(reads,0);
 });
 test(name+': dense boundary admits1000 and refuses1001 or own accessors without evaluation',()=>{
  assert.equal(money.sum(new Array(1000).fill(0)),0);assert.equal(money.stack(new Array(1000).fill(1),'highest'),1);
  assert.throws(()=>money.sum(new Array(1001).fill(0)));
  let reads=0;const arr=[2];Object.defineProperty(arr,'0',{get(){reads++;return 2;}});
  assert.throws(()=>money.factorKey([1],'highest',arr));assert.equal(reads,0);
 });
 test(name+':100 valid pricing vectors preserve baseline rational rounding and factor identities',()=>{
  for(let i=0;i<100;i++){
   const multipliers=[1+(i%5)/10,1+((i+2)%4)/10],allowances=[(i%7)/100,((i+3)%9)/100];
   const stacking=i%2?'highest':'additive';
   const input={durationMs:60000*(i+1),rate:8.03+(i%11)/100,multipliers,stacking,allowances,oncostPercent:12.5,oncostHourly:0.1};
   assert.deepEqual(JSON.parse(JSON.stringify(money.components(input))),baseline.components(input));
   assert.equal(money.factorKey(multipliers,stacking,allowances),baseline.factorKey(multipliers,stacking,allowances));
  }
 });
}
