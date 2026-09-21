import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
const composer = path.join(path.dirname(fileURLToPath(import.meta.url)), 'compose-vector-presentation.mjs');
const retired = ['factory-control-ui.js','factory-control-ui.css','value-cockpit-ui.js','value-cockpit-ui.css','review-ui.js','review-ui.css','ui-evolution.css','vector-shell.js'];
function fixture(t) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-vector-composition-'));
 t.after(() => fs.rmSync(root, { recursive:true, force:true }));
 fs.writeFileSync(path.join(root, 'index.html'), '<html><head><link rel="stylesheet" href="/factory-control-ui.css"></head><body><script src="/factory-control-ui.js"></script><script src="/payroll-intelligence-ui.js"></script></body></html>');
 for(const f of retired) fs.writeFileSync(path.join(root,f), 'retired');
 for(const f of ['vector-ui.js','vector-ui.css']) fs.writeFileSync(path.join(root,f), '/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */');
 fs.writeFileSync(path.join(root,'vector-workflows.js'), '/* existing authoritative controller */');
 return root;
}
const run = root => spawnSync(process.execPath, [composer, root], {encoding:'utf8'});
test('one presentation remains, with the workflow controller still before payroll consumers', t => {
 const root=fixture(t), result=run(root); assert.equal(result.status,0,result.stderr);
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 for(const f of retired) {assert.equal(html.includes(f),false,f+' remains referenced');assert.equal(fs.existsSync(path.join(root,f)),false,f+' remains addressable');}
 assert.ok(html.indexOf('/vector-workflows.js')<html.indexOf('/payroll-intelligence-ui.js'));
 assert.equal((html.match(/src="\/vector-workflows\.js"/g)||[]).length,1);
 assert.equal(run(root).status,0,'composition remains idempotent');
});
test('an absent canonical approval marker fails closed', t => {
 const root=fixture(t); fs.writeFileSync(path.join(root,'vector-ui.js'),'unapproved'); const r=run(root);
 assert.notEqual(r.status,0); assert.match(r.stderr,/VECTOR_CANONICAL_MARKER_MISSING/);
});
test('missing authoritative workflows are never excused by presentation repair', t => {
 const root=fixture(t);fs.unlinkSync(path.join(root,'vector-workflows.js'));const r=run(root);
 assert.notEqual(r.status,0);assert.match(r.stderr,/VECTOR_WORKFLOW_CONTROLLER_MISSING/);
});
