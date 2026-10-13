'use strict';
const {createHash}=require('node:crypto');
const Module=require('node:module');
const path=require('node:path');

function validateExpectedEngineBlob(expected){
  if(!expected)throw new Error('Scale proof requires explicit WFM_CONFIG_ENGINE_GIT_BLOB_SHA for the selected candidate.');
  if(!/^[a-f0-9]{40}$/.test(expected))throw new Error('WFM_CONFIG_ENGINE_GIT_BLOB_SHA must be 40 lowercase hexadecimal characters.');
  return expected;
}
function assertEngineBlob(bytes,expected){
  validateExpectedEngineBlob(expected);
  const body=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
  const actual=createHash('sha1').update(Buffer.from(`blob ${body.length}\0`)).update(body).digest('hex');
  if(actual!==expected)throw new Error(`Configuration engine identity mismatch: ${actual} != ${expected}`);
  return actual;
}
function loadVerifiedEngine(bytes,filename,expected){
  const actual=assertEngineBlob(bytes,expected);
  const source=bytes.toString('utf8');
  if(!Buffer.from(source,'utf8').equals(bytes))throw new Error('Configuration engine must be UTF-8 source.');
  const loaded=new Module(filename,module);
  loaded.filename=filename;
  loaded.paths=Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(source,filename);
  return {exports:loaded.exports,gitBlobSha:actual};
}
module.exports={validateExpectedEngineBlob,assertEngineBlob,loadVerifiedEngine};
