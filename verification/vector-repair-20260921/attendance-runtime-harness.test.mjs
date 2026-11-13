import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createAttendanceRuntime} from './attendance-runtime-harness.mjs';

function fixture(t,body) {
  const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'attendance-harness-fixture-'));
  fs.mkdirSync(path.join(runtime,'security-runtime'));
  fs.writeFileSync(path.join(runtime,'security-runtime/bootstrap.cjs'),body);
  t.after(()=>fs.rmSync(runtime,{recursive:true,force:true}));
  return runtime;
}
const healthyRuntime="const http=require('node:http');const s=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({pid:process.pid,database:process.env.WFM_DB}));});s.listen(Number(process.env.PORT),'127.0.0.1');process.on('SIGTERM',()=>{s.close(()=>process.exit(0));s.closeAllConnections();});";
// These are fixture budgets, not customer/runtime readiness policy. Include cold
// child-process startup so the negative cases actually exercise an HTTP response.
const fixtureStartupBudgetMs=10000;
const negativeStartupBudgetMs=5000;

test('owns its listener even when the former fixed port serves a healthy foreign process',async t=>{
  const foreign=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({pid:'foreign-process'}));});
  await new Promise((resolve,reject)=>{
    foreign.once('error',error=>error.code==='EADDRINUSE'?resolve():reject(error));
    foreign.listen(43822,'127.0.0.1',resolve);
  });
  t.after(()=>foreign.listening?new Promise(resolve=>{foreign.close(resolve);foreign.closeAllConnections();}):undefined);
  const runtime=fixture(t,healthyRuntime);
  const database=path.join(runtime,'state.sqlite');
  const harness=createAttendanceRuntime({runtime,database,startupBudgetMs:fixtureStartupBudgetMs});
  t.after(()=>harness.stop());
  await harness.start();
  const first=await (await fetch(harness.origin+'/api/health')).json();
  assert.equal(first.pid,harness.pid,'Readiness and requests must reach the child started by this test.');
  assert.equal(first.database,database);
  assert.notEqual(new URL(harness.origin).port,'43822');
  await harness.stop();
  await harness.start();
  const second=await (await fetch(harness.origin+'/api/health')).json();
  assert.equal(second.pid,harness.pid);
  assert.notEqual(second.pid,first.pid);
  assert.equal(second.database,database,'Restart must preserve the same test database path.');
});

test('bounds a stalled health request and preserves startup diagnostics',async t=>{
  const runtime=fixture(t,"const http=require('node:http');console.error('fixture-health-stalled');const s=http.createServer(()=>{});s.listen(Number(process.env.PORT),'127.0.0.1');process.on('SIGTERM',()=>{s.close(()=>process.exit(0));s.closeAllConnections();});");
  const harness=createAttendanceRuntime({runtime,database:path.join(runtime,'state.sqlite'),startupBudgetMs:negativeStartupBudgetMs});
  t.after(()=>harness.stop());
  const started=Date.now();
  await assert.rejects(harness.start(),error=>{
    assert.match(error.message,/fixture-health-stalled/);
    assert.match(error.message,/phase=waiting-health; lastHealthStatus=none/);
    return true;
  });
  assert.ok(Date.now()-started<negativeStartupBudgetMs+3000,'Startup must obey its deadline even when HTTP never returns.');
});

test('cleans up a child that exits by signal without waiting for a second exit event',async t=>{
  const runtime=fixture(t,healthyRuntime);
  const harness=createAttendanceRuntime({runtime,database:path.join(runtime,'state.sqlite'),startupBudgetMs:fixtureStartupBudgetMs});
  t.after(()=>harness.stop());
  await harness.start();
  process.kill(harness.pid,'SIGKILL');
  await new Promise(resolve=>setTimeout(resolve,30));
  const started=Date.now();
  await harness.stop();
  assert.ok(Date.now()-started<1000,'A signal-exited child must already count as stopped.');
});

test('startup timeout distinguishes a child that never opens its owned listener',async t=>{
  const runtime=fixture(t,"setInterval(()=>{},1000);");
  const harness=createAttendanceRuntime({runtime,database:path.join(runtime,'state.sqlite'),startupBudgetMs:500});
  t.after(()=>harness.stop());
  await assert.rejects(harness.start(),/phase=waiting-listener; lastHealthStatus=none/);
});

test('startup timeout reports persistent unhealthy responses without accepting the listener as readiness',async t=>{
  const runtime=fixture(t,"const http=require('node:http');const s=http.createServer((req,res)=>{res.statusCode=503;res.end('not ready');});s.listen(Number(process.env.PORT),'127.0.0.1');process.on('SIGTERM',()=>{s.close(()=>process.exit(0));s.closeAllConnections();});");
  const harness=createAttendanceRuntime({runtime,database:path.join(runtime,'state.sqlite'),startupBudgetMs:negativeStartupBudgetMs});
  t.after(()=>harness.stop());
  await assert.rejects(harness.start(),/phase=waiting-health; lastHealthStatus=503/);
});
