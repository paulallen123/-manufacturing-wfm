'use strict';
const {types:{isProxy}}=require('node:util');

// Shape admission only. The caller must authenticate the source, scope and policy
// before using these values in a schedule or any payroll decision.
function ownData(record,key,label){
  const property=Object.getOwnPropertyDescriptor(record,key);
  if(!property||!Object.hasOwn(property,'value'))throw new Error('Valid '+label+' required.');
  return property.value;
}
function amount(record,key,minimum,maximum,required){
  const property=Object.getOwnPropertyDescriptor(record,key);
  if(!property){if(required)throw new Error('Valid '+key+' required.');return;}
  if(!Object.hasOwn(property,'value')||typeof property.value!=='number'||!Number.isFinite(property.value)||property.value<minimum||property.value>maximum)
    throw new Error('Valid '+key+' required.');
}
function assertSchedulingWageEvidence(workers){
  if(!Array.isArray(workers)||isProxy(workers)||workers.length===0||workers.length>10000)throw new Error('Valid workers array required.');
  const seen=new Set();
  for(let i=0;i<workers.length;i++){
    const property=Object.getOwnPropertyDescriptor(workers,String(i));
    if(!property||!Object.hasOwn(property,'value'))throw new Error('Valid workers entry required.');
    const worker=property.value;
    if(!worker||typeof worker!=='object'||Array.isArray(worker)||isProxy(worker)||
      ![Object.prototype,null].includes(Object.getPrototypeOf(worker)))throw new Error('Valid worker record required.');
    const id=ownData(worker,'id','worker id');
    if(typeof id!=='string'||!id.trim()||seen.has(id))throw new Error('Unique worker id required.');
    seen.add(id);
    const suppliedType=Object.hasOwn(worker,'type')?ownData(worker,'type','worker type'):'EMPLOYEE';
    const type=typeof suppliedType==='string'?suppliedType.trim().toUpperCase():'';
    if(!['EMPLOYEE','AGENCY','CONTINGENT'].includes(type))throw new Error('Valid worker type required.');
    amount(worker,'hourlyCost',0,1000000,true);
    amount(worker,'hoursWorkedWeek',0,168,true);
    amount(worker,'contractedHours',0,168,true);
    amount(worker,'overtimeMultiplier',1,100,true);
    amount(worker,'agencyPremiumPerHour',0,1000000,type==='AGENCY');
    amount(worker,'contingentPremiumPerHour',0,1000000,type==='CONTINGENT');
  }
}
module.exports={assertSchedulingWageEvidence};
