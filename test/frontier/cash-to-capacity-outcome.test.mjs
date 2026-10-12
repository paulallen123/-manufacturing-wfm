import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileCashToCapacityOutcome,learningSummary} from '../../src/frontier/cash-to-capacity-outcome.mjs';

const scope={decisionId:'d1',tenantId:'t1',siteId:'s1',legalEntityId:'le1',currency:'GBP'};
const measurement={measurementId:'m1',windowStart:'2026-09-20T00:00:00Z',windowEnd:'2026-09-23T00:00:00Z'};
const binding={...scope,measurement};
const provenance={...binding,authoritative:true,provider:'source',revision:'r1',observedAt:'2026-09-24T00:00:00Z'};
const base={
  decision:binding,
  prediction:{...binding,estimatedEconomicValue:5600,daysEarlier:3},
  operationalOutcome:{...provenance,productionCompleted:true,customerCommitmentMet:true,ref:'mes:actual:884'},
  financialOutcome:{...provenance,realisedEconomicValue:5100,actualDaysEarlier:2,ref:'erp:payment:884'},
  now:'2026-09-25T00:00:00Z'
};
const reconcile=input=>reconcileCashToCapacityOutcome(input);
const invalid=input=>{
  const r=reconcile(input);
  assert.ok(['incomplete','rejected'].includes(r.status),JSON.stringify(r));
  assert.notEqual(r.outcomeClass,'realised');
};

test('keeps realised outcome distinct from the prediction',()=>{
  const r=reconcile(base);
  assert.equal(r.status,'reconciled');
  assert.equal(r.prediction.economicValue,5600);
  assert.equal(r.realised.economicValue,5100);
  assert.equal(r.calibration.valueError,-500);
});

test('refuses to learn from non-authoritative financial outcomes',()=>{
  const input=structuredClone(base);input.financialOutcome.authoritative=false;
  assert.equal(reconcile(input).reason,'financial_outcome_not_authoritative');
});

test('learning summary is evidence-only and cannot mutate decision authority',()=>{
  const r=reconcile(base);
  const s=learningSummary([r]);
  assert.equal(s.status,'evidence_only');
  assert.equal(s.count,1);
  assert.equal(s.meanAbsoluteValueError,500);
  assert.match(r.authorityBoundary,/does not automatically change/i);
});

test('empty evidence references cannot establish realised value (reported regression)',()=>{
  const input=structuredClone(base);
  input.operationalOutcome.ref='';input.financialOutcome.ref='';
  invalid(input);
});

test('duplicate outcomes count once without changing learning weights (reported regression)',()=>{
  const first=reconcile(base);
  const other=structuredClone(base);
  for(const key of ['decision','prediction','operationalOutcome','financialOutcome'])other[key].measurement.measurementId='m2';
  other.financialOutcome.realisedEconomicValue=5600;
  const second=reconcile(other);
  const summary=learningSummary([first,structuredClone(first),second]);
  assert.equal(summary.count,2);
  assert.equal(summary.meanAbsoluteValueError,250);
});

for(const component of ['decision','prediction','operationalOutcome','financialOutcome']){
  for(const field of Object.keys(scope)){
    test(`${component} requires exact ${field}`,()=>{
      for(const value of [undefined,null,'',' ',`other-${scope[field]}`]){
        const input=structuredClone(base);input[component][field]=value;invalid(input);
      }
    });
  }
  test(`${component} requires measurement identity and valid matching window`,()=>{
    for(const value of [undefined,null,{}, {...measurement,measurementId:''}, {...measurement,measurementId:'other'},
      {...measurement,windowStart:undefined},{...measurement,windowEnd:''},
      {...measurement,windowStart:'2026-09-23T00:00:00Z'},
      {...measurement,windowEnd:'2026-09-22T00:00:00Z'}]){
      const input=structuredClone(base);input[component].measurement=value;invalid(input);
    }
  });
}
for(const component of ['operationalOutcome','financialOutcome']){
  for(const field of ['provider','revision','ref']){
    test(`${component} requires ${field}`,()=>{
      for(const value of [undefined,null,'',' ',42]){
        const input=structuredClone(base);input[component][field]=value;invalid(input);
      }
    });
  }
  test(`${component} rejects unauthoritative or invalid observed timestamps`,()=>{
    for(const value of [undefined,null,'','bad','2026-02-30T00:00:00Z','2026-09-24',0,
      '2026-09-24T00:00:00','2026-09-26T00:00:00Z','2026-09-22T00:00:00Z']){
      const input=structuredClone(base);input[component].observedAt=value;invalid(input);
    }
    for(const value of [undefined,false,'true',1]){
      const input=structuredClone(base);input[component].authoritative=value;invalid(input);
    }
  });
}
for(const [component,field] of [['prediction','estimatedEconomicValue'],['prediction','daysEarlier'],
  ['financialOutcome','realisedEconomicValue'],['financialOutcome','actualDaysEarlier']]){
  test(`${component}.${field} accepts only finite genuine numbers`,()=>{
    for(const value of [undefined,null,NaN,Infinity,-Infinity,'0','5100',true]){
      const input=structuredClone(base);input[component][field]=value;invalid(input);
    }
    const input=structuredClone(base);input[component][field]=0;
    assert.equal(reconcile(input).status,'reconciled');
  });
}

test('unknown operational observations are not silently converted to false',()=>{
  for(const field of ['productionCompleted','customerCommitmentMet']){
    for(const value of [undefined,null,'false',0]){
      const input=structuredClone(base);input.operationalOutcome[field]=value;invalid(input);
    }
  }
});

test('negative economic and timing outcomes and operational failures remain evidence',()=>{
  const input=structuredClone(base);
  input.financialOutcome.realisedEconomicValue=-800;
  input.financialOutcome.actualDaysEarlier=-2;
  input.operationalOutcome.productionCompleted=false;
  input.operationalOutcome.customerCommitmentMet=false;
  const r=reconcile(input);
  assert.equal(r.status,'reconciled');
  assert.equal(r.realised.economicValue,-800);
  assert.equal(r.realised.daysEarlier,-2);
  assert.equal(r.realised.productionCompleted,false);
  assert.equal(r.realised.customerCommitmentMet,false);
  assert.equal(r.calibration.valueError,-6400);
  assert.equal(r.calibration.timingError,-5);
});

test('overflow and invalid clocks/windows fail closed',()=>{
  const input=structuredClone(base);
  input.prediction.estimatedEconomicValue=-Number.MAX_VALUE;
  input.financialOutcome.realisedEconomicValue=Number.MAX_VALUE;invalid(input);
  for(const value of [null,'bad','2026-02-30T00:00:00Z',123])invalid({...base,now:value});
  for(const value of ['bad','2026-02-30T00:00:00Z','2026-09-20']){
    const input=structuredClone(base);
    for(const key of ['decision','prediction','operationalOutcome','financialOutcome'])input[key].measurement.windowStart=value;
    invalid(input);
  }
  invalid();invalid(null);
});

test('output is a detached immutable snapshot and has no execution authority',()=>{
  const input=structuredClone(base),before=structuredClone(input),r=reconcile(input);
  assert.deepEqual(input,before);
  assert.deepEqual(r.scope,scope);
  assert.deepEqual(r.measurement,measurement);
  assert.equal(r.executionAuthority,false);
  assert.ok(Object.isFrozen(r));assert.ok(Object.isFrozen(r.scope));
  assert.ok(Object.isFrozen(r.measurement));assert.ok(Object.isFrozen(r.evidence));
  input.decision.tenantId='changed';
  assert.equal(r.scope.tenantId,'t1');
});

test('conflicting observations for the same identity reject the entire summary',()=>{
  const r=reconcile(base);
  for(const change of [input=>input.financialOutcome.realisedEconomicValue++,
    input=>input.prediction.daysEarlier++,input=>input.operationalOutcome.productionCompleted=false,
    input=>input.financialOutcome.revision='r2',input=>input.financialOutcome.ref='other',
    input=>{for(const key of ['decision','prediction','operationalOutcome','financialOutcome'])input[key].measurement.windowStart='2026-09-19T00:00:00Z';}]){
    const input=structuredClone(base);change(input);const other=reconcile(input);
    assert.equal(other.status,'reconciled');
    for(const records of [[r,other],[other,r]]){
      const s=learningSummary(records);
      assert.equal(s.status,'rejected');assert.equal(s.reason,'conflicting_outcome_identity');
      assert.equal(s.count,0);assert.equal(s.meanAbsoluteValueError,undefined);
    }
  }
});

test('learning rejects tampered/legacy records and mixed scopes',()=>{
  const r=reconcile(base);
  for(const change of [r=>r.calibration.absoluteValueError=0,r=>r.realised.economicValue=null,
    r=>delete r.scope,r=>delete r.measurement,r=>r.evidence.financialRef='',
    r=>r.executionAuthority=true]){
    const bad=structuredClone(r);change(bad);
    assert.equal(learningSummary([r,bad]).status,'rejected');
  }
  for(const field of ['tenantId','siteId','legalEntityId','currency']){
    const input=structuredClone(base);
    for(const key of ['decision','prediction','operationalOutcome','financialOutcome'])input[key][field]=field==='currency'?'EUR':'other';
    assert.equal(learningSummary([r,reconcile(input)]).reason,'mixed_learning_scope');
  }
  assert.equal(learningSummary([]).status,'insufficient_evidence');
  assert.equal(learningSummary([reconcile({})]).status,'insufficient_evidence');
  assert.equal(learningSummary(null).status,'rejected');
});

test('learning mean stays finite for large finite errors and key order does not affect duplicates',()=>{
  const input=structuredClone(base);input.prediction.estimatedEconomicValue=0;
  input.financialOutcome.realisedEconomicValue=Number.MAX_VALUE;
  const first=reconcile(input);
  for(const key of ['decision','prediction','operationalOutcome','financialOutcome'])input[key].measurement.measurementId='m2';
  const s=learningSummary([first,reconcile(input)]);
  assert.equal(s.meanAbsoluteValueError,Number.MAX_VALUE);
  const reordered=Object.fromEntries(Object.entries(first).reverse());
  assert.equal(learningSummary([first,reordered]).count,1);
});
