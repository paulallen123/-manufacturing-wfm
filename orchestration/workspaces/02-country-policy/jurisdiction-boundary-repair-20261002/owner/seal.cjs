const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=__dirname,read=p=>fs.readFileSync(p),hash=b=>crypto.createHash('sha256').update(b).digest('hex'),blob=b=>crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+b.length+'\0'),b])).digest('hex');
const original=JSON.parse(read(path.join(root,'frozen-identities.json')).toString().replace(/^\uFEFF/,'')).evidence;
const targets=original.filter(x=>x.path.startsWith('policy/runtime/')&&x.sourceRef==='f32ca1a2672d47dcff8ef6cd1c3d71c77cf60560');
const changes=[],dependencies=[];
for(const item of targets){
 const baseline=read(path.resolve(root,'../lane02-jurisdiction/frozen',item.path));if(blob(baseline)!==item.sha)throw Error('Frozen identity mismatch '+item.path);
 const b=read(path.join(root,item.path)),identity={path:item.path,mode:item.mode,bytes:b.length,blob:blob(b),sha256:hash(b),local:item.path};
 if(identity.blob!==item.sha)changes.push({...identity,action:'MODIFY',preimageBlob:item.sha,preimageBytes:baseline.length,sourceRef:item.sourceRef,byteDelta:b.length-baseline.length});else dependencies.push({...identity,sourceRef:item.sourceRef,shipping:false});
}
if(changes.length!==8||changes.some(x=>x.path.includes('regulatory-change')))throw Error('Unexpected scope');
const helperPath='implementation/runtime/inert-finite-json.cjs',helper=read(path.join(root,helperPath));if(blob(helper)!=='e38b912c9746f69a0dd3c1c991c25f2bbf4d3261')throw Error('Helper mismatch');
dependencies.push({path:helperPath,blob:blob(helper),sha256:hash(helper),bytes:helper.length,mode:'100644',owner:'Lane01',shipping:false,requiresExistingCanonicalAdmission:true});
fs.writeFileSync(path.join(root,'changes-manifest.json'),JSON.stringify({capabilityId:'product-058',mode:'ISOLATED_FUTURE_EXISTING_OWNER_REPAIR',protectedCommit:'f32ca1a2672d47dcff8ef6cd1c3d71c77cf60560',protectedTree:'74aba749449f3f4cd68ee385b24637026ea90ec8',provenBaseSha:null,convergenceBaseSha:null,broadState:'IN_PROGRESS',componentState:'TESTED',testScope:'isolated source contract only; independent review pending',changes,dependencies,changedPathCount:changes.length,changedFileBytes:changes.reduce((n,x)=>n+x.bytes,0),netByteDelta:changes.reduce((n,x)=>n+x.byteDelta,0),rollback:'Restore each exact frozen preimage listed; if helper is canonical already do not delete/revert helper. No external state mutation performed.'},null,2));
const files=['DESIGN.md','baseline-lock.json','changes-manifest.json','frozen-identities.json','REVIEW_HANDOFF.md',...fs.readdirSync(path.join(root,'evidence')).map(f=>'evidence/'+f),...changes.map(x=>x.path),...dependencies.map(x=>x.path)];
const rows=files.map(local=>{const b=read(path.join(root,local));return{local,bytes:b.length,sha256:hash(b),gitBlob:blob(b)};});
for(const local of ['evidence/02-unchanged-source-held-outs.log','jurisdiction-boundaries.held-out.test.cjs']){const b=read(path.resolve(root,'../lane02-jurisdiction',local));rows.push({local:'../lane02-jurisdiction/'+local,bytes:b.length,sha256:hash(b),gitBlob:blob(b),shipping:false});}
fs.writeFileSync(path.join(root,'evidence-index.json'),JSON.stringify({artifacts:rows,execution:{node:'v22.23.2',networkGuard:'../trust_review/network-guard.cjs',originalHeldOut:{tests:8,pass:3,fail:5},firstOwnerRed:{tests:34,pass:22,fail:12},edgeRed:{tests:36,pass:34,fail:2},returnRed:{tests:40,pass:39,fail:1},final:{tests:40,pass:40,fail:0,skip:0}},scope:'Owner execution; not independent or hosted/customer proof'},null,2));
console.log(JSON.stringify({changes:changes.map(x=>({path:x.path,blob:x.blob,bytes:x.bytes})),dependencies,manifestSha256:hash(read(path.join(root,'changes-manifest.json'))),indexSha256:hash(read(path.join(root,'evidence-index.json')))},null,2));
