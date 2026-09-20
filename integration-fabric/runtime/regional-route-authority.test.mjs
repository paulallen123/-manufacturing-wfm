import test from 'node:test';
import assert from 'node:assert/strict';
import {createRegionalRoutePolicy,authorizeRegionalRoute,assessRegionalRouteTransition} from './regional-route-authority.mjs';

function policy(){
  return createRegionalRoutePolicy({providerId:'example-manufacturing',routes:[
    {id:'uk-primary',region:'uk',dataLocation:'UK',endpointHosts:['uk.example.com'],sourceCountries:['GB'],allowedTransferDestinations:['eu-west']},
    {id:'eu-dr',region:'eu-west',dataLocation:'EU',endpointHosts:['eu.example.com'],sourceCountries:['FR','DE']}
  ]});
}

test('exact HTTPS route is authorised and checkpoint dimensions preserve residency context',()=>{
  const result=authorizeRegionalRoute({policy:policy(),routeId:'uk-primary',endpointUrl:'https://uk.example.com/api/v1/orders'});
  assert.equal(result.endpointHost,'uk.example.com');
  assert.equal(result.crossRegionTransfer,false);
  assert.deepEqual(result.checkpointDimensions,{routeId:'uk-primary',region:'uk',dataLocation:'UK'});
  assert.equal(result.silentFailoverAllowed,false);
});

test('wildcard endpoint authority is rejected when policy is created',()=>{
  assert.throws(()=>createRegionalRoutePolicy({providerId:'p',routes:[{id:'r',region:'uk',dataLocation:'UK',endpointHosts:['*.example.com']}]}),/exact host/i);
});

test('unlisted host and plaintext HTTP fail closed',()=>{
  const p=policy();
  assert.throws(()=>authorizeRegionalRoute({policy:p,routeId:'uk-primary',endpointUrl:'https://other.example.com/api'}),/not allowlisted/i);
  assert.throws(()=>authorizeRegionalRoute({policy:p,routeId:'uk-primary',endpointUrl:'http://uk.example.com/api'}),/HTTPS/i);
});

test('cross-region transfer requires both route allowlist and explicit customer approval',()=>{
  const p=policy();
  assert.throws(()=>authorizeRegionalRoute({policy:p,routeId:'uk-primary',endpointUrl:'https://uk.example.com/api',destinationRegion:'eu-west'}),/explicit customer approval/i);
  const approved=authorizeRegionalRoute({policy:p,routeId:'uk-primary',endpointUrl:'https://uk.example.com/api',destinationRegion:'eu-west',customerApprovedTransfer:true});
  assert.equal(approved.crossRegionTransfer,true);
});

test('regional failover is never silent and forces a new checkpoint plus reconciliation',()=>{
  const result=assessRegionalRouteTransition({policy:policy(),fromRouteId:'uk-primary',toRouteId:'eu-dr',customerApprovedTransfer:true});
  assert.equal(result.crossRegion,true);
  assert.equal(result.requiresNewCheckpointNamespace,true);
  assert.equal(result.requiresReconciliation,true);
  assert.equal(result.silentFailoverAllowed,false);
});

test('regional authority policy is deeply immutable at runtime',()=>{
  const p=policy();
  assert.ok(Object.isFrozen(p));
  assert.ok(Object.isFrozen(p.routes));
  assert.ok(Object.isFrozen(p.routes[0]));
  assert.ok(Object.isFrozen(p.routes[0].endpointHosts));
  assert.throws(()=>p.routes[0].endpointHosts.push('evil.example.com'),/not extensible|read only|object is not extensible/i);
});
