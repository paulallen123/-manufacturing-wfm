import test from 'node:test';
import assert from 'node:assert/strict';
import {AccessFeedSupervisor} from './access-feed-supervisor.mjs';

const T=Date.parse('2026-09-18T06:00:00Z');
function setup(opts={}){
  const s=new AccessFeedSupervisor({heartbeatSlaMs:10_000,lagWarningMs:2_000,authRefreshLeadMs:60_000,...opts});
  s.register({tenant:'acme',sourceId:'doors',provider:'kisi',site:'s1',nowMs:T});
  return s;
}

test('quiet site remains healthy from connector heartbeat without door traffic',()=>{
  const s=setup();
  s.heartbeat({tenant:'acme',sourceId:'doors',atMs:T+1000});
  const h=s.status({tenant:'acme',sourceId:'doors',nowMs:T+9000});
  assert.equal(h.state,'healthy');
});

test('stale heartbeat requests reconnect automatically',()=>{
  const s=setup();
  s.heartbeat({tenant:'acme',sourceId:'doors',atMs:T});
  const h=s.status({tenant:'acme',sourceId:'doors',nowMs:T+10_001});
  assert.equal(h.state,'stale');
  assert.equal(h.action,'reconnect');
});

test('sequence gap creates a backfill job',()=>{
  const s=setup(); s.heartbeat({tenant:'acme',sourceId:'doors',atMs:T});
  s.event({tenant:'acme',sourceId:'doors',providerEventId:'e1',observedAt:new Date(T+100).toISOString(),receivedAtMs:T+150,sequence:10});
  s.event({tenant:'acme',sourceId:'doors',providerEventId:'e2',observedAt:new Date(T+200).toISOString(),receivedAtMs:T+250,sequence:12});
  const jobs=s.pendingRecovery({tenant:'acme',sourceId:'doors'});
  assert.equal(jobs.length,1);
  assert.equal(jobs[0].reason,'SEQUENCE_GAP');
  assert.equal(jobs[0].expected,11);
  assert.equal(jobs[0].received,12);
});

test('duplicate provider events are counted but not treated as new traffic',()=>{
  const s=setup();
  const event={tenant:'acme',sourceId:'doors',providerEventId:'e1',observedAt:new Date(T).toISOString(),receivedAtMs:T+100,sequence:1};
  assert.equal(s.event(event).status,'recorded');
  assert.equal(s.event(event).status,'duplicate');
  assert.equal(s.status({tenant:'acme',sourceId:'doors',nowMs:T+100}).duplicates,1);
});

test('reconnect always queues reconciliation when provider supports backfill',()=>{
  const s=setup();
  s.event({tenant:'acme',sourceId:'doors',providerEventId:'e1',observedAt:new Date(T).toISOString(),receivedAtMs:T+100,sequence:1});
  const r=s.reconnected({tenant:'acme',sourceId:'doors',atMs:T+5000});
  assert.equal(r.backfillQueued,true);
  assert.equal(s.pendingRecovery({tenant:'acme',sourceId:'doors'}).length,1);
});

test('auth refresh is requested before expiry rather than waiting for failure',()=>{
  const s=setup(); s.heartbeat({tenant:'acme',sourceId:'doors',atMs:T});
  s.auth({tenant:'acme',sourceId:'doors',expiresAtMs:T+50_000});
  const h=s.status({tenant:'acme',sourceId:'doors',nowMs:T+1});
  assert.equal(h.state,'auth_refresh_due');
  assert.equal(h.action,'refresh_auth');
});

test('late event marks feed degraded and asks for reconciliation',()=>{
  const s=setup(); s.heartbeat({tenant:'acme',sourceId:'doors',atMs:T+5000});
  s.event({tenant:'acme',sourceId:'doors',providerEventId:'late1',observedAt:new Date(T).toISOString(),receivedAtMs:T+5000,sequence:1});
  const h=s.status({tenant:'acme',sourceId:'doors',nowMs:T+5000});
  assert.equal(h.state,'degraded');
  assert.equal(h.action,'backfill');
});
