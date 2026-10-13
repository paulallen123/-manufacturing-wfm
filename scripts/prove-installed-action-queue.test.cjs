'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {extractUniqueBytes,assertRuntimeBinding,assertCompleteTap}=require('./prove-installed-action-queue.cjs');
test('extracts actual unique bytes and rejects missing, changed or repeated source',()=>{
 const source=Buffer.from('shell\n'),built=Buffer.concat([Buffer.from('prefix\n'),source,Buffer.from('suffix')]);
 assert.deepEqual(extractUniqueBytes(built,source),source);
 for(const b of [Buffer.from('shelL\n'),Buffer.concat([source,source])])assert.throws(()=>extractUniqueBytes(b,source));
 for(const s of [Buffer.alloc(0),'shell',null])assert.throws(()=>extractUniqueBytes(built,s));
});
test('requires the exact supported runtime and valid matching source SHA',()=>{
 const sha='a'.repeat(40);assert.doesNotThrow(()=>assertRuntimeBinding('v22.23.2',sha,sha+'\n'));
 for(const args of [['v24.19.0',sha,sha],['v22.23.2',sha,'b'.repeat(40)],['v22.23.2','bad','bad'],['v22.23.2',sha,sha+'\nextra']])assert.throws(()=>assertRuntimeBinding(...args));
});
const summary=(v={})=>Object.entries({tests:49,pass:49,fail:0,cancelled:0,skipped:0,todo:0,...v}).map(([k,n])=>'# '+k+' '+n).join('\n');
test('only zero-failure zero-skip complete49 TAP is admitted',()=>{
 assert.doesNotThrow(()=>assertCompleteTap(summary(),0));
 for(const [k,n] of [['tests',48],['pass',48],['fail',1],['cancelled',1],['skipped',1],['todo',1]])assert.throws(()=>assertCompleteTap(summary({[k]:n}),0));
 assert.throws(()=>assertCompleteTap(summary(),1));assert.throws(()=>assertCompleteTap(summary(),null));
 assert.throws(()=>assertCompleteTap(summary()+'\n# tests 49',0));assert.throws(()=>assertCompleteTap(summary().replace('# skipped 0',''),0));
});
