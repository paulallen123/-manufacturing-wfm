import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('missing runner configuration emits machine-readable BLOCKED, without exposing credentials',()=>{
 const secret='test-secret-must-never-appear-in-proof';
 const r=spawnSync(process.execPath,['security.mjs'],{cwd:import.meta.dirname,env:{PATH:process.env.PATH,TARGET_PASSWORD:secret},encoding:'utf8',timeout:5000});
 assert.notEqual(r.status,0);
 const line=r.stdout.split('\n').find(x=>x.startsWith('VECTOR_SECURITY_ASSERTIONS='));
 assert.ok(line,'runner must emit an explicit result even when setup fails');
 const p=JSON.parse(line.split('=',2)[1]);
 assert.equal(p.status,'BLOCKED');
 assert.equal(p.assertions.length,0);
 assert.ok(!r.stdout.includes(secret));
});
