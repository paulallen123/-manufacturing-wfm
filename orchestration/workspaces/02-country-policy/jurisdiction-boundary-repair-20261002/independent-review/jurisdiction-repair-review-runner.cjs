'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../lane02-jurisdiction-repair'),original=path.resolve(root,'../lane02-jurisdiction');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),blob=b=>crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+b.length+'\0'),b])).digest('hex');
const m=JSON.parse(fs.readFileSync(path.join(root,'changes-manifest.json'))),index=JSON.parse(fs.readFileSync(path.join(root,'evidence-index.json'))),frozen=JSON.parse(fs.readFileSync(path.join(root,'frozen-identities.json')));
const checks=[];
function verify(label,file,expected){const b=fs.readFileSync(file),a={label,file,bytes:b.length,sha256:sha(b),blob:blob(b),expected};a.verified=(expected.bytes===undefined||expected.bytes===a.bytes)&&(expected.sha256===undefined||expected.sha256===a.sha256)&&((expected.blob||expected.gitBlob||expected.sha)===undefined||(expected.blob||expected.gitBlob||expected.sha)===a.blob);checks.push(a);if(!a.verified)throw Error('IDENTITY_MISMATCH '+file);return a;}
for(const row of m.changes)verify('shipping',path.join(root,row.local),row);
for(const row of m.dependencies)verify('dependency',path.join(root,row.local||row.path),row);
for(const row of index.artifacts)verify('indexed-evidence',path.resolve(root,row.local),row);
for(const row of frozen.evidence)verify('frozen-or-historical',path.join(original,row.local),row);
const snapshot=path.join(__dirname,'jurisdiction-repair-source-snapshot');fs.mkdirSync(snapshot,{recursive:true});for(const row of [...m.changes,...m.dependencies]){const target=path.join(snapshot,row.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,row.local||row.path),target);}
fs.writeFileSync(path.join(__dirname,'jurisdiction-repair-identities.json'),JSON.stringify({schema:'INDEPENDENT_BOUNDED_SOURCE_REVIEW',sourceRef:m.protectedCommit,protectedTree:m.protectedTree,manifestSha256:sha(fs.readFileSync(path.join(root,'changes-manifest.json'))),evidenceIndexSha256:sha(fs.readFileSync(path.join(root,'evidence-index.json'))),shippingCount:m.changes.length,dependencyCount:m.dependencies.length,checks,allVerified:true},null,2)+'\n');
const guard=path.join(__dirname,'network-guard.cjs');
for(const [label,files] of [['heldouts',[path.join(__dirname,'jurisdiction-repair-heldouts.cjs')]],['affected',fs.readdirSync(path.join(root,'policy/runtime')).filter(x=>x.endsWith('.test.cjs')).map(x=>path.join(root,'policy/runtime',x))]]){
 const args=['--require',guard,'--test',...files],start=new Date().toISOString(),r=spawnSync(process.execPath,args,{encoding:'utf8',timeout:60000}),end=new Date().toISOString();
 const raw=r.stdout+r.stderr,log=path.join(__dirname,'jurisdiction-repair-'+label+'.tap');fs.writeFileSync(log,raw);
 const numbers=Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo','duration_ms'].map(k=>[k,Number(raw.match(new RegExp('^# '+k+' ([0-9.]+)','m'))?.[1])||0]));
 fs.writeFileSync(path.join(__dirname,'jurisdiction-repair-'+label+'.receipt.json'),JSON.stringify({node:process.version,exe:process.execPath,args,start,end,exit:r.status,error:r.error?.message||null,logSha256:sha(Buffer.from(raw)),...numbers,scope:'isolated local synthetic source contract; no legal/source authenticity/customer/provider or hosted proof'},null,2)+'\n');
 process.stdout.write(JSON.stringify({label,exit:r.status,...numbers})+'\n');
 if(r.status!==0)process.exitCode=1;
}
for(const row of [...m.changes,...m.dependencies])verify('post-test-unchanged',path.join(root,row.local||row.path),row);
fs.writeFileSync(path.join(__dirname,'jurisdiction-repair-post-identities.json'),JSON.stringify({allVerified:true,checks:checks.filter(x=>x.label==='post-test-unchanged')},null,2)+'\n');
