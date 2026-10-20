'use strict';
const {types:{isProxy}}=require('node:util');

// Structural preflight only. Source custody and current shift-history evidence
// must be established by the canonical caller before any scheduling decision.
function count(worker,field){
  const property=Object.getOwnPropertyDescriptor(worker,field);
  if(!property||!Object.hasOwn(property,'value')||!Number.isSafeInteger(property.value)||property.value<0||property.value>100)
    throw new Error('Valid '+field+' evidence required.');
  return property.value;
}
function assertSchedulingHistoryEvidence(workers){
  if(!Array.isArray(workers)||isProxy(workers)||workers.length>10000)throw new Error('Valid workers array required.');
  for(let i=0;i<workers.length;i++){
    const entry=Object.getOwnPropertyDescriptor(workers,String(i));
    if(!entry||!Object.hasOwn(entry,'value'))throw new Error('Valid worker entry required.');
    const worker=entry.value;
    if(!worker||typeof worker!=='object'||Array.isArray(worker)||isProxy(worker)||
      (Object.getPrototypeOf(worker)!==Object.prototype&&Object.getPrototypeOf(worker)!==null))
      throw new Error('Valid worker record required.');
    const shifts=count(worker,'consecutiveShifts'),nights=count(worker,'consecutiveNights');
    if(nights>shifts)throw new Error('Valid consecutiveNights evidence required.');
  }
}
module.exports={assertSchedulingHistoryEvidence};
