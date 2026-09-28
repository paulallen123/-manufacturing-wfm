import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSourceScope,assertCheckpointScope,lineageScope} from './scope-partition.mjs';

const base={providerId:'business-central',connectionId:'conn-1',resource:'itemLedgerEntries',tenant:'t1',environment:'prod',company:'c1',apiVersion:'v2.0',dataset:'item-ledger'};

test('scope namespace is deterministic across key order and Unicode normalisation',()=>{
  const a=buildSourceScope({...base,site:'Cafe\u0301'});
  const b=buildSourceScope({dataset:'item-ledger',company:'c1',site:'Café',apiVersion:'v2.0',environment:'prod',tenant:'t1',resource:'itemLedgerEntries',connectionId:'conn-1',providerId:'business-central'});
  assert.equal(a.checkpointNamespace,b.checkpointNamespace);
  assert.equal(a.dimensions.site,'Café');
});

test('company, environment, region, API version and dataset changes isolate checkpoints',()=>{
  const original=buildSourceScope(base).checkpointNamespace;
  for(const [key,value] of [['company','c2'],['environment','sandbox'],['region','eu'],['apiVersion','v3.0'],['dataset','gl']]){
    assert.notEqual(buildSourceScope({...base,[key]:value}).checkpointNamespace,original,key);
  }
});

test('provider-required dimensions fail closed when missing',()=>{
  assert.throws(()=>buildSourceScope({providerId:'bc',connectionId:'c',resource:'r',tenant:'t'},{requiredDimensions:['tenant','environment','company']}),/environment, company/);
});

test('checkpoint continuation is refused across source scopes',()=>{
  const a=buildSourceScope(base);
  const b=buildSourceScope({...base,company:'c2'});
  assert.equal(assertCheckpointScope({scopeNamespace:a.checkpointNamespace},a),true);
  assert.throws(()=>assertCheckpointScope({scopeNamespace:a.checkpointNamespace},b),/overlap replay\/reconciliation/);
});

test('lineage preserves approved source dimensions and drops arbitrary secret fields',()=>{
  const scope=buildSourceScope({...base,secret:'should-not-survive'});
  const lineage=lineageScope(scope);
  assert.equal(lineage.sourceScope.company,'c1');
  assert.equal(lineage.sourceScope.secret,undefined);
  assert.equal(lineage.checkpointNamespace,scope.checkpointNamespace);
});
