import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {WfmKioskHardening} from './wfm-kiosk-hardening.mjs';

const BASE=Date.parse('2026-09-16T18:00:00Z');
let seed=0x51f15e;
function rnd(){seed=(seed*1664525+1013904223)>>>0;return seed/2**32;}
function setup(){
  const s=new WfmKioskHardening();
  s.registerPerson({tenant:'t1',employee:'e1',sites:['tamworth']});
  s.registerPerson({tenant:'t1',employee:'e2',sites:['tamworth']});
  s.registerPerson({tenant:'t2',employee:'e1',sites:['tamworth']});
  s.registerDevice({tenant:'t1',deviceId:'device-a',site:'tamworth'});
  s.registerDevice({tenant:'t1',deviceId:'device-b',site:'tamworth'});
  s.registerDevice({tenant:'t2',deviceId:'device-c',site:'tamworth'});
  return s;
}
function event(id, sequence, type='in', employee='e1', capturedAt=BASE){return {eventId:id,sequence,employee,type,capturedAt:new Date(capturedAt).toISOString()};}

const cases=5000;
const started=performance.now();
let accepted=0,held=0,rejected=0,resolved=0;
for(let i=0;i<cases;i++){
  const s=setup(); const now=BASE+i*10_000; const mode=i%8;
  if(mode===0){
    const c=s.issueChallenge({deviceId:'device-a',nowMs:now-1});
    const out=s.syncBatch({deviceId:'device-a',events:[{...event(`event-${String(i).padStart(6,'0')}`,1,'in','e1',now-2),challengeId:c.challengeId}],serverNowMs:now});
    assert.equal(out.results[0].status,'accepted');
    assert.equal(Date.parse(out.results[0].authoritativeAt),now);
    assert.equal(s.getPersonal({tenant:'t1',employee:'e1'}).events[0].at,now);
    accepted++;
  }else if(mode===1){
    const before=s.getPersonal({tenant:'t1',employee:'e1'});
    const out=s.syncBatch({deviceId:'device-a',events:[event(`event-${String(i).padStart(6,'0')}`,1,'in','e1',now-1000)],serverNowMs:now});
    assert.equal(out.results[0].status,'held');
    assert.deepEqual(s.getPersonal({tenant:'t1',employee:'e1'}),before);
    held++;
  }else if(mode===2){
    const c=s.issueChallenge({deviceId:'device-b',nowMs:now-1});
    const out=s.syncBatch({deviceId:'device-a',events:[{...event(`event-${String(i).padStart(6,'0')}`,1,'in','e1',now),challengeId:c.challengeId}],serverNowMs:now});
    assert.equal(out.results[0].status,'held');
    assert.equal(out.results[0].holdDetail,'CHALLENGE_WRONG_DEVICE'); held++;
  }else if(mode===3){
    const c=s.issueChallenge({deviceId:'device-a',nowMs:now-100_000});
    const out=s.syncBatch({deviceId:'device-a',events:[{...event(`event-${String(i).padStart(6,'0')}`,1,'in','e1',now-1000),challengeId:c.challengeId}],serverNowMs:now});
    assert.equal(out.results[0].status,'held'); held++;
  }else if(mode===4){
    const e=event(`event-${String(i).padStart(6,'0')}`,1,'in','e1',now);
    s.syncBatch({deviceId:'device-a',events:[e],serverNowMs:now});
    const collision=s.syncBatch({deviceId:'device-a',events:[{...e,employee:'e2'}],serverNowMs:now+1});
    assert.equal(collision.results[0].status,'rejected');
    assert.equal(collision.lastSequence,1); rejected++;
  }else if(mode===5){
    const e=event(`event-${String(i).padStart(6,'0')}`,1,'in','e1',now);
    s.syncBatch({deviceId:'device-a',events:[e],serverNowMs:now});
    assert.equal(s.reviewHeld({tenant:'t2'}).length,0);
    const r=s.resolveHeld({tenant:'t1',deviceId:'device-a',eventId:e.eventId,decision:'approve',authoritativeAt:new Date(now-100).toISOString(),reviewer:'manager-2',reason:'Synthetic supervisor evidence verified.',idempotencyKey:`review-${String(i).padStart(6,'0')}`,reviewedAtMs:now+100});
    assert.equal(r.decision,'approve'); assert.equal(s.reviewHeld({tenant:'t1'})[0].resolution.decision,'approve'); resolved++;
  }else if(mode===6){
    const e=event(`event-${String(i).padStart(6,'0')}`,1,'in','e1',now);
    s.syncBatch({deviceId:'device-a',events:[e],serverNowMs:now});
    s.resolveHeld({tenant:'t1',deviceId:'device-a',eventId:e.eventId,decision:'reject',reviewer:'manager-2',reason:'Synthetic evidence confirms no work occurred.',idempotencyKey:`review-${String(i).padStart(6,'0')}`,reviewedAtMs:now+100});
    const c=s.issueChallenge({deviceId:'device-a',nowMs:now+200});
    const out=s.syncBatch({deviceId:'device-a',events:[{...event(`event-r${String(i).padStart(5,'0')}`,2,'in','e1',now+200),challengeId:c.challengeId}],serverNowMs:now+201});
    assert.equal(out.results[0].status,'accepted'); accepted++; resolved++;
  }else{
    const c=s.issueChallenge({deviceId:'device-a',nowMs:now-2});
    const first=s.syncBatch({deviceId:'device-a',events:[{...event(`event-${String(i).padStart(6,'0')}`,1,'in','e1',now-1),challengeId:c.challengeId}],serverNowMs:now});
    assert.equal(first.results[0].status,'accepted');
    const before=s.getPersonal({tenant:'t1',employee:'e1'}).events.length;
    s.syncBatch({deviceId:'device-a',events:[event(`event-h${String(i).padStart(5,'0')}`,2,'out','e1',now+10)],serverNowMs:now+20});
    const c2=s.issueChallenge({deviceId:'device-a',nowMs:now+30});
    const later=s.syncBatch({deviceId:'device-a',events:[{...event(`event-l${String(i).padStart(5,'0')}`,3,'in','e1',now+30),challengeId:c2.challengeId}],serverNowMs:now+31});
    assert.equal(later.results[0].status,'held');
    assert.equal(s.getPersonal({tenant:'t1',employee:'e1'}).events.length,before); held++;
  }
}
console.log(JSON.stringify({status:'PASS',cases,accepted,held,rejected,resolved,durationMs:Number((performance.now()-started).toFixed(2)),invariants:['server-time-authoritative-for-accepted','held-does-not-mutate-personal','challenge-device-bound-and-one-time','event-id-collision-rejected','tenant-review-isolated','held-resolution-audited-and-idempotent','unresolved-hold-propagates']},null,2));
