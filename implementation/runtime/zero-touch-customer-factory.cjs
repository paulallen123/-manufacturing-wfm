'use strict';

const TERMINAL = new Set(['LIVE','FAILED_CLOSED']);
const DEFAULT_STAGES = [
  ['PROVISIONING',[]],
  ['DISCOVERING',['PROVISIONING']],
  ['CONNECTING',['DISCOVERING']],
  ['RECONCILING',['DISCOVERING']],
  ['CONFIGURING',['RECONCILING']],
  ['SIMULATING',['CONFIGURING']],
  ['TRAINING',['CONFIGURING']],
  ['PROVING',['SIMULATING','TRAINING']],
  ['ADVERSARIAL_TESTING',['PROVING']],
  ['READY',['ADVERSARIAL_TESTING','CONNECTING']],
  ['LIVE',['READY']]
];

function createZeroTouchCustomerFactory(options={}) {
  const clock=options.clock||(()=>new Date().toISOString());
  if (typeof options.execute !== 'function') throw new TypeError('A customer provisioning executor is required.');
  const execute=options.execute;
  const maxConcurrency=Math.max(1,Number(options.maxConcurrency||8));
  const jobs=new Map();
  let boundCustomerId=null;

  function seed(customerId){
    if (typeof customerId !== 'string' || !customerId.trim()) throw new TypeError('A non-empty customer identity is required.');
    if (boundCustomerId !== null && customerId !== boundCustomerId) throw new Error('Customer mismatch: this factory is bound to another customer.');
    if(jobs.size) return;
    boundCustomerId=customerId;
    for(const [stage,deps] of DEFAULT_STAGES) jobs.set(stage,{id:stage,customerId,deps,status:'PENDING',attempts:0,evidence:[],updatedAt:clock()});
  }
  function snapshot(){
    return [...jobs.values()].map(x=>({...x,deps:[...x.deps],evidence:[...x.evidence]}));
  }
  function runnable(){
    return [...jobs.values()].filter(j=>j.status==='PENDING' && j.deps.every(d=>jobs.get(d)?.status==='PASS')).slice(0,maxConcurrency);
  }
  async function tick(customerId){
    seed(customerId);
    const run=runnable();
    if(!run.length){
      const unfinished=[...jobs.values()].filter(j=>!['PASS','FAILED_CLOSED'].includes(j.status));
      return {customerId,idle:unfinished.length>0,blocked:unfinished.map(j=>j.id),jobs:snapshot()};
    }
    await Promise.all(run.map(async job=>{
      job.status='RUNNING'; job.attempts++; job.updatedAt=clock();
      try{
        const result=await execute({...job});
        if(result?.status==='PASS'){ job.status='PASS'; job.evidence.push(result.evidence||{}); }
        else if(result?.safeRetry===true){ job.status='PENDING'; job.evidence.push(result?.evidence||{}); }
        else { job.status='FAILED_CLOSED'; job.evidence.push(result?.evidence||{}); }
      }catch(error){
        job.status='PENDING';
        job.evidence.push({type:'EXECUTION_ERROR',message:String(error?.message||error)});
      }
      job.updatedAt=clock();
    }));
    return {customerId,idle:false,runnableNext:runnable().map(j=>j.id),jobs:snapshot()};
  }
  async function runUntilBlocked(customerId,{maxTicks=50}={}){
    seed(customerId);
    for(let i=0;i<maxTicks;i++){
      const before=snapshot().map(j=>j.status).join('|');
      const state=await tick(customerId);
      if(jobs.get('LIVE')?.status==='PASS') return {...state,state:'LIVE'};
      const after=snapshot().map(j=>j.status).join('|');
      if(before===after && runnable().length===0) return {...state,state:'BLOCKED'};
    }
    return {customerId,state:'BOUNDED',jobs:snapshot()};
  }
  return {tick,runUntilBlocked,snapshot,runnable};
}

module.exports={createZeroTouchCustomerFactory,DEFAULT_STAGES};
