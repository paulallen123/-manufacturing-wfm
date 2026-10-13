'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync,mkdtempSync,writeFileSync,rmSync}=require('node:fs');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const {createHash}=require('node:crypto');
const {validateExpectedEngineBlob,assertEngineBlob,loadVerifiedEngine}=require('./cloud-scale-proof-identity.cjs');

test('scale proof requires an explicit well-formed selected engine blob',()=>{
  assert.throws(()=>validateExpectedEngineBlob(undefined),/explicit WFM_CONFIG_ENGINE_GIT_BLOB_SHA/);
  assert.throws(()=>validateExpectedEngineBlob(''),/explicit WFM_CONFIG_ENGINE_GIT_BLOB_SHA/);
  for(const value of ['not-a-git-blob','A'.repeat(40),'0'.repeat(39)])
    assert.throws(()=>validateExpectedEngineBlob(value),/40 lowercase hexadecimal/);
});

test('real canonical engine bytes match their exact Git blob; wrong bytes refuse',()=>{
  const bytes=readFileSync(join(__dirname,'../runtime/configuration-inference-engine.cjs'));
  const blob=createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
  assert.match(blob,/^[a-f0-9]{40}$/);
  assert.equal(assertEngineBlob(bytes,blob),blob);
  assert.throws(()=>assertEngineBlob(Buffer.concat([bytes,Buffer.from('\n')]),blob),/identity mismatch/);
  assert.throws(()=>assertEngineBlob(bytes,'0'.repeat(40)),/identity mismatch/);
});

test('engine execution uses the verified snapshot even when the path changes after reading',()=>{
  const dir=mkdtempSync(join(tmpdir(),'vector-scale-verified-'));
  try{
    const filename=join(dir,'engine.cjs');
    writeFileSync(filename,'module.exports={value:"verified"};\n');
    const bytes=readFileSync(filename);
    const blob=createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
    writeFileSync(filename,'module.exports={value:"replaced"};\n');
    assert.equal(loadVerifiedEngine(bytes,filename,blob).exports.value,'verified');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
