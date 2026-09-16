import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {WfmKioskHardening} from './wfm-kiosk-hardening.mjs';
const s=new WfmKioskHardening();
s.registerPerson({tenant:'t1',employee:'e1',sites:['tamworth']});
s.registerDevice({tenant:'t1',deviceId:'device-a',site:'tamworth'});
const BASE=Date.parse('2026-09-16T00:00:00Z'),N=20000;
const start=performance.now();
for(let i=1;i<=N;i++){
  const now=BASE+i*1000,c=s.issueChallenge({deviceId:'device-a',nowMs:now-1});
  const type=i%2?'in':'out';
  const out=s.syncBatch({deviceId:'device-a',events:[{eventId:`evt-${String(i).padStart(8,'0')}`,sequence:i,employee:'e1',type,capturedAt:new Date(now-100).toISOString(),challengeId:c.challengeId}],serverNowMs:now});
  assert.equal(out.results[0].status,'accepted');
  assert.equal(Date.parse(out.results[0].authoritativeAt),now);
}
const ms=performance.now()-start,p=s.getPersonal({tenant:'t1',employee:'e1'});
assert.equal(p.events.length,N);assert.equal(p.status,'out');
console.log(JSON.stringify({status:'PASS',events:N,durationMs:Number(ms.toFixed(2)),eventsPerSecond:Number((N/(ms/1000)).toFixed(1)),finalRevision:p.revision,finalStatus:p.status},null,2));
