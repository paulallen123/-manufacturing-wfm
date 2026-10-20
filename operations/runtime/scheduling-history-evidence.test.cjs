'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normaliseWorker}=require('./manufacturing-scheduling-engine.cjs');
const {assertSchedulingHistoryEvidence}=require('./scheduling-history-evidence.cjs');

const worker={id:'w1',consecutiveShifts:6,consecutiveNights:2};

test('rejects unknown shift history that the scheduler currently treats as zero',()=>{
  assert.equal(normaliseWorker({...worker,consecutiveShifts:'unknown'}).consecutiveShifts,0);
  assert.throws(()=>assertSchedulingHistoryEvidence([{...worker,consecutiveShifts:'unknown'}]),/consecutiveShifts/);
});

test('requires explicit whole and bounded consecutive shift and night counts',()=>{
  for(const field of ['consecutiveShifts','consecutiveNights'])
    for(const value of [undefined,null,'6',true,NaN,Infinity,-1,1.5,101])
      assert.throws(()=>assertSchedulingHistoryEvidence([{...worker,[field]:value}]),new RegExp(field));
});

test('rejects more consecutive nights than shifts without altering the source record',()=>{
  assert.throws(()=>assertSchedulingHistoryEvidence([{...worker,consecutiveNights:7}]),/consecutiveNights/);
  const source=Object.freeze({...worker});
  assert.doesNotThrow(()=>assertSchedulingHistoryEvidence([source]));
  assert.equal(source.consecutiveShifts,6);
});

test('rejects active worker records and incomplete arrays',()=>{
  assert.throws(()=>assertSchedulingHistoryEvidence([new Proxy(worker,{})]),/worker/);
  assert.throws(()=>assertSchedulingHistoryEvidence(new Array(1)),/worker/);
});
