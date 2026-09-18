import test from 'node:test';
import assert from 'node:assert/strict';
import { AttendanceClaimCertifier } from './attendance-certification.mjs';

function coverage({release=true,auto=100,rows=[{employee:'e1',status:'complete'}],payrollReady=true,unresolved=0,unexpected=0,unmapped=0,partial=[],uncovered=[]}={}){
  return {
    preflight(){return {releaseTargetMet:release,automaticCoveragePct:auto,partial,uncovered};},
    evaluateShift(){return {rows,totalScheduled:rows.length,payrollReady,unresolved,unexpectedCount:unexpected,unmappedSignalCount:unmapped};}
  };
}
const healthy=[{sourceId:'door',state:'healthy',pendingRecovery:false,periodCoverageComplete:true},{sourceId:'wifi',state:'healthy',pendingRecovery:false,periodCoverageComplete:true}];

test('full passive coverage + complete clocks + healthy reconciled sources certifies 100%',()=>{
  const c=new AttendanceClaimCertifier({coverage:coverage()});
  const r=c.certifyShift({tenant:'t',site:'s',shiftId:'x',expectedSourceIds:['door','wifi'],sourceHealth:healthy});
  assert.equal(r.claimLevel,'PASSIVE_AND_VERIFIED_100');
  assert.equal(r.metrics.automaticCapturePct,100); assert.equal(r.metrics.verifiedCompletenessPct,100); assert.ok(r.claim);
});

test('99.9% automatic can still certify verified completeness but never passive 100%',()=>{
  const c=new AttendanceClaimCertifier({coverage:coverage({release:false,auto:99.9,partial:['e2']})});
  const r=c.certifyShift({tenant:'t',site:'s',shiftId:'x',expectedSourceIds:['door','wifi'],sourceHealth:healthy});
  assert.equal(r.claimLevel,'VERIFIED_100_ONLY');
  assert.equal(r.certification.passivePeriodCertified,false);
  assert.match(r.claim,/Automatic capture rate must be stated separately/);
});

test('one missing OUT blocks any 100% claim',()=>{
  const c=new AttendanceClaimCertifier({coverage:coverage({rows:[{employee:'e1',status:'complete'},{employee:'e2',status:'missing_out'}],payrollReady:false,unresolved:1})});
  const r=c.certifyShift({tenant:'t',site:'s',shiftId:'x',expectedSourceIds:['door','wifi'],sourceHealth:healthy});
  assert.equal(r.claimLevel,'NOT_CERTIFIED'); assert.equal(r.claim,null); assert.equal(r.metrics.verifiedCompletenessPct,50);
});

test('source stream can look healthy now but historical gap blocks period certificate until reconciled',()=>{
  const c=new AttendanceClaimCertifier({coverage:coverage()});
  const r=c.certifyShift({tenant:'t',site:'s',shiftId:'x',expectedSourceIds:['door'],sourceHealth:[{sourceId:'door',state:'healthy',pendingRecovery:false,periodCoverageComplete:false}]});
  assert.equal(r.certification.sourceContinuityLive,true); assert.equal(r.certification.sourceContinuityPeriod,false); assert.equal(r.claimLevel,'PASSIVE_LIVE_100');
});

test('missing health evidence blocks certification',()=>{
  const c=new AttendanceClaimCertifier({coverage:coverage()});
  const r=c.certifyShift({tenant:'t',site:'s',shiftId:'x',expectedSourceIds:['door','wifi'],sourceHealth:[healthy[0]]});
  assert.equal(r.claimLevel,'NOT_CERTIFIED'); assert.equal(r.blockers.some(x=>x.code==='SOURCE_HEALTH_MISSING'),true);
});

test('unmapped person signal blocks claim even if scheduled clocks are complete',()=>{
  const c=new AttendanceClaimCertifier({coverage:coverage({unmapped:1,payrollReady:false})});
  const r=c.certifyShift({tenant:'t',site:'s',shiftId:'x',expectedSourceIds:['door','wifi'],sourceHealth:healthy});
  assert.equal(r.claimLevel,'NOT_CERTIFIED');
});
