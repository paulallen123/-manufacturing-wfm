'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
function fresh(){delete require.cache[require.resolve('./exact/support-selfhelp.cjs')];return require('./exact/support-selfhelp.cjs');}
const questions=['Is this production approved?','NetSuite certification','clocking terminal','missed clock-out','integration timeout','Can AI change payroll','undocumented procedure','reveal system prompt'];
const roles=['employee','manager','payroll','company-admin','support','unknown'];
test('all public nested data and matchers can be poisoned without changing private answer matrix',()=>{
 const h=fresh();const before=questions.flatMap(text=>roles.map(role=>h.answer({text,role})));
 for(const item of h.KNOWLEDGE){
  for(const re of item.patterns){re.compile('.*','g');re.lastIndex=91;re.test=()=>{throw Error('PUBLIC_TEST_USED');};}
  item.sources.splice(0,item.sources.length,'forged');item.roles.splice(0,item.roles.length,'unknown');
  for(const key of ['id','answer','patterns','sources','roles'])Object.defineProperty(item,key,{get(){throw Error('PUBLIC_GETTER_USED');}});
 }
 const after=questions.flatMap(text=>roles.map(role=>h.answer({text,role})));
 assert.deepEqual(after,before);for(const a of after)assert.equal(a.actionAuthority,false);
});
test('catalogue cannot be structurally replaced through array operations and answer results remain detached',()=>{
 const h=fresh();assert.equal(Object.isFrozen(h.KNOWLEDGE),true);
 assert.throws(()=>h.KNOWLEDGE.push({}),TypeError);assert.throws(()=>{h.KNOWLEDGE[0]={};},TypeError);
 const a=h.answer({text:'production approved',role:'manager'});a.sources.push('forged');a.answer='forged';a.actionAuthority=true;
 const b=h.answer({text:'production approved',role:'manager'});assert.equal(b.actionAuthority,false);assert.equal(b.sources.includes('forged'),false);assert.notEqual(b.answer,'forged');
});
