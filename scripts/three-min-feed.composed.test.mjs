import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createAttendanceRuntime} from '../verification/vector-repair-20260921/attendance-runtime-harness.mjs';

test('composed 3Min intake loads through security middleware and retains scoped receipts across restart', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-3min-composed-'));
  const runtime = path.join(dir, 'runtime');
  const root = path.resolve(import.meta.dirname, '..');
  const token = 'synthetic-composed-feed-secret-'.repeat(3);
  const binding = {id:'composed-people',tenant:'northstar-demo',site:'test-site',source:'synthetic',domain:'people',environment:'sandbox',endpointSlug:'synthetic-workforce-intake',secretEnv:'WFM_3MIN_COMPOSED_TOKEN'};
  const previous = Object.fromEntries(['WFM_3MIN_FEEDS_JSON','WFM_3MIN_COMPOSED_TOKEN'].map(key => [key,process.env[key]]));
  process.env.WFM_3MIN_FEEDS_JSON = JSON.stringify([binding]);
  process.env.WFM_3MIN_COMPOSED_TOKEN = token;
  const database = path.join(dir, 'state.sqlite');
  const harness = createAttendanceRuntime({runtime,database});
  let db;
  t.after(async () => {
    await harness.stop(); db?.close();
    for (const [key,value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});
  });
  execFileSync(process.execPath,[path.join(root,'scripts/compose-vector-local-runtime.mjs'),runtime],{cwd:root,stdio:'pipe'});
  assert.ok(fs.existsSync(path.join(runtime,'integration-runtime/three-min-feed.cjs')),'runtime assembly must include the receiver');
  let origin = await harness.start();
  const ui = await fetch(origin+'/vector-ui.js');
  assert.equal(ui.status,200);
  assert.ok((await ui.text()).includes(fs.readFileSync(path.join(root,'ux-overlay/vector-shell.js'),'utf8')),'served presentation must include the exact reviewed receipt UI source');
  const route = '/api/integrations/autonomous/feeds/3min';
  const body = {schemaVersion:'vector-feed-v1',tenant:binding.tenant,site:binding.site,source:binding.source,domain:binding.domain,environment:binding.environment,eventId:'composed-event',occurredAt:new Date().toISOString(),records:[{employeeId:'synthetic-only'}]};
  const delivery = randomUUID();
  const notification = {id:delivery,operation:'create',status:'success',endpoint_slug:binding.endpointSlug,payload:body,processed_at:new Date().toISOString()};
  async function send(overrides = {}) {
    const response = await fetch(origin+route+'/'+binding.id,{method:'POST',headers:{'content-type':'application/json','x-vector-feed-token':token,'x-3minapi-record-id':delivery,...overrides},body:JSON.stringify(notification)});
    return {status:response.status,body:await response.json()};
  }
  assert.equal((await fetch(origin+route)).status,401,'receipt inspection requires a real session');
  assert.equal((await send({'x-vector-feed-token':'wrong'})).status,401);
  const accepted = await send();
  assert.equal(accepted.status,202); assert.equal(accepted.body.status,'RECEIVED_UNVALIDATED');
  assert.equal(accepted.body.sourceAuthenticated,false); assert.equal(accepted.body.executionAuthority,false);
  const login = await fetch(origin+'/api/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'superuser@northstar.example',password:'Factory-local-demo-2026!'})});
  assert.equal(login.status,200); await login.body.cancel();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  async function receipts() {
    const response = await fetch(origin+route,{headers:{origin,cookie}});
    return {status:response.status,body:await response.json()};
  }
  const read = await receipts(); assert.equal(read.status,200);
  assert.equal(read.body.receipts.length,1); assert.equal(read.body.receipts[0].receiptId,accepted.body.receiptId);
  assert.equal(JSON.stringify(read.body).includes('synthetic-only'),false);
  assert.equal(JSON.stringify(read.body).includes(token),false);
  await harness.stop(); origin = await harness.start();
  const replay = await send(); assert.equal(replay.status,200); assert.equal(replay.body.receiptId,accepted.body.receiptId);
  db = new DatabaseSync(database);
  assert.equal(db.prepare('SELECT count(*) n FROM integration_canonical_people').get().n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM integration_feed_inbox').get().n,1);
  db.prepare('INSERT INTO tenants(id,version,state) VALUES(?,?,?)').run('foreign-test-tenant',1,'{}');
  db.prepare('UPDATE users SET tenant=? WHERE email=?').run('foreign-test-tenant','superuser@northstar.example');
  const foreign = await receipts();
  if (foreign.status === 200) assert.deepEqual(foreign.body.receipts,[],'tenant change cannot expose previous tenant receipts');
  else assert.ok([401,403,409].includes(foreign.status),'tenant change must fail closed');
});
