'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateTrainingQuality}=require('./training-quality-gate.cjs');

test('polished media alone cannot pass the learning quality gate',()=>{
  const out=evaluateTrainingQuality({
    module:{artifactFingerprint:'x',artifactPublishable:true,exposureOnly:true,evidencePolicy:'NO_MASTERY_FROM_DELIVERY'},
    media:{captionsAvailable:true,transcriptAvailable:true,narrationState:'READY',privacySafe:true,secretSafe:true},
    voice:{state:'READY'},
    authoring:{state:'APPROVED',retrievalItems:0,independentTask:false,explanatoryFeedback:false}
  });
  assert.equal(out.publishable,false);
  assert.ok(out.blockers.includes('retrievalPractice'));
});
test('fully grounded, accessible, narrated training can become publishable',()=>{
  const out=evaluateTrainingQuality({
    module:{artifactFingerprint:'x',artifactPublishable:true,exposureOnly:true,evidencePolicy:'NO_MASTERY_FROM_DELIVERY'},
    media:{captionsAvailable:true,transcriptAvailable:true,narrationState:'READY',privacySafe:true,secretSafe:true},
    voice:{state:'READY'},
    authoring:{state:'APPROVED',retrievalItems:2,independentTask:true,explanatoryFeedback:true},
    tutor:{enabled:true,groundedRate:.995,directAnswerLeakRate:.01,escalationAccuracy:.98}
  });
  assert.equal(out.state,'PUBLISHABLE');
});
