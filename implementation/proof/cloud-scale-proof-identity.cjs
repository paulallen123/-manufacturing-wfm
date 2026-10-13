'use strict';
const {createHash}=require('node:crypto');

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
module.exports={validateExpectedEngineBlob,assertEngineBlob};
