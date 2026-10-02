'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const original=path.resolve('work/lane03-workflow-tenant'),base=__dirname;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const seal=JSON.parse(fs.readFileSync(path.join(original,'review-seal.json'),'utf8'));
for(const r of seal.files){const b=fs.readFileSync(path.join(original,r.path));if(b.length!==r.bytes||hash(b)!==r.sha256)throw Error('Original changed');}
function copyTree(from,to){fs.mkdirSync(to,{recursive:true});for(const e of fs.readdirSync(from,{withFileTypes:true})){const a=path.join(from,e.name),b=path.join(to,e.name);if(e.isDirectory())copyTree(a,b);else fs.copyFileSync(a,b);}}
for(const name of ['candidate','preimages'])copyTree(path.join(original,name),path.join(base,name));
for(const name of ['network-guard.cjs','run.cjs','baseline-lock.json'])fs.copyFileSync(path.join(original,name),path.join(base,name));
fs.mkdirSync(path.join(base,'evidence'),{recursive:true});fs.mkdirSync(path.join(base,'provenance'),{recursive:true});
for(const p of ['review-seal.json','source-manifest.json','REVIEW_HANDOFF.md'])fs.copyFileSync(path.join(original,p),path.join(base,'provenance/original-owner-'+p));
for(const p of ['.github/workflows/autonomous-integration-fabric.yml','.github/workflows/autonomous-integration-fabric.test.cjs']){const target=path.join(base,'reviewed-preimages',p);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(original,'candidate',p),target);}
for(const p of ['workflow-tenant-url.red-direct.tap','workflow-tenant-url.red.test.cjs','workflow-tenant-url.red-seal.json'])fs.copyFileSync(path.join('work/trust_review',p),path.join(base,'provenance',p));
console.log(JSON.stringify({originalArtifactsUnchanged:seal.files.length,priorWorkflowBlob:seal.shipping[0].gitBlob,priorTestBlob:seal.shipping[1].gitBlob}));
