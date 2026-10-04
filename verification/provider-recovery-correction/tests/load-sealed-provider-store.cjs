'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=process.env.VECTOR_SEALED_PROOF_ROOT||path.resolve(__dirname,'../../advisory/recovery-regression/sealed-recovery-proof');
const archive=path.join(root,'artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz');
const hash=b=>createHash('sha256').update(b).digest('hex');
if(hash(fs.readFileSync(archive))!=='3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d')throw Error('Original provider fixture archive digest changed');
const source=execFileSync('tar',['-xOf',archive,'lib/provider-job-store.cjs']);
if(hash(source)!=='1b36e5f9bc599741ab2cc8ef245ac3f5c8ac33e68aea46612cb31252965282a0')throw Error('Original provider fixture source digest changed');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'vector-sealed-store-'));
try{const file=path.join(temp,'provider-job-store.cjs');fs.writeFileSync(file,source);module.exports=require(file);}finally{fs.rmSync(temp,{recursive:true,force:true});}
