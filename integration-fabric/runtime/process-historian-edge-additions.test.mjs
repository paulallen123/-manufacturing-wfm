import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';

const ids=['aspentech-infoplus21','yokogawa-exaquantum','emerson-deltav-edge-environment'];

test('new process historian and edge targets stay spec-only, edge-routed and read-only',()=>{
  for(const id of ids){
    const c=connectorById(id);
    assert.ok(c,id+' missing from effective registry');
    assert.equal(c.evidenceLevel,'spec-verified',id);
    assert.equal(c.nextEvidenceGate,'sandbox-authentication',id);
    assert.equal(c.security.customerEdgeRequired,true,id);
    assert.equal(c.security.directPlantNetworkAccess,false,id);
    assert.equal(c.security.readOnlyDefault,true,id);
    assert.equal(c.security.writeEnabled,false,id);
    assert.equal(c.security.arbitraryEndpointAllowed,false,id);
    assert.ok(c.canonicalTargets.includes('machine-state'),id);
    assert.ok(c.canonicalTargets.includes('downtime-event'),id);
    assert.ok(c.canonicalTargets.includes('shift-outcome'),id);
  }
});

test('Aspen InfoPlus.21 reuses REST and database-read profiles only',()=>{
  const c=connectorById('aspentech-infoplus21');
  assert.deepEqual(c.protocols,['REST','JDBC/ODBC']);
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.ok(c.adapters.some(x=>x.id==='database'));
  assert.equal(c.adapters.some(x=>x.id==='opcua'),false);
});

test('Yokogawa Exaquantum is constrained to OPC UA edge reads',()=>{
  const c=connectorById('yokogawa-exaquantum');
  assert.deepEqual(c.protocols,['OPC UA']);
  assert.deepEqual(c.adapters.map(x=>x.id),['opcua']);
  assert.equal(c.discoveryStrategy,'customer-edge-config-required');
});

test('DeltaV Edge reuses REST and OPC UA without inheriting DCS control authority',()=>{
  const c=connectorById('emerson-deltav-edge-environment');
  assert.deepEqual(c.protocols,['REST','OPC UA']);
  assert.ok(c.adapters.some(x=>x.id==='rest-openapi'));
  assert.ok(c.adapters.some(x=>x.id==='opcua'));
  assert.equal(c.discoveryStrategy,'customer-edge-config-required');
});
