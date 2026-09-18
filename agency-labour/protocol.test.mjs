import assert from 'node:assert/strict';
import {
  buildAdaptiveSupplierReleasePlan,
  buildWorkerOfferProtocol,
  validateAgencyNominations,
  buildPreShiftAssurancePlan,
  assessSupplyChainAssurance
} from './protocol.mjs';

const suppliers = [
  { id:'A', active:true, roles:['PACKING_OPERATOR'], tier:1, billRate:18.5, fillRate:.95, avgResponseMinutes:7, capacity:2 },
  { id:'B', active:true, roles:['PACKING_OPERATOR'], tier:2, billRate:17.9, fillRate:.88, avgResponseMinutes:12, capacity:3 },
  { id:'C', active:true, roles:['PACKING_OPERATOR'], tier:3, billRate:19.2, fillRate:.97, avgResponseMinutes:4, capacity:3 }
];

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('urgent requirement parallelises capacity requests without authorising worker notification', () => {
  const p = buildAdaptiveSupplierReleasePlan({
    requirement:{id:'R1',role:'PACKING_OPERATOR',headcount:3,shiftHours:8,shiftStart:'2026-09-18T18:00:00Z'},
    suppliers,
    now:'2026-09-18T14:00:00Z'
  });
  assert.equal(p.mode, 'URGENT_PARALLEL_CAPACITY');
  assert.equal(p.releases.filter(x => x.requestedHeadcount > 0).every(x => x.opensAtMinute === 0), true);
  assert.equal(p.releases.every(x => x.workerNotificationAllowed === false), true);
});

test('planned requirement retains sequential preferred-supplier cascade', () => {
  const p = buildAdaptiveSupplierReleasePlan({
    requirement:{id:'R2',role:'PACKING_OPERATOR',headcount:3,shiftHours:8,shiftStart:'2026-09-20T18:00:00Z'},
    suppliers,
    now:'2026-09-18T14:00:00Z'
  });
  assert.equal(p.mode, 'SEQUENTIAL_CASCADE');
  const assigned = p.releases.filter(x => x.requestedHeadcount > 0);
  assert.equal(assigned[0].supplierId, 'A');
  assert.equal(assigned[1].opensAtMinute, 10);
});

test('worker offer protocol never sends more formal offers than remaining vacancies', () => {
  const workers = [1,2,3,4,5].map(i => ({workerId:`W${i}`,supplierId:i < 4 ? 'A':'B',recommendationBand:'SUITABLE'}));
  const p = buildWorkerOfferProtocol({ requirement:{id:'R3',headcount:3}, recommendedWorkers:workers });
  assert.equal(p.formalOffers.length, 3);
  assert.equal(p.reserveShortlist.length, 2);
  assert.equal(p.reserveShortlist.every(x => x.workerNotificationAllowed === false), true);
});

test('existing confirmations reduce the number of new formal worker offers', () => {
  const workers = [
    {workerId:'W1',supplierId:'A',recommendationBand:'PREFERRED'},
    {workerId:'W2',supplierId:'A',recommendationBand:'PREFERRED'},
    {workerId:'W3',supplierId:'B',recommendationBand:'SUITABLE'}
  ];
  const p = buildWorkerOfferProtocol({ requirement:{id:'R4',headcount:3}, recommendedWorkers:workers, confirmedWorkerIds:['W1','X'] });
  assert.equal(p.remainingSlots, 1);
  assert.equal(p.formalOffers.length, 1);
});

test('agency nomination is blocked if reserve worker has already been told they have the shift', () => {
  const v = validateAgencyNominations({
    nominations:[{workerId:'W1',workerNotified:true},{workerId:'W2',workerNotified:true}],
    allocatedWorkerIds:['W1']
  });
  assert.equal(v.valid, false);
  assert.equal(v.violations[0].workerId, 'W2');
});

test('close-to-shift no reconfirmation requests standby capacity but does not authorise duplicate worker offer', () => {
  const p = buildPreShiftAssurancePlan({
    confirmations:[{workerId:'W1',supplierId:'A',status:'CONFIRMED'}],
    shiftStart:'2026-09-18T15:00:00Z',
    now:'2026-09-18T14:20:00Z'
  });
  const standby = p.actions.find(x => x.action === 'REQUEST_SUPPLIER_STANDBY_CAPACITY');
  assert.ok(standby);
  assert.equal(standby.workerNotificationAllowed, false);
});

test('unknown umbrella PAYE assurance blocks touchless fulfilment until reviewed', () => {
  const a = assessSupplyChainAssurance({
    supplier:{id:'A',usesUmbrellaCompany:true,umbrellaCompanyName:'Umbrella Ltd',supplyChainEntitiesKnown:false},
    now:'2026-09-18T14:00:00Z'
  });
  assert.equal(a.touchlessAllowed, false);
  assert.ok(a.gaps.includes('PAYE_ASSURANCE_NOT_RECORDED'));
});

test('current recorded umbrella assurance can pass operational touchless gate', () => {
  const a = assessSupplyChainAssurance({
    supplier:{id:'A',usesUmbrellaCompany:true,umbrellaCompanyName:'Umbrella Ltd',supplyChainEntitiesKnown:true,payeAssuranceLastCheckedAt:'2026-09-01T10:00:00Z',agencyCountry:'UK'},
    now:'2026-09-18T14:00:00Z'
  });
  assert.equal(a.touchlessAllowed, true);
});

test('overseas agency or connected umbrella relationship forces specialist review', () => {
  const a = assessSupplyChainAssurance({
    supplier:{id:'X',usesUmbrellaCompany:true,umbrellaCompanyName:'Umbrella Ltd',supplyChainEntitiesKnown:true,payeAssuranceLastCheckedAt:'2026-09-01T10:00:00Z',agencyCountry:'IE',connectedToUmbrellaCompany:true},
    now:'2026-09-18T14:00:00Z'
  });
  assert.equal(a.touchlessAllowed, false);
  assert.equal(a.reviewFlags.length, 2);
});

let passed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`PASS ${name}`); passed++; }
  catch (err) { console.error(`FAIL ${name}`); throw err; }
}
console.log(`\n${passed}/${tests.length} protocol tests passed`);
