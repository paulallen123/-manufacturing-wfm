'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=__dirname,owner=path.resolve(base,'../lane04-owner-repair');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const blob=b=>crypto.createHash('sha1').update(Buffer.from(`blob ${b.length}\0`)).update(b).digest('hex');
const manifestRaw=fs.readFileSync(path.join(owner,'manifest.json')),indexRaw=fs.readFileSync(path.join(owner,'evidence-index.json'));
if(hash(manifestRaw)!=='d234b5fd83a98a39aabfb13c2329cc988f5959adb279bdf4680ca20043bdb99c'||hash(indexRaw)!=='17d9a07d104094e9fda3a1db7187b81f5a986751c9e6f1820121812ba5b2ef38')throw Error('Assigned owner seal mismatch');
const m=JSON.parse(manifestRaw),input=JSON.parse(fs.readFileSync(path.join(owner,'frozen-inputs.json'),'utf8')),rows=[];
const snapshot=JSON.parse(fs.readFileSync(path.resolve(base,'../retry-publication-20261002/frozen-snapshot.json'),'utf8'));
const leaves=snapshot.entries.filter(x=>x.type==='blob'),byPath=new Map(leaves.map(x=>[x.path,x]));
function copy(p,b){const target=path.join(base,p);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,b);}
for(const x of [...m.shippingPaths,...m.unchangedFrozenDependencies]){
 const prior=fs.readFileSync(path.join(owner,'preimages',x.path)),b=fs.readFileSync(path.join(owner,x.path)),frozen=byPath.get(x.path),declared=input.files.find(y=>y.path===x.path);
 if(!frozen||frozen.sha!==x.preimageBlob||frozen.mode!==x.mode||blob(prior)!==x.preimageBlob||hash(prior)!==declared.sha256||blob(b)!==x.proposedBlob||hash(b)!==x.sha256)throw Error('Source identity mismatch: '+x.path);
 if(x.operation==='UNCHANGED_DEPENDENCY'&&!b.equals(prior))throw Error('Dependency differs');
 copy('source/'+x.path,b);copy('frozen/'+x.path,prior);rows.push({...x,preimageSha256:hash(prior)});
}
for(const x of JSON.parse(indexRaw).files){const b=fs.readFileSync(path.join(owner,x.path));if(b.length!==x.bytes||hash(b)!==x.sha256)throw Error('Owner evidence changed: '+x.path);copy('owner-evidence/'+x.path,b);}
copy('owner-evidence/evidence-index.json',indexRaw);
const guard=fs.readFileSync(path.resolve(base,'../trust_review/network-guard.cjs'));copy('network-guard.cjs',guard);
const identities={protectedCommit:m.protectedCommit,protectedTree:m.protectedTree,expectedProductOnlyTree:m.expectedProductOnlyTree,shippingPaths:m.shippingPaths.length,shippingBytes:m.shippingBytes,unchangedDependencies:m.unchangedFrozenDependencies.length,ownerManifestSha256:hash(manifestRaw),ownerIndexSha256:hash(indexRaw),networkGuardSha256:hash(guard),fullFrozenMetadataBlobCount:leaves.length,paths:rows,sourceAuthentication:false,customerProof:false,provenBaseSha:null,convergenceBaseSha:null};
copy('source-identities.json',Buffer.from(JSON.stringify(identities,null,2)+'\n'));
console.log(JSON.stringify({shippingPaths:identities.shippingPaths,shippingBytes:identities.shippingBytes,unchangedDependencies:identities.unchangedDependencies,ownerArtifactsVerified:JSON.parse(indexRaw).files.length,sourceIdentitySha256:hash(fs.readFileSync(path.join(base,'source-identities.json')))}));
