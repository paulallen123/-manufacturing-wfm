'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base='work/lane07-cleanroom';
const src=JSON.parse(fs.readFileSync('work/inventory_edges/manufacturing-continuation/sources.json','utf8'));
const blob=b=>crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
const records=[];
for(const x of src.files.filter(x=>['frontier/controlled-environment-flow/controlled-environment-flow.mjs','frontier/controlled-environment-flow/intervention-transition-ledger.mjs','frontier/controlled-environment-flow/controlled-environment-validation.mjs','frontier/controlled-environment-flow/controlled-environment-safety.test.mjs'].includes(x.path))){const b=Buffer.from(x.data.content,'utf8');if(blob(b)!==x.blob)throw Error('source mismatch');const p=base+'/evidence/'+x.sourceSha+'/'+x.path;fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,b);records.push({sourceSha:x.sourceSha,path:x.path,blob:x.blob,mode:x.mode,evidencePath:p,bytes:b.length});}
for(const [name,expected] of [['decision-episode.cjs','a8a118ed8fc90a80272077213e1e6ad3956ac4c4'],['decision-episode.test.cjs','f75dd5bbc3d43fa1035d2718d8acc7b821abcc20']]){const p='operations/runtime/'+name,b=fs.readFileSync('work/src/'+p);if(blob(b)!==expected)throw Error('canonical mismatch '+name);const dest=base+'/source/'+p;fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,b);records.push({sourceSha:src.baselineSha,path:p,blob:expected,mode:'100644',snapshotPath:dest,bytes:b.length,shipping:false});}
fs.writeFileSync(base+'/dependency-manifest.json',JSON.stringify({workBaselineSha:src.baselineSha,provenBaseSha:null,convergenceBaseSha:null,records},null,2)+'\n');
console.log(JSON.stringify({verified:records.length,baseline:2}));
