import crypto from 'node:crypto';
import profile from './company-profile.json' with { type: 'json' };
import catalog from './scenario-catalog.json' with { type: 'json' };

const clone=value=>structuredClone(value);
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function seededNumber(seed,index,min,max){
  const h=hash([String(seed),index]);
  const n=parseInt(h.slice(0,12),16)/0xffffffffffff;
  return min+n*(max-min);
}

export function buildCompanySnapshot({seed='northstar-v1'}={}){
  const archetypes=profile.estate.archetypes;
  const sites=[];
  let siteNo=1;
  for(const archetype of archetypes){
    const perSite=Math.floor(archetype.employees/archetype.sites);
    let remainder=archetype.employees-perSite*archetype.sites;
    for(let i=0;i<archetype.sites;i++){
      const employees=perSite+(remainder-- >0?1:0);
      const country=profile.estate.countries[(siteNo-1)%profile.estate.countries.length];
      sites.push({
        siteId:'NS-'+String(siteNo).padStart(3,'0'),
        archetype:archetype.id,
        country,
        employees,
        absenceRate:Number(seededNumber(seed,siteNo,0.025,0.085).toFixed(4)),
        planAttainmentPct:Number(seededNumber(seed,siteNo+100,88,101).toFixed(2)),
        agencyShare:Number(seededNumber(seed,siteNo+200,0.01,0.19).toFixed(4)),
        integrationHealth:Number(seededNumber(seed,siteNo+300,0.94,1).toFixed(4))
      });
      siteNo++;
    }
  }
  const totalEmployees=sites.reduce((n,s)=>n+s.employees,0);
  if(sites.length!==profile.estate.sites||totalEmployees!==profile.workforce.employees) throw new Error('NORTHSTAR_PROFILE_SCALE_MISMATCH');
  const core={companyId:profile.companyId,revision:profile.baselineRevision,seed,fictional:true,sites,systems:profile.systems};
  return Object.freeze({...core,snapshotDigest:hash(core)});
}

export function getScenario(id){
  const scenario=catalog.scenarios.find(item=>item.id===id);
  if(!scenario) throw new Error('NORTHSTAR_SCENARIO_NOT_FOUND');
  return clone(scenario);
}

export function createScenarioRun({scenarioId,seed='northstar-v1',mode='LOCAL_SIMULATION',vectorSourceIdentity=null}={}){
  if(!['LOCAL_SIMULATION','VECTOR_SHADOW','VECTOR_TEST_TENANT'].includes(mode)) throw new Error('NORTHSTAR_MODE_INVALID');
  const snapshot=buildCompanySnapshot({seed});
  const scenario=getScenario(scenarioId);
  const eventDigests=scenario.inject.map((event,index)=>hash({scenarioId,event,index,seed,snapshot:snapshot.snapshotDigest}));
  const core={
    recordType:'northstar-scenario-run',
    companyRevision:snapshot.revision,
    companySnapshotDigest:snapshot.snapshotDigest,
    scenarioId,
    scenarioFamily:scenario.family,
    severity:scenario.severity,
    seed,
    mode,
    vectorSourceIdentity:mode==='LOCAL_SIMULATION'?null:vectorSourceIdentity,
    injectedEvents:clone(scenario.inject),
    eventDigests,
    expected:clone(scenario.expect),
    authority:{
      production:false,
      customerTenant:false,
      payrollRelease:false,
      publishedSchedule:false,
      policyOverride:false
    },
    claimBoundary:'Fictional Northstar scenario. Simulated or test-tenant results are not realised customer ROI.'
  };
  return Object.freeze({...core,runDigest:hash(core)});
}

export function compareObserved(run,observed=[]){
  const observedText=observed.map(String);
  const missing=run.expected.filter(item=>!observedText.some(value=>value.toLowerCase().includes(String(item).toLowerCase())));
  const core={
    recordType:'northstar-vector-evidence-receipt',
    runDigest:run.runDigest,
    companyRevision:run.companyRevision,
    scenarioId:run.scenarioId,
    seed:run.seed,
    mode:run.mode,
    vectorSourceIdentity:run.vectorSourceIdentity,
    expected:run.expected,
    observed:observedText,
    missing,
    pass:missing.length===0,
    claimBoundary:run.claimBoundary
  };
  return Object.freeze({...core,receiptDigest:hash(core)});
}

export function scenarioPortfolio(){
  return clone(catalog.scenarios.map(({id,family,severity,inject,expect})=>({id,family,severity,eventCount:inject.length,expectedControlCount:expect.length})));
}
