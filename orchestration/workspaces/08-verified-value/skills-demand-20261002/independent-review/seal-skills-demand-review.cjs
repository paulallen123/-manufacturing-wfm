'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const files=['skills-demand-review.md','skills-demand-findings.json','skills-demand-identities.json','skills-demand.held-out.test.cjs','run-skills-demand-review.cjs','seal-skills-demand-review.cjs','skills-demand-held-out.corrected.node22.tap','skills-demand-held-out.node22.tap','skills-demand-held-out.node22.run.json','skills-demand.initial-fixture.test.cjs','skills-demand.initial-fixture.tap','skills-demand.initial-fixture.run.json','skills-demand-affected.node22.tap','skills-demand-affected.node22.run.json','network-guard.cjs'];
function add(file){const b=fs.readFileSync(file);return{path:path.relative(root,file).replaceAll('\\','/'),bytes:b.length,sha256:hash(b)};}
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else artifacts.push(add(p));}}
const artifacts=files.map(f=>add(path.join(__dirname,f)));walk(path.join(__dirname,'skills-demand-reviewed-source'));
for(const e of fs.readdirSync(__dirname,{withFileTypes:true}))if(e.isDirectory()&&e.name.startsWith('skills-demand-sqlite-'))walk(path.join(__dirname,e.name));
const index={runtimeBlob:'e4b556cf37460a4e24c1df3de6d1612f0f7738af',testBlob:'4db7407ae0e3349808b75cc474fb35cd64f44d05',reviewSealSha256:'e70c2fa43550bb0b23689a7d4ef6f78fb34005b0674c8208a90c3d7e79710f1e',artifacts};
fs.writeFileSync(path.join(__dirname,'skills-demand-evidence-index.json'),JSON.stringify(index,null,2)+'\n');
for(const name of ['skills-demand-review.md','skills-demand-findings.json','skills-demand-evidence-index.json'])console.log(JSON.stringify(add(path.join(__dirname,name))));
