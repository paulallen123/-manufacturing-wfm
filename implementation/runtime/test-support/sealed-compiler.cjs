'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
module.exports=function loadCompiler(t) {
  const archive=path.resolve(__dirname,'../../../artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz');
  // Docker's extracted compiler is already admitted by the pinned archive and patch.
  if(!fs.existsSync(archive)&&fs.existsSync('/app/lib/configuration-compiler.cjs'))return require('/app/lib/configuration-compiler.cjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-compiler-'));
  if(createHash('sha256').update(fs.readFileSync(archive)).digest('hex')!=='3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d') throw Error('Sealed compiler source mismatch.');
  execFileSync('tar',['-xzf',archive,'-C',dir,'lib/configuration-compiler.cjs','lib/autonomy-safety-kernel.cjs']);
  execFileSync(process.execPath,[path.resolve(__dirname,'../../../scripts/patch-workspace-compiler.mjs'),path.join(dir,'lib/configuration-compiler.cjs')]);
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return require(path.join(dir,'lib/configuration-compiler.cjs'));
};
