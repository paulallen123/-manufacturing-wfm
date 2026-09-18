import test from 'node:test';
import assert from 'node:assert/strict';
import {bindMeasuredProfileEconomics,evaluateEnergyFlexibilityProfileAware} from '../../src/frontier/energy-profile-binding.mjs';

const NOW='2026-09-18T08:00:00.000Z';
const segmentMeta={qualityScore:0.95,sourceId:'synthetic-meter-tariff',observedAt:'2026-09-18T07:55:00.000Z',freshUntil:'2026-09-18T09:00:00.000Z'};
const seg=(kind,durationMinutes,powerKw,unitPricePerKwh,extra={})=>({kind,durationMinutes,powerKw,unitPricePerKwh,...segmentMeta,...extra});

function baseInput(){
  return {
    now:NOW,
    tenantId:'synthetic-tenant',
    siteId:'synthetic-site',
    minimumNetBenefit:0,
    latestKnownSignalRevision:2,
    energySignal:{tenantId:'synthetic-tenant',siteId:'synthetic-site',status:'active',revision:2,type:'turn_down',publishedAt:'2026-09-18T07:50:00.000Z',freshUntil:'2026-09-18T09:00:00.000Z',windowEnd:'2026-09-18T10:00:00.000Z',acceptanceDeadline:'2026-09-18T08:30:00.000Z',confidence:0.98},
    process:{tenantId:'synthetic-tenant',siteId:'synthetic-site',flexibilityClass:'shiftable',batchContinuityRequired:false,stateFresh:true,confidence:0.95},
    options:[
      {id:'baseline',kind:'do_nothing',workforce:{staffingCount:5,minimumStaffing:4,restCompliant:true,qualificationsValid:true,confidence:1},energy:{},labour:{},production:{},scheduleChurnCost:0},
      {id:'shift-later',kind:'shift_later',tenantId:'synthetic-tenant',siteId:'synthetic-site',approvalRequired:true,shiftMinutes:60,workforce:{staffingCount:5,minimumStaffing:4,restCompliant:true,qualificationsValid:true,supervisorRequired:true,supervisorAvailable:true,requiredSkills:{furnace:1},skillCoverage:{furnace:2},confidence:0.97},energy:{grossSaving:1000,flexibilityReward:0,uncertaintyPct:0.1,profileEvidence:{tenantId:'synthetic-tenant',siteId:'synthetic-site',uncertaintyPct:0.1,baseline:[seg('run',60,200,0.20)],candidate:[seg('run',60,200,0.18)]}},labour:{premiumCost:10,upperBoundCost:10},production:{penaltyCost:0,upperBoundPenalty:0,hardServiceBreach:false,qualityRisk:'acceptable'},scheduleChurnCost:0,upperBoundScheduleChurnCost:0,controls:{}}
    ]
  };
}

test('measured profile economics override an optimistic headline saving',()=>{
  const input=baseInput();
  const binding=bindMeasuredProfileEconomics(input);
  assert.equal(binding.valid,true);
  assert.equal(binding.evidence[0].headlineGrossSaving,1000);
  assert.ok(Math.abs(binding.evidence[0].derivedAvoidedEnergyCost-4)<1e-9);
  assert.ok(Math.abs(binding.input.options[1].energy.grossSaving-4)<1e-9);
  const result=evaluateEnergyFlexibilityProfileAware(input);
  assert.equal(result.status,'no_safe_or_valuable_flexibility');
  assert.equal(result.rankedOptions.length,0);
});

test('transition energy can erase a cheap-tariff opportunity before it reaches ranking',()=>{
  const input=baseInput();
  input.options[1].energy.profileEvidence.baseline=[seg('run',60,100,0.20)];
  input.options[1].energy.profileEvidence.candidate=[seg('warmup',75,100,0.10),seg('run',60,100,0.10)];
  input.options[1].labour={premiumCost:0,upperBoundCost:0};
  const result=evaluateEnergyFlexibilityProfileAware(input);
  assert.equal(result.profileBindingValid,true);
  assert.equal(result.profileEvidence[0].derivedAvoidedEnergyCost,0);
  assert.ok(result.profileEvidence[0].transitionEnergyKwh>100);
  assert.equal(result.status,'no_safe_or_valuable_flexibility');
});

test('stale measured profiles fail closed rather than falling back to headline savings',()=>{
  const input=baseInput();
  input.options[1].energy.profileEvidence.candidate[0].freshUntil='2026-09-18T07:59:59.000Z';
  const result=evaluateEnergyFlexibilityProfileAware(input);
  assert.equal(result.status,'input_rejected');
  assert.equal(result.profileBindingValid,false);
  assert.ok(result.profileBindingFailures.some(reason=>reason.includes('candidate:segment_0:stale')));
  assert.equal(result.rankedOptions.length,0);
});

test('profile evidence must carry the same tenant and site scope as the decision',()=>{
  for(const mutate of [e=>delete e.tenantId,e=>e.tenantId='other',e=>delete e.siteId,e=>e.siteId='other']){
    const input=baseInput();
    mutate(input.options[1].energy.profileEvidence);
    const result=evaluateEnergyFlexibilityProfileAware(input);
    assert.equal(result.status,'input_rejected');
    assert.equal(result.rankedOptions.length,0);
    assert.ok(result.profileBindingFailures.some(reason=>reason.includes('tenant_')||reason.includes('site_')));
  }
});

test('profile-derived savings remain non-stackable with rewards by default',()=>{
  const input=baseInput();
  input.options[1].energy.flexibilityReward=50;
  input.options[1].labour={premiumCost:0,upperBoundCost:0};
  const binding=bindMeasuredProfileEconomics(input);
  assert.equal(binding.valid,true);
  assert.equal(binding.input.options[1].energy.valueStackingAllowed,false);
  const result=evaluateEnergyFlexibilityProfileAware(input);
  const option=result.rankedOptions.find(item=>item.id==='shift-later');
  assert.ok(option);
  assert.equal(option.economics.grossEnergyValue,50);
  assert.equal(option.economics.doubleCountGuardApplied,true);
});

test('legacy hardened path still works when no measured profile is supplied',()=>{
  const input=baseInput();
  delete input.options[1].energy.profileEvidence;
  input.options[1].energy.grossSaving=700;
  const result=evaluateEnergyFlexibilityProfileAware(input);
  assert.equal(result.profileBindingValid,true);
  assert.equal(result.profileEvidence.length,0);
  assert.equal(result.status,'recommend_options');
});

test('accepted lower-quality profile cannot self-declare zero uncertainty',()=>{
  const input=baseInput();
  input.options[1].energy.profileEvidence.uncertaintyPct=0;
  input.options[1].energy.profileEvidence.baseline=[seg('run',60,100,0.20,{qualityScore:0.8})];
  input.options[1].energy.profileEvidence.candidate=[seg('run',60,100,0.10,{qualityScore:0.8})];
  input.options[1].labour={premiumCost:9,upperBoundCost:9};
  const binding=bindMeasuredProfileEconomics(input);
  assert.equal(binding.valid,true);
  assert.equal(binding.evidence[0].declaredUncertaintyPct,0);
  assert.ok(Math.abs(binding.evidence[0].fixedUncertaintyFloorPct-0.2)<1e-9);
  assert.ok(Math.abs(binding.input.options[1].energy.lowerBoundEnergyValue-8)<1e-9);
  assert.equal(binding.evidence[0].uncertaintyFloorApplied,true);
  const result=evaluateEnergyFlexibilityProfileAware(input);
  assert.equal(result.status,'no_safe_or_valuable_flexibility');
  assert.equal(result.rankedOptions.length,0);
});

test('high profile quality does not imply calibrated low value uncertainty',()=>{
  const input=baseInput();
  input.options[1].energy.profileEvidence.uncertaintyPct=0;
  input.options[1].energy.profileEvidence.baseline=[seg('run',60,100,0.20,{qualityScore:1})];
  input.options[1].energy.profileEvidence.candidate=[seg('run',60,100,0.10,{qualityScore:1})];
  const binding=bindMeasuredProfileEconomics(input);
  assert.equal(binding.valid,true);
  assert.equal(binding.evidence[0].qualityImpliedUncertaintyPct,0);
  assert.ok(Math.abs(binding.evidence[0].effectiveUncertaintyPct-0.2)<1e-9);
  assert.equal(binding.evidence[0].uncertaintyPolicy,'fixed_floor_until_adapter_calibration');
});

test('declared uncertainty above the fixed floor remains authoritative',()=>{
  const input=baseInput();
  input.options[1].energy.profileEvidence.uncertaintyPct=0.25;
  const binding=bindMeasuredProfileEconomics(input);
  assert.equal(binding.valid,true);
  assert.ok(Math.abs(binding.evidence[0].fixedUncertaintyFloorPct-0.2)<1e-9);
  assert.equal(binding.evidence[0].effectiveUncertaintyPct,0.25);
  assert.equal(binding.evidence[0].uncertaintyFloorApplied,false);
});

test('fixed admission-threshold floor is safer than uncalibrated quality mapping under uniform worst-case downside',()=>{
  let adaptiveOnly=0;
  let adaptiveFalsePositives=0;
  let fixedFalsePositives=0;
  for(let quality=0.8;quality<=1.0001;quality+=0.02){
    for(let declared=0;declared<=0.2001;declared+=0.05){
      const adaptiveUncertainty=Math.max(declared,1-quality);
      const fixedUncertainty=Math.max(declared,0.2);
      for(const gross of [20,40,60,80,100,150,200]){
        for(const cost of [0,10,20,40,60,80,100,120,150]){
          const adaptiveRecommends=gross*(1-adaptiveUncertainty)-cost>0;
          const fixedRecommends=gross*(1-fixedUncertainty)-cost>0;
          const uniformWorstCaseNet=gross*0.8-cost;
          if(adaptiveRecommends&&!fixedRecommends) adaptiveOnly+=1;
          if(adaptiveRecommends&&uniformWorstCaseNet<=0) adaptiveFalsePositives+=1;
          if(fixedRecommends&&uniformWorstCaseNet<=0) fixedFalsePositives+=1;
        }
      }
    }
  }
  assert.ok(adaptiveOnly>0);
  assert.ok(adaptiveFalsePositives>0);
  assert.equal(fixedFalsePositives,0);
});
