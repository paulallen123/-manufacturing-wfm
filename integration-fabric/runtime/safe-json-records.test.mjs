import test from 'node:test';
import assert from 'node:assert/strict';
import {extractJsonRecords} from './safe-json-records.mjs';

test('extracts bounded plain records from reviewed JSON path',()=>{
  const records=extractJsonRecords({
    data:{data:{workers:{nodes:[{id:'1',name:'Ada'},{id:'2',name:'Grace'}]}}},
    recordPath:['data','workers','nodes']
  });
  assert.deepEqual(records,[{id:'1',name:'Ada'},{id:'2',name:'Grace'}]);
});

test('unsafe record paths and prototype keys fail closed',()=>{
  assert.throws(()=>extractJsonRecords({
    data:{data:[]},recordPath:['__proto__']
  }),error=>error.code==='WFM_JSON_RECORDS_INVALID');

  const hostile=Object.create(null);
  Object.defineProperty(hostile,'__proto__',{value:{polluted:true},enumerable:true});
  assert.throws(()=>extractJsonRecords({
    data:{data:{items:[hostile]}},recordPath:['data','items']
  }),error=>error.code==='WFM_JSON_RECORDS_INVALID');
});

test('record and node limits are enforced',()=>{
  assert.throws(()=>extractJsonRecords({
    data:{items:[{id:'1'},{id:'2'}]},recordPath:['items'],maxRecords:1
  }),error=>error.code==='WFM_JSON_RECORDS_LIMIT');

  assert.throws(()=>extractJsonRecords({
    data:{items:[{a:{b:{c:1}}}]},recordPath:['items'],maxNodes:2
  }),error=>error.code==='WFM_JSON_RECORDS_LIMIT');
});

test('record path must resolve to an array of objects',()=>{
  assert.throws(()=>extractJsonRecords({
    data:{data:{worker:{id:'1'}}},recordPath:['data','worker']
  }),error=>error.code==='WFM_JSON_RECORDS_INVALID');

  assert.throws(()=>extractJsonRecords({
    data:{items:['not-an-object']},recordPath:['items']
  }),error=>error.code==='WFM_JSON_RECORDS_INVALID');
});
