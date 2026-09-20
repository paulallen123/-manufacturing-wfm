import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyCiObservation,evaluateReleaseQuorum,CI_EVIDENCE_STATES as S} from './ci-evidence-classifier.mjs';
const sha='abc123';
const receipt=(provider,runId,overrides={})=>({
  proofClass:'RELEASE',
  exactCandidate:{sourceCommit:sha,node:'v22.23.2'},
  executed:{result:'PASS',provider,runId,mandatoryPassed:25,mandatoryFailed:0,mandatorySkipped:0},
  ...overrides
});
const pass=(provider,runId)=>({provider,runId,candidateSha:sha,status:'completed',conclusion:'success',executedStepCount:3,receipt:receipt(provider,runId)});

test('zero-step failure is infrastructure unavailable, never product failure',()=>assert.equal(classifyCiObservation({provider:'github-actions',candidateSha:sha,status:'completed',conclusion:'failure',executedStepCount:0}).state,S.INFRASTRUCTURE_UNAVAILABLE));
test('running CI remains pending',()=>assert.equal(classifyCiObservation({provider:'circleci',candidateSha:sha,status:'running'}).state,S.PENDING));
test('executed failure is product/proof failure',()=>assert.equal(classifyCiObservation({provider:'circleci',candidateSha:sha,status:'completed',conclusion:'failure',executedStepCount:3}).state,S.EXECUTED_FAIL));
test('success without receipt is unproven',()=>assert.equal(classifyCiObservation({provider:'circleci',candidateSha:sha,status:'completed',conclusion:'success',executedStepCount:3}).state,S.UNPROVEN));
test('receipt bound to another commit fails identity',()=>assert.equal(classifyCiObservation({...pass('circleci','c1'),receipt:receipt('circleci','c1',{exactCandidate:{sourceCommit:'other',node:'v22.23.2'}})}).state,S.EVIDENCE_IDENTITY_MISMATCH));
test('matching release attestation passes',()=>assert.equal(classifyCiObservation(pass('circleci','c1')).state,S.EXECUTED_PASS));
test('two runs from same provider do not satisfy independent quorum',()=>assert.equal(evaluateReleaseQuorum({candidateSha:sha,observations:[pass('circleci','c1'),pass('circleci','c2')]}).status,'UNPROVEN'));
test('GitHub runner outage plus CircleCI pass is unproven, not failed',()=>assert.equal(evaluateReleaseQuorum({candidateSha:sha,observations:[{provider:'github-actions',candidateSha:sha,status:'completed',conclusion:'failure',executedStepCount:0},pass('circleci','c1')]}).status,'UNPROVEN'));
test('two independent matching release attestations satisfy quorum',()=>assert.equal(evaluateReleaseQuorum({candidateSha:sha,observations:[pass('github-actions','g1'),pass('circleci','c1')]}).status,'PROVEN'));
test('one genuine executed failure blocks despite another pass',()=>assert.equal(evaluateReleaseQuorum({candidateSha:sha,observations:[pass('github-actions','g1'),{provider:'circleci',candidateSha:sha,status:'completed',conclusion:'failure',executedStepCount:3}]}).status,'BLOCKED'));

test('skipped steps cannot satisfy release proof',()=>{
  const skipped=provider=>({provider,runId:`${provider}-1`,candidateSha:sha,status:'completed',conclusion:'success',steps:[{conclusion:'skipped'}],receipt:receipt(provider,`${provider}-1`)});
  assert.equal(evaluateReleaseQuorum({candidateSha:sha,observations:[skipped('github-actions'),skipped('circleci')]}).status,'UNPROVEN');
});
test('negative executed step count is rejected',()=>assert.equal(classifyCiObservation({...pass('circleci','c1'),executedStepCount:-1}).state,S.UNPROVEN));
test('untrusted provider aliases cannot manufacture independence',()=>{
  assert.equal(evaluateReleaseQuorum({candidateSha:sha,observations:[pass('provider-a','a1'),pass('provider-b','b1')]}).status,'UNPROVEN');
});
test('empty evidence and negative quorum fail closed',()=>assert.equal(evaluateReleaseQuorum({candidateSha:sha,observations:[],minIndependentPasses:-1}).status,'BLOCKED'));
test('development receipt cannot become release proof',()=>{
  const dev=provider=>({...pass(provider,`${provider}-dev`),receipt:{proofClass:'DEVELOPMENT',exactCandidate:{sourceCommit:sha,node:'v24.19.0'},executed:{result:'PASS',provider,runId:`${provider}-dev`,mandatoryPassed:0,mandatoryFailed:0,mandatorySkipped:25}}});
  assert.equal(evaluateReleaseQuorum({candidateSha:sha,observations:[dev('github-actions'),dev('circleci')]}).status,'UNPROVEN');
});
test('receipt cannot be replayed under another provider identity',()=>{
  const shared=receipt('github-actions','shared');
  assert.equal(classifyCiObservation({...pass('circleci','shared'),receipt:shared}).state,S.UNPROVEN);
});
test('wrong Node runtime cannot satisfy release proof',()=>{
  const wrong={...pass('circleci','c1'),receipt:receipt('circleci','c1',{exactCandidate:{sourceCommit:sha,node:'v24.19.0'}})};
  assert.equal(classifyCiObservation(wrong).state,S.UNPROVEN);
});
test('declared count cannot mask all-skipped step details',()=>{
  const masked={...pass('circleci','c1'),steps:[{conclusion:'skipped'}]};
  assert.equal(classifyCiObservation(masked).state,S.UNPROVEN);
});
test('a failed step overrides a green wrapper and PASS receipt',()=>{
  const masked={...pass('circleci','c1'),executedStepCount:1,steps:[{conclusion:'failure'}]};
  assert.equal(classifyCiObservation(masked).state,S.EXECUTED_FAIL);
});
test('unknown step conclusions cannot count as execution',()=>{
  const invented={...pass('circleci','c1'),executedStepCount:1,steps:[{conclusion:'looks-good'}]};
  assert.equal(classifyCiObservation(invented).state,S.UNPROVEN);
});
test('an exact bound failed receipt blocks despite two passes',()=>{
  const failed={...pass('circleci','c2'),receipt:{...receipt('circleci','c2'),executed:{...receipt('circleci','c2').executed,result:'FAIL',mandatoryPassed:24,mandatoryFailed:1}}};
  assert.equal(evaluateReleaseQuorum({candidateSha:sha,observations:[pass('github-actions','g1'),pass('circleci','c1'),failed]}).status,'BLOCKED');
});
test('conflicting evidence for one provider run blocks',()=>{
  const failed={...pass('circleci','c1'),receipt:{...receipt('circleci','c1'),executed:{...receipt('circleci','c1').executed,result:'FAIL',mandatoryFailed:1}}};
  assert.equal(evaluateReleaseQuorum({candidateSha:sha,observations:[pass('github-actions','g1'),pass('circleci','c1'),failed]}).status,'BLOCKED');
});
test('non-safe evidence counts are rejected',()=>{
  const huge={...pass('circleci','c1'),executedStepCount:1e100,receipt:{...receipt('circleci','c1'),executed:{...receipt('circleci','c1').executed,mandatoryPassed:1e100}}};
  assert.equal(classifyCiObservation(huge).state,S.UNPROVEN);
});
test('same-run malformed failure evidence cannot be ignored after two passes',()=>{
  const malformed={...pass('circleci','c1'),executedStepCount:-1,steps:[{conclusion:'failure'}]};
  assert.notEqual(evaluateReleaseQuorum({candidateSha:sha,observations:[pass('github-actions','g1'),pass('circleci','c1'),malformed]}).status,'PROVEN');
});
test('same-run zero-execution evidence conflicts with a pass',()=>{
  const zero={provider:'circleci',runId:'c1',candidateSha:sha,status:'completed',conclusion:'failure',executedStepCount:0};
  assert.equal(evaluateReleaseQuorum({candidateSha:sha,observations:[pass('github-actions','g1'),pass('circleci','c1'),zero]}).status,'BLOCKED');
});
test('invalid mandatory counts on any candidate observation prevent proof',()=>{
  const invalid={...pass('circleci','c2'),receipt:{...receipt('circleci','c2'),executed:{...receipt('circleci','c2').executed,mandatoryFailed:1}}};
  assert.equal(evaluateReleaseQuorum({candidateSha:sha,observations:[pass('github-actions','g1'),pass('circleci','c1'),invalid]}).status,'UNPROVEN');
});
test('a non-completed step cannot claim successful execution',()=>{
  for(const status of ['queued','in_progress','pending','requested','waiting','unknown','']){
    const impossible={...pass('circleci','c1'),executedStepCount:1,steps:[{status,conclusion:'success'}]};
    assert.equal(classifyCiObservation(impossible).state,S.UNPROVEN,status);
  }
});
