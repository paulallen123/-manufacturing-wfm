import test from 'node:test';
import assert from 'node:assert/strict';
import {assertNoStaticCredentialMaterial} from './static-credential-authority.mjs';

test('session and cookie values cannot enter generic evidence payloads',()=>{
  for(const evidence of [
    {B1SESSION:'secret-marker'},
    {sessionId:'secret-marker'},
    {Cookie:'B1SESSION=secret-marker'},
    {'Set-Cookie':'B1SESSION=secret-marker; Secure'},
    {headers:{cookieHeader:'B1SESSION=secret-marker'}},
    {ROUTEID:'.node-secret-marker'},
    {headers:[{name:'Cookie',value:'B1SESSION=secret-marker'}]},
    {diagnosticMessage:'upstream rejected B1SESSION=secret-marker'}
  ]){
    assert.throws(
      ()=>assertNoStaticCredentialMaterial(evidence),
      error=>error?.code==='WFM_STATIC_CREDENTIAL_EVIDENCE_LEAK'
    );
  }
});
