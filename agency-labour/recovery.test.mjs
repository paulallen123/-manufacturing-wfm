import assert from 'node:assert/strict';
import { buildShortfallRecoveryPlan } from './recovery.mjs';

const suppliers = [
  { id:'A', active:true, roles:['PACKING_OPERATOR'], tier:1, billRate:18.5, fillRate:.95, avgResponseMinutes:7, capacity:2 },
  { id:'B', active:true, roles:['PACKING_OPERATOR'], tier:2, billRate:17.9, fillRate:.88, avgResponseMinutes:12, capacity:3 },
  { id:'C', active:true, roles:['PACKING_OPERATOR'], tier:3, billRate:19.2, fillRate:.97, avgResponseMinutes:4, capacity:3 }
];

const partial = buildShortfallRecoveryPlan({
  requirement:{id:'R1',role:'PACKING_OPERATOR',headcount:3},
  suppliers,
  supplierResponses:[{supplierId:'A',status:'PARTIAL',acceptedHeadcount:1}]
});
assert.equal(partial.shortfallBeforeRecovery, 2);
assert.equal(partial.recoveryActions[0].supplierId, 'B');
assert.equal(partial.recoveryActions[0].requestedHeadcount, 2);
assert.equal(partial.recoveryActions[0].workerNotificationAllowed, false);
assert.equal(partial.touchlessCanContinue, true);

const declined = buildShortfallRecoveryPlan({
  requirement:{id:'R2',role:'PACKING_OPERATOR',headcount:3},
  suppliers,
  supplierResponses:[{supplierId:'A',status:'DECLINED',acceptedHeadcount:0}]
});
assert.equal(declined.recoveryActions[0].supplierId, 'B');
assert.equal(declined.recoveryActions[0].requestedHeadcount, 3);
assert.equal(declined.unrecoveredShortfall, 0);

const exhausted = buildShortfallRecoveryPlan({
  requirement:{id:'R3',role:'PACKING_OPERATOR',headcount:7},
  suppliers:[{ id:'A', active:true, roles:['PACKING_OPERATOR'], tier:1, capacity:2 }],
  supplierResponses:[{supplierId:'A',status:'DECLINED',acceptedHeadcount:0}]
});
assert.equal(exhausted.touchlessCanContinue, false);
assert.equal(exhausted.unrecoveredShortfall, 7);

console.log('3/3 shortfall recovery tests passed');
