'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),lane=path.join(root,'work/lane05-skills-demand');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const blob=b=>crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
const sealBytes=fs.readFileSync(path.join(lane,'review-seal.json')),seal=JSON.parse(sealBytes);
if(hash(sealBytes)!=='e70c2fa43550bb0b23689a7d4ef6f78fb34005b0674c8208a90c3d7e79710f1e')throw Error('review seal mismatch');
const verification=seal.files.map(f=>{const b=fs.readFileSync(path.join(root,f.path));if(hash(b)!==f.sha256||b.length!==f.bytes||blob(b)!==f.blob)throw Error('artifact mismatch '+f.path);return{...f,verified:true};});
const shipping=JSON.parse(fs.readFileSync(path.join(lane,'shipping-manifest.json')));
const snapshots=[];
for(const f of [...shipping.files,...shipping.verificationOnlyDependencies,...shipping.requiredProposalDependencies]){const local=f.localPath?path.join(root,f.localPath):path.join(lane,f.path);const b=fs.readFileSync(local),actualBlob=blob(b);if(actualBlob!==(f.proposedBlob||f.blob)||hash(b)!==f.sha256||b.length!==f.bytes)throw Error('source mismatch '+local);const target=path.join(__dirname,'skills-demand-reviewed-source',f.repositoryTargetPath||f.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,b);snapshots.push({path:f.repositoryTargetPath||f.path,blob:actualBlob,sha256:hash(b),bytes:b.length,declaredMode:f.mode||null,snapshot:target});}
fs.writeFileSync(path.join(__dirname,'skills-demand-identities.json'),JSON.stringify({reviewSeal:hash(sealBytes),verifiedArtifacts:verification,snapshots},null,2)+'\n');
function run(name,args,cwd=root){const started=new Date().toISOString();const r=spawnSync(path.join(root,'work/tools/node22/node.exe'),['--require',path.join(__dirname,'network-guard.cjs'),'--test',...args],{cwd,encoding:'utf8',timeout:60000,maxBuffer:4000000});fs.writeFileSync(path.join(__dirname,name+'.tap'),r.stdout+(r.stderr?'\nSTDERR\n'+r.stderr:''));const metadata={node:process.version,startedAt:started,finishedAt:new Date().toISOString(),args,status:r.status,signal:r.signal,error:r.error?String(r.error):null,timeoutMs:60000,networkGuard:true};fs.writeFileSync(path.join(__dirname,name+'.run.json'),JSON.stringify(metadata,null,2)+'\n');console.log(JSON.stringify(metadata));console.log((r.stdout||'').split('\n').filter(l=>/^# (tests|pass|fail|skipped|duration_ms)/.test(l)||/^not ok/.test(l)).join('\n'));}
run('skills-demand-held-out.node22',[path.join(__dirname,'skills-demand.held-out.test.cjs')]);
run('skills-demand-affected.node22',[path.join(lane,'learning/runtime/skills-demand-intelligence.test.cjs'),path.join(lane,'learning/runtime/adaptive-learning-engine.test.cjs'),path.join(lane,'learning/runtime/training-twin.test.cjs')]);
