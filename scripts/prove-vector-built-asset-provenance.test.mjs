import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { proveVectorBuiltAssetProvenance } from './prove-vector-built-asset-provenance.mjs';
const marker='VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vector-source-binding-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repoRoot=path.join(root,'repo'),publicRoot=path.join(root,'public'),baseCssPath=path.join(root,'base.css');
 const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
 for(const [file,value] of Object.entries({'learning/ui/adaptive-coach.css':'ADAPT-CSS\n','implementation/ui/implementation-journey.css':'IMPL-CSS\n','ux-overlay/vector-shell.css':'VECTOR-CSS\n','ux-overlay/vector-workflows.css':'WORKFLOW-CSS\n','learning/ui/adaptive-coach.js':'ADAPT-JS();\n','implementation/ui/implementation-journey.js':'IMPL-JS();\n','ux-overlay/vector-shell.js':'VECTOR-JS();\n','ux-overlay/vector-workflows.js':'WORKFLOW-JS();\n'}))write(path.join(repoRoot,file),value);
 write(baseCssPath,'BASE-CSS\n');
 // Independent expected bytes reproduce the actual final Docker composition, not the checker.
 write(path.join(publicRoot,'vector-ui.css'),`/* ${marker} */\nBASE-CSS\n\n/* WFM_ADAPTIVE_COACH_BEGIN */\nADAPT-CSS\n\n/* WFM_IMPLEMENTATION_JOURNEY_VERSION_D_BEGIN */\nIMPL-CSS\n\n/* ${marker} */\nVECTOR-CSS\nWORKFLOW-CSS\n`);
 write(path.join(publicRoot,'vector-ui.js'),`'use strict';\n/* ${marker} */\n\n;/* WFM_ADAPTIVE_COACH_BEGIN */\nADAPT-JS();\n\n;/* WFM_IMPLEMENTATION_JOURNEY_VERSION_D_BEGIN */\nIMPL-JS();\n\n;/* ${marker} */\nVECTOR-JS();\n`);
 write(path.join(publicRoot,'vector-workflows.js'),'WORKFLOW-JS();\n');
 return {repoRoot,publicRoot,baseCssPath};
}
test('admits only all three exact presentation/controller assets from the candidate source',t=>{
 const proof=proveVectorBuiltAssetProvenance(fixture(t));
 for(const value of [proof.jsSha256,proof.cssSha256,proof.workflowsSha256])assert.match(value,/^[a-f0-9]{64}$/);
});
test('an approval marker cannot disguise arbitrary replacement JavaScript',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.publicRoot,'vector-ui.js'),`/* ${marker} */ window.unapproved=true;`);
 assert.throws(()=>proveVectorBuiltAssetProvenance(f),/PROVENANCE_MISMATCH:vector-ui\.js/);
});
test('a changed workflow controller cannot pass the UI provenance check',t=>{
 const f=fixture(t);fs.appendFileSync(path.join(f.publicRoot,'vector-workflows.js'),'mutate();');
 assert.throws(()=>proveVectorBuiltAssetProvenance(f),/PROVENANCE_MISMATCH:vector-workflows\.js/);
});
test('workflow styling is included in the source-bound final CSS bytes',t=>{
 const f=fixture(t);fs.appendFileSync(path.join(f.repoRoot,'ux-overlay/vector-workflows.css'),'unexpected{}');
 assert.throws(()=>proveVectorBuiltAssetProvenance(f),/PROVENANCE_MISMATCH:vector-ui\.css/);
});
