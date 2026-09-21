import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSessionReadPolicy,
  authorizeSessionRead,
  validateSessionNextLink,
  sessionFailureDecision,
  assessSessionScopeTransition
} from './session-read-authority.mjs';

function policy(overrides={}){
  return createSessionReadPolicy({
    providerId:'sap-business-one',
    wfmTenantId:'tenant-uk',
    connectionId:'connection-uk-1',
    endpointUrl:'https://erp.example.test/b1s/v2',
    company:'ACME_UK',
    principalId:'wfm-reader',
    credentialRevision:'cred-7',
    apiVersion:'v2',
    sessionCookieNames:['B1SESSION'],
    affinityCookieNames:['ROUTEID'],
    allowedResources:['ProductionOrders','EmployeesInfo','Items','JournalEntries','InventoryGenEntries','InventoryGenExits'],
    deniedResources:['SQLQueries','Login','Logout'],
    ...overrides
  });
}

test('session authority is bound to tenant, endpoint, company, principal, credential revision, connection and API version',()=>{
  const base=policy();
  for(const changed of [
    policy({wfmTenantId:'tenant-ie'}),
    policy({connectionId:'connection-uk-2'}),
    policy({endpointUrl:'https://erp-2.example.test/b1s/v2'}),
    policy({company:'ACME_IE'}),
    policy({principalId:'another-reader'}),
    policy({credentialRevision:'cred-8'}),
    policy({endpointUrl:'https://erp.example.test/b1s/v1',apiVersion:'v1'})
  ]) assert.notEqual(base.sessionScopeNamespace,changed.sessionScopeNamespace);
});

test('cookie semantics remain immutable and never treat affinity as authentication or completeness',()=>{
  const p=policy();
  assert.equal(p.cookieSemantics.B1SESSION,'credential-secret');
  assert.equal(p.cookieSemantics.ROUTEID,'routing-hint-only');
  assert.equal(p.affinityMayEstablishAuthentication,false);
  assert.equal(p.affinityMayEstablishCompleteness,false);
  assert.equal(p.sessionSecretsAllowedInEvidence,false);
  assert.throws(()=>p.allowedResources.push('BusinessPartners'),/extensible|read only|object is not extensible/i);
});

test('only allowlisted GET and HEAD resource reads are authorised',()=>{
  const p=policy();
  assert.equal(authorizeSessionRead({policy:p,requestUrl:'https://erp.example.test/b1s/v2/ProductionOrders?$top=20'}).resource,'ProductionOrders');
  assert.throws(()=>authorizeSessionRead({policy:p,requestUrl:'https://erp.example.test/b1s/v2/ProductionOrders',method:'POST'}),/GET or HEAD/i);
  assert.throws(()=>authorizeSessionRead({policy:p,requestUrl:'https://erp.example.test/b1s/v2/SQLQueries'}),/denied/i);
  assert.throws(()=>authorizeSessionRead({policy:p,requestUrl:'https://erp.example.test/b1s/v2/BusinessPartners'}),/not allowlisted/i);
});

test('cross-host, credentials, base-path and API-version escapes fail closed',()=>{
  const p=policy();
  assert.throws(()=>authorizeSessionRead({policy:p,requestUrl:'https://evil.example/b1s/v2/Items'}),/origin/i);
  assert.throws(()=>authorizeSessionRead({policy:p,requestUrl:'https://user:secret@erp.example.test/b1s/v2/Items'}),/credentials/i);
  assert.throws(()=>authorizeSessionRead({policy:p,requestUrl:'https://erp.example.test/b1s/v1/Items'}),/base path|version/i);
  assert.throws(()=>authorizeSessionRead({policy:p,requestUrl:'https://erp.example.test/b1s/v2/Items#foreign-state'}),/fragment/i);
});

test('session read budgets are positive and immutable',()=>{
  const p=policy({maxPages:250,maxBytesPerPage:2_000_000,maxElapsedMs:300_000});
  assert.deepEqual(p.readBudget,{maxPages:250,maxBytesPerPage:2_000_000,maxElapsedMs:300_000});
  assert.throws(()=>policy({maxPages:0}),/maxPages/i);
});

test('provider next links preserve query semantics and advance a bounded cursor',()=>{
  const p=policy();
  const current='https://erp.example.test/b1s/v2/ProductionOrders?$select=AbsoluteEntry,ItemNo&$filter=Status%20eq%20%27R%27&$orderby=AbsoluteEntry&$top=20&$skip=0';
  const next='/b1s/v2/ProductionOrders?$select=AbsoluteEntry,ItemNo&$filter=Status%20eq%20%27R%27&$orderby=AbsoluteEntry&$top=20&$skip=20';
  const result=validateSessionNextLink({policy:p,currentRequestUrl:current,nextLink:next,seenNextLinks:[]});
  assert.equal(result.cursorKind,'skip');
  assert.equal(result.cursorValue,'20');
  assert.equal(result.checkpointAdvanceAllowed,false);
});

test('next-link host escape, query drift, cursor loops and pagination disablement are rejected',()=>{
  const p=policy();
  const current='https://erp.example.test/b1s/v2/Items?$filter=Frozen%20eq%20%27tNO%27&$orderby=ItemCode&$top=20&$skip=0';
  assert.throws(()=>validateSessionNextLink({policy:p,currentRequestUrl:current,nextLink:'https://evil.example/b1s/v2/Items?$filter=Frozen%20eq%20%27tNO%27&$orderby=ItemCode&$top=20&$skip=20'}),/origin/i);
  assert.throws(()=>validateSessionNextLink({policy:p,currentRequestUrl:current,nextLink:'/b1s/v2/Items?$filter=Frozen%20eq%20%27tYES%27&$orderby=ItemCode&$top=20&$skip=20'}),/query semantics/i);
  assert.throws(()=>validateSessionNextLink({policy:p,currentRequestUrl:current,nextLink:'/b1s/v2/Items?$filter=Frozen%20eq%20%27tNO%27&$orderby=ItemCode&$top=0&$skip=20'}),/page size/i);
  const repeated='https://erp.example.test/b1s/v2/Items?%24filter=Frozen+eq+%27tNO%27&%24orderby=ItemCode&%24top=20&%24skip=20';
  assert.throws(()=>validateSessionNextLink({policy:p,currentRequestUrl:current,nextLink:'/b1s/v2/Items?$filter=Frozen%20eq%20%27tNO%27&$orderby=ItemCode&$top=20&$skip=20',seenNextLinks:[repeated]}),/loop|repeated/i);
});

test('session expiry permits one bounded reauthentication and forces uncommitted-page replay',()=>{
  assert.deepEqual(sessionFailureDecision({status:401,reauthAttempts:0}),{
    action:'reauthenticate-once',
    invalidateSession:true,
    checkpointAdvanceAllowed:false,
    restartPageChainFromCommittedCheckpoint:true,
    requiresOverlapReplay:true
  });
  assert.equal(sessionFailureDecision({status:401,reauthAttempts:1}).action,'stop-credential-diagnostic');
  assert.equal(sessionFailureDecision({status:403,reauthAttempts:0}).action,'stop-permission-diagnostic');
  assert.equal(sessionFailureDecision({status:429,reauthAttempts:0}).action,'retry-current-session-with-backoff');
});

test('company or endpoint changes require a new session and checkpoint namespace',()=>{
  const same=assessSessionScopeTransition({fromPolicy:policy(),toPolicy:policy()});
  assert.equal(same.requiresNewCheckpointNamespace,false);
  const changed=assessSessionScopeTransition({fromPolicy:policy(),toPolicy:policy({company:'ACME_IE'})});
  assert.equal(changed.requiresNewCheckpointNamespace,true);
  assert.equal(changed.requiresReconciliation,true);
  assert.equal(changed.sessionReuseAllowed,false);
});

test('affinity loss never changes source scope but invalidates the uncommitted page proof',()=>{
  const decision=sessionFailureDecision({status:503,affinityLost:true});
  assert.equal(decision.action,'reacquire-affinity-and-replay-uncommitted-page');
  assert.equal(decision.requiresNewCheckpointNamespace,false);
  assert.equal(decision.checkpointAdvanceAllowed,false);
});
