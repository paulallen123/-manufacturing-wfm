import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateEnergyFlexibility,isParetoBetterThanBaseline,reduceEnergySignalEvents,reduceEnergySignalEventsDetailed,paretoFront} from '../../src/frontier/energy-flexibility.mjs';

const NOW='2026-09-18T06:00:00.000Z';
function baseInput(){return {now:NOW,tenantId:'synthetic-tenant',siteId:'synthetic-site',minimumNetBenefit:0,latestKnownSignalRevision:2,energySignal:{tenantId:'synthetic-tenant',siteId:'synthetic-site',status:'active',revision:2,type:'turn_down',publishedAt:'2026-09-18T05:50:00.000Z',freshUntil:'2026-09-18T07:00:00.000Z',windowEnd:'2026-09-18T08:00:00.000Z',acceptanceDeadline:'2026-09-18T06:30:00.000Z',confidence:0.98},process:{tenantId:'synthetic-tenant',siteId:'synthetic-site',flexibilityClass:'shiftable',batchContinuityRequired:false,stateFresh:true,confidence:0.95},options:[{id:'baseline',kind:'do_nothing',workforce:{staffingCount:5,minimumStaffing:4,restCompliant:true,qualificationsValid:true,confidence:1},energy:{},labour:{},production:{},scheduleChurnCost:0},{id:'shift-later',kind:'shift_later',tenantId:'synthetic-tenant',siteId:'synthetic-site',approvalRequired:true,shiftMinutes:60,workforce:{staffingCount:5,minimumStaffing:4,restCompliant:true,qualificationsValid:true,supervisorRequired:true,supervisorAvailable:true,requiredSkills:{furnace:1},skillCoverage:{furnace:2},confidence:0.97},energy:{grossSaving:700,flexibilityReward:200,uncertaintyPct:0.1},labour:{premiumCost:150,upperBoundCost:170},production:{penaltyCost:50,upperBoundPenalty:70,hardServiceBreach:false,qualityRisk:'acceptable'},scheduleChurnCost:25,upperBoundScheduleChurnCost:35,controls:{}}]};}

test('safe option remains conservatively ranked with double-count protection',()=>{const r=evaluateEnergyFlexibility(baseInput());assert.equal(r.status,'recommend_options');assert.equal(r.rankedOptions[0].economics.grossEnergyValue,700);assert.equal(r.rankedOptions[0].economics.doubleCountGuardApplied,true);assert.equal(r.rankedOptions[0].economics.conservativeNetValue,355);assert.equal(r.rankedOptions[0].actionContract.type,'workflow_handoff_only');assert.ok(isParetoBetterThanBaseline(r.rankedOptions[0],r.baseline));});

test('out-of-order cancellation wins deterministically',()=>{const i=baseInput(),newer={...i.energySignal,revision:3,publishedAt:'2026-09-18T05:55:00.000Z',status:'cancelled'},older={...i.energySignal,revision:1,publishedAt:'2026-09-18T05:40:00.000Z'};assert.equal(reduceEnergySignalEvents([newer,older,i.energySignal]).revision,3);i.energyEvents=[newer,older,i.energySignal];i.latestKnownSignalRevision=3;delete i.energySignal;const r=evaluateEnergyFlexibility(i);assert.equal(r.signalFresh,false);assert.ok(r.signalFailures.includes('energy_signal_cancelled'));});

test('exact event replay is idempotent and delivery order does not change decision hash',()=>{const a=baseInput();const e1={...a.energySignal,revision:1,publishedAt:'2026-09-18T05:40:00.000Z'};const e2={...a.energySignal};a.energyEvents=[e1,e2];delete a.energySignal;const b=structuredClone(a);b.energyEvents=[e2,e1,e2,e1,e2];const ra=evaluateEnergyFlexibility(a),rb=evaluateEnergyFlexibility(b);assert.equal(ra.effectiveSignalRevision,2);assert.equal(rb.eventReduction.duplicateCount,3);assert.equal(ra.reproducibilityHash,rb.reproducibilityHash);assert.deepEqual(ra.rankedOptions,rb.rankedOptions);});

test('conflicting same-revision authoritative events fail closed',()=>{const i=baseInput();const active={...i.energySignal};const conflict={...i.energySignal,type:'turn_up',confidence:0.99};i.energyEvents=[active,conflict];delete i.energySignal;const d=reduceEnergySignalEventsDetailed(i.energyEvents);assert.equal(d.conflict,true);const r=evaluateEnergyFlexibility(i);assert.equal(r.status,'no_safe_or_valuable_flexibility');assert.ok(r.signalFailures.includes('energy_signal_revision_conflict'));});

test('tenant and site mismatches are never executable',()=>{for(const mutate of [i=>i.energySignal.tenantId='other',i=>i.energySignal.siteId='other',i=>i.process.tenantId='other',i=>i.process.siteId='other',i=>i.options[1].tenantId='other',i=>i.options[1].siteId='other']){const i=baseInput();mutate(i);const x=evaluateEnergyFlexibility(i).rejectedOptions.find(o=>o.id==='shift-later');assert.equal(x.executable,false);assert.ok(x.hardConstraintFailures.some(r=>r.endsWith('_mismatch')));}});

test('true multi-option Pareto front removes dominated alternatives but preserves trade-offs',()=>{const i=baseInput();const dominated=structuredClone(i.options[1]);dominated.id='dominated';dominated.energy.grossSaving=650;dominated.labour.upperBoundCost=190;dominated.production.upperBoundPenalty=80;dominated.upperBoundScheduleChurnCost=45;dominated.workforce.confidence=0.90;const tradeoff=structuredClone(i.options[1]);tradeoff.id='low-labour-tradeoff';tradeoff.energy.grossSaving=430;tradeoff.labour.premiumCost=20;tradeoff.labour.upperBoundCost=25;tradeoff.production.penaltyCost=20;tradeoff.production.upperBoundPenalty=25;tradeoff.scheduleChurnCost=10;tradeoff.upperBoundScheduleChurnCost=12;tradeoff.workforce.confidence=0.96;i.options.push(dominated,tradeoff);const r=evaluateEnergyFlexibility(i);assert.deepEqual(r.rankedOptions.map(x=>x.id).sort(),['low-labour-tradeoff','shift-later'].sort());assert.equal(r.dominatedOptions.length,1);assert.equal(r.dominatedOptions[0].id,'dominated');assert.deepEqual(r.dominatedOptions[0].dominatedBy.sort(),['low-labour-tradeoff','shift-later'].sort());assert.equal(paretoFront([...r.rankedOptions,r.dominatedOptions[0]]).length,2);});

test('near-equal non-dominated alternatives surface uncertainty rather than a false winner',()=>{const i=baseInput();const b=structuredClone(i.options[1]);b.id='shift-earlier';b.kind='shift_earlier';b.energy.grossSaving=700;b.labour.upperBoundCost=100;b.labour.premiumCost=90;b.production.upperBoundPenalty=150;i.options.push(b);const r=evaluateEnergyFlexibility(i);assert.equal(r.rankedOptions.length,2);assert.equal(r.decisionState,'multiple_close_options');});

test('process profile, warm-up, cooldown, shift-window and continuity constraints fail closed',()=>{const cases=[
  i=>{i.process.maxShiftMinutes=30;i.options[1].shiftMinutes=60;},
  i=>{i.process.batchContinuityRequired=true;i.options[1].interruptionMinutes=1;},
  i=>{i.process.minimumWarmupMinutes=20;i.options[1].requiresRestart=true;i.options[1].warmupMinutes=10;},
  i=>{i.process.minimumCooldownMinutes=15;i.options[1].requiresRestart=true;i.options[1].cooldownMinutes=5;},
  i=>{i.process.powerKwMin=100;i.options[1].expectedPowerKw=90;},
  i=>{i.process.powerKwMax=200;i.options[1].expectedPowerKw=220;}
];for(const mutate of cases){const i=baseInput();mutate(i);const x=evaluateEnergyFlexibility(i).rejectedOptions.find(o=>o.id==='shift-later');assert.equal(x.executable,false);assert.ok(x.hardConstraintFailures.some(r=>r.startsWith('process_')||r==='batch_continuity_required'));}});

test('stale, superseded, malformed economics and low confidence still fail closed',()=>{for(const mutate of [i=>i.energySignal.freshUntil='2026-09-18T05:59:59.000Z',i=>i.energySignal.revision=1,i=>i.energySignal.confidence=0.3,i=>i.options[1].labour.premiumCost=-999,i=>i.options[1].workforce.confidence=0.4]){const i=baseInput();mutate(i);const r=evaluateEnergyFlexibility(i);assert.equal(r.status,'no_safe_or_valuable_flexibility');}});

test('hard workforce and actuation boundaries remain enforced',()=>{const i=baseInput();Object.assign(i.options[1].workforce,{staffingCount:2,minimumStaffing:4,restCompliant:false,qualificationsValid:false,requiredSkills:{furnace:2},skillCoverage:{furnace:1}});i.options[1].controls={directGridBid:true,directMachineCommand:true,directBatteryDispatch:true,directRobotCommand:true};const x=evaluateEnergyFlexibility(i).rejectedOptions.find(o=>o.id==='shift-later');for(const reason of ['minimum_staffing_not_met','working_time_or_rest_violation','qualification_invalid','skill_gap:furnace','direct_grid_bid_forbidden','direct_machine_control_forbidden','direct_bess_control_forbidden','direct_robot_control_forbidden']) assert.ok(x.hardConstraintFailures.includes(reason));});

test('identical authoritative state remains reproducible while material changes alter hash',()=>{const i=baseInput(),a=evaluateEnergyFlexibility(i),b=evaluateEnergyFlexibility(structuredClone(i));assert.equal(a.reproducibilityHash,b.reproducibilityHash);const c=structuredClone(i);c.options[1].labour.premiumCost++;assert.notEqual(a.reproducibilityHash,evaluateEnergyFlexibility(c).reproducibilityHash);});

function lcg(seed){let s=seed>>>0;return()=>((s=Math.imul(1664525,s)+1013904223>>>0)/2**32);}
test('same revision cannot reactivate a cancellation through a later publication',()=>{
  const i=baseInput();
  const cancelled={...i.energySignal,status:'cancelled',publishedAt:'2026-09-18T05:45:00.000Z'};
  i.energyEvents=[cancelled,i.energySignal];
  const a=evaluateEnergyFlexibility(i);
  const b=evaluateEnergyFlexibility({...i,energyEvents:[i.energySignal,cancelled,cancelled]});
  assert.equal(a.eventReduction.conflict,true);
  assert.equal(a.status,'no_safe_or_valuable_flexibility');
  assert.equal(a.reproducibilityHash,b.reproducibilityHash);
  assert.equal(a.rejectedOptions.find(x=>x.id==='shift-later').actionContract,null);
  i.energyEvents.push({...i.energySignal,revision:3});i.latestKnownSignalRevision=3;
  assert.equal(evaluateEnergyFlexibility(i).status,'recommend_options');
});

test('unknown or missing signal status cannot authorize an energy handoff',()=>{
  for(const status of ['pending_confirmation','ACTIVE','',null,undefined]){
    const i=baseInput();i.energySignal.status=status;
    const r=evaluateEnergyFlexibility(i);
    assert.equal(r.status,'no_safe_or_valuable_flexibility');
    assert.ok(r.signalFailures.includes('energy_signal_status_unsupported'));
    assert.equal(r.rejectedOptions.find(x=>x.id==='shift-later').actionContract,null);
  }
});

test('energy lower bound exceeding gross value cannot turn a loss into a handoff',()=>{
  for(const valueBasis of ['point','conservative']){
    const i=baseInput();i.valueBasis=valueBasis;
    Object.assign(i.options[1].energy,{grossSaving:100,flexibilityReward:0,lowerBoundEnergyValue:200});
    i.options[1].labour={premiumCost:150};i.options[1].production={};i.options[1].scheduleChurnCost=0;i.options[1].upperBoundScheduleChurnCost=0;
    const r=evaluateEnergyFlexibility(i),o=r.rejectedOptions.find(x=>x.id==='shift-later');
    assert.equal(o.executable,false);
    assert.ok(o.hardConstraintFailures.includes('invalid_economics:lowerBoundEnergyValue_exceeds_gross'));
    assert.equal(o.actionContract,null);
    i.options[1].energy.lowerBoundEnergyValue=100;
    assert.equal(evaluateEnergyFlexibility(i).rejectedOptions.find(x=>x.id==='shift-later').executable,true);
  }
});
function scenario(index,r){const fresh=r()>0.08,cancelled=r()<0.03,revisionOk=r()>0.04,shiftable=r()>0.15,staffingOk=r()>0.08,skillOk=r()>0.08,restOk=r()>0.04,qualificationOk=r()>0.04,supervisionOk=r()>0.03,serviceOk=r()>0.05,qualityOk=r()>0.03,gross=Math.round(150+r()*1350),reward=Math.round(r()*350),stacking=r()<0.15,uncertainty=0.05+r()*0.35,labour=Math.round(r()*900),labourUpper=labour+Math.round(r()*250),penalty=Math.round(r()*350),penaltyUpper=penalty+Math.round(r()*150),churn=Math.round(r()*140),churnUpper=churn+Math.round(r()*80),energyValue=(stacking?gross+reward:Math.max(gross,reward))*(1-uncertainty),conservative=energyValue-labourUpper-penaltyUpper-churnUpper;const input=baseInput();input.siteId=`site-${index%7}`;input.energySignal.siteId=input.siteId;input.process.siteId=input.siteId;input.options[1].siteId=input.siteId;input.energySignal.status=cancelled?'cancelled':'active';input.energySignal.revision=revisionOk?2:1;input.energySignal.freshUntil=fresh?'2026-09-18T07:00:00.000Z':'2026-09-18T05:50:00.000Z';input.process.flexibilityClass=shiftable?'shiftable':'continuous';Object.assign(input.options[1].workforce,{staffingCount:staffingOk?5:2,minimumStaffing:4,requiredSkills:{critical:1},skillCoverage:{critical:skillOk?1:0},restCompliant:restOk,qualificationsValid:qualificationOk,supervisorRequired:true,supervisorAvailable:supervisionOk});input.options[1].energy={grossSaving:gross,flexibilityReward:reward,valueStackingAllowed:stacking,uncertaintyPct:uncertainty};input.options[1].labour={premiumCost:labour,upperBoundCost:labourUpper};input.options[1].production={penaltyCost:penalty,upperBoundPenalty:penaltyUpper,hardServiceBreach:!serviceOk,qualityRisk:qualityOk?'acceptable':'unacceptable'};input.options[1].scheduleChurnCost=churn;input.options[1].upperBoundScheduleChurnCost=churnUpper;return {input,known:fresh&&!cancelled&&revisionOk&&shiftable&&staffingOk&&skillOk&&restOk&&qualificationOk&&supervisionOk&&serviceOk&&qualityOk&&conservative>0,flexible:fresh&&!cancelled&&revisionOk&&shiftable};}

test('1,500-scenario conservative benchmark preserves safety and value thresholds',()=>{const r=lcg(0x5eed1234);let known=0,found=0,flex=0,better=0,stale=0,hard=0,badActuation=0;for(let i=0;i<1500;i++){const s=scenario(i,r),o=evaluateEnergyFlexibility(s.input);if(s.known){known++;if(o.rankedOptions.length)found++;}if(s.flexible){flex++;if(o.rankedOptions.some(x=>isParetoBetterThanBaseline(x,o.baseline)))better++;}if(!o.signalFresh&&o.rankedOptions.length)stale++;if(o.rankedOptions.some(x=>x.hardConstraintFailures.length))hard++;if(o.rankedOptions.some(x=>x.actionContract?.type!=='workflow_handoff_only'))badActuation++;}const summary={scenarios:1500,knownFeasible:known,discovery:found/known,flexible:flex,paretoBetter:better/flex,staleExecutable:stale,hardViolationRecommended:hard,directActuationOutput:badActuation};console.log('ENERGY_FLEX_BENCHMARK='+JSON.stringify(summary));assert.ok(known>100);assert.ok(found/known>=0.95);assert.equal(stale,0);assert.equal(hard,0);assert.equal(badActuation,0);assert.ok(better/flex>=0.15);});

test('500 adversarial replay/permutation cases preserve effective decision state',()=>{const r=lcg(0x1d3a0707);for(let n=0;n<500;n++){const i=baseInput();const rev1={...i.energySignal,revision:1,publishedAt:'2026-09-18T05:40:00.000Z'},rev2={...i.energySignal};const canonical=structuredClone(i);canonical.energyEvents=[rev1,rev2];delete canonical.energySignal;const expected=evaluateEnergyFlexibility(canonical);const events=[];for(let k=0;k<2+Math.floor(r()*8);k++) events.push(r()<0.65?structuredClone(rev2):structuredClone(rev1));events.push(structuredClone(rev1),structuredClone(rev2));events.sort(()=>r()-0.5);const replay=structuredClone(i);replay.energyEvents=events;delete replay.energySignal;const actual=evaluateEnergyFlexibility(replay);assert.equal(actual.effectiveSignalRevision,2);assert.equal(actual.reproducibilityHash,expected.reproducibilityHash);assert.deepEqual(actual.rankedOptions,expected.rankedOptions);}});

