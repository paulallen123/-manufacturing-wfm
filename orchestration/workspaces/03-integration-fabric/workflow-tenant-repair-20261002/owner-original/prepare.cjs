'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=__dirname,prior=path.resolve('work/inventory_edges/lane03-caller-continuation');
const paths=['.github/workflows/autonomous-integration-fabric.yml','integration/runtime/autonomous-integration-hub.cjs','integration/runtime/autonomous-integration-hub.test.cjs','integration/runtime/gusto-company-connector.cjs','integration/runtime/gusto-oauth-landing.cjs'];
for(const p of paths){const bytes=fs.readFileSync(path.join(prior,'frozen',p));for(const root of ['candidate','preimages']){const target=path.join(base,root,p);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);}}
fs.mkdirSync(path.join(base,'evidence'),{recursive:true});fs.mkdirSync(path.join(base,'provenance'),{recursive:true});
for(const p of ['source-manifest.json','inventory-seal.json','workflow-caller-control.test.cjs','evidence/04-frozen-workflow-tenant-caller-red.tap','evidence/04-frozen-workflow-tenant-caller-red.run.json']){const target=path.join(base,'provenance',p);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(prior,p),target);}
fs.copyFileSync(path.join(prior,'packed-runtime/server.cjs'),path.join(base,'provenance/packed-frozen-server.cjs'));
fs.copyFileSync('work/trust_review/network-guard.cjs',path.join(base,'network-guard.cjs'));
const blob=b=>crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
const snapshot=JSON.parse(fs.readFileSync('work/retry-publication-20261002/frozen-snapshot.json','utf8').replace(/^\uFEFF/,''));
fs.writeFileSync(path.join(base,'baseline-lock.json'),JSON.stringify({workBaselineSha:'f32ca1a2672d47dcff8ef6cd1c3d71c77cf60560',baselineTree:'74aba749449f3f4cd68ee385b24637026ea90ec8',provenBaseSha:null,convergenceBaseSha:null,runtimeWired:false,hostedTested:false,shippingPaths:2},null,2)+'\n');
fs.writeFileSync(path.join(base,'preimage-identities.json'),JSON.stringify(paths.map(p=>{const b=fs.readFileSync(path.join(base,'preimages',p));return{path:p,mode:'100644',gitBlob:blob(b),sha256:crypto.createHash('sha256').update(b).digest('hex'),bytes:b.length};}),null,2)+'\n');
console.log(JSON.stringify({preparedPaths:paths.length,snapshotType:Array.isArray(snapshot)?'array':Object.keys(snapshot),workflowPreimage:blob(fs.readFileSync(path.join(base,'preimages',paths[0])))}));
