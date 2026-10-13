'use strict';

const EVIDENCE_TYPES=Object.freeze(['stated','revealed','operational','economic']);
const SOURCE_TYPES=Object.freeze([
  'product-telemetry','support','implementation','training-search','workflow-abandonment',
  'manual-override','integration-failure','sales','win-loss','churn','expansion','rfp',
  'design-partner','voc','plant-observation','workaround','practitioner','competitor'
]);
const SILENT_SOURCES=new Set(['workaround','manual-override','workflow-abandonment','integration-failure','training-search']);

function text(value,max=240){ return String(value??'').trim().slice(0,max); }
function iso(value){ const raw=text(value,80),ms=Date.parse(raw); if(!raw||!Number.isFinite(ms)) throw new Error('Valid observedAt is required.'); return new Date(ms).toISOString(); }
function score(value,name,max=5){ if(typeof value!=='number'||!Number.isFinite(value)) throw new Error(`${name} must be a finite number.`); if(value<0||value>max) throw new Error(`${name} must be between 0 and ${max}.`); return value; }
function ratio(value,name){ return score(value,name,1); }
function list(value,max=20,maxLen=160){ return Array.isArray(value)?[...new Set(value.map(v=>text(v,maxLen)).filter(Boolean))].slice(0,max):[]; }

function normaliseDemandSignal(input={}){
  const signalId=text(input.signalId,160),decisionKey=text(input.decisionKey,160),persona=text(input.persona,120);
  const sourceType=text(input.sourceType,80).toLowerCase(),evidenceType=text(input.evidenceType,40).toLowerCase();
  if(!signalId||!decisionKey||!persona) throw new Error('signalId, decisionKey and persona are required.');
  if(!SOURCE_TYPES.includes(sourceType)) throw new Error('Unsupported sourceType.');
  if(!EVIDENCE_TYPES.includes(evidenceType)) throw new Error('Unsupported evidenceType.');
  const outcomeKpis=list(input.outcomeKpis,12,120);
  const falsification=text(input.falsification,500);
  if(!outcomeKpis.length||!falsification) throw new Error('Demand signal requires outcomeKpis and a falsification criterion.');
  return Object.freeze({
    signalId,
    accountRef:text(input.accountRef,160)||null,
    segment:text(input.segment,120)||'unknown',
    persona,
    manufacturingArchetype:text(input.manufacturingArchetype,120)||'unknown',
    geography:text(input.geography,120)||'unknown',
    decisionKey,
    sourceType,evidenceType,
    observedAt:iso(input.observedAt),
    silentDemand:SILENT_SOURCES.has(sourceType),
    mandatory:input.mandatory===true,
    severity:score(input.severity??0,'severity'),
    frequency:score(input.frequency??0,'frequency'),
    economicImpact:score(input.economicImpact??0,'economicImpact'),
    productionImpact:score(input.productionImpact??0,'productionImpact'),
    adminImpact:score(input.adminImpact??0,'adminImpact'),
    evidenceConfidence:ratio(input.evidenceConfidence??0,'evidenceConfidence'),
    strategicFit:ratio(input.strategicFit??0,'strategicFit'),
    differentiation:ratio(input.differentiation??0,'differentiation'),
    reusePotential:ratio(input.reusePotential??0,'reusePotential'),
    integrationReadiness:ratio(input.integrationReadiness??0,'integrationReadiness'),
    outcomeProvability:ratio(input.outcomeProvability??0,'outcomeProvability'),
    implementationEffort:score(input.implementationEffort??5,'implementationEffort'),
    adoptionBurden:score(input.adoptionBurden??5,'adoptionBurden'),
    risk:score(input.risk??0,'risk'),
    reversible:input.reversible===true,
    workaround:text(input.workaround,500)||null,
    outcomeKpis,
    falsification
  });
}
function aggregateProblem(signals){
  const decisionKey=signals[0].decisionKey;
  const accounts=new Set(signals.map(s=>s.accountRef).filter(Boolean));
  const segments=new Set(signals.map(s=>s.segment));
  const personas=new Set(signals.map(s=>s.persona));
  const avg=key=>signals.reduce((sum,s)=>sum+s[key],0)/signals.length;
  const max=key=>Math.max(...signals.map(s=>s[key]));
  const mandatory=signals.some(s=>s.mandatory);
  const independence=mandatory?1:Math.min(1,Math.max(0.25,accounts.size/3));
  const evidenceStrength=Math.min(1,avg('evidenceConfidence')*(0.5+0.5*independence));
  const benefit=
    0.15*(avg('severity')/5)+0.12*(avg('frequency')/5)+0.16*(avg('economicImpact')/5)+
    0.16*(avg('productionImpact')/5)+0.08*(avg('adminImpact')/5)+0.08*avg('strategicFit')+
    0.08*avg('differentiation')+0.06*avg('reusePotential')+0.06*avg('integrationReadiness')+
    0.05*avg('outcomeProvability');
  const burden=0.05*(avg('implementationEffort')/5)+0.03*(avg('adoptionBurden')/5)+0.02*(avg('risk')/5);
  let priority=(benefit-burden)*evidenceStrength;
  if(mandatory) priority=Math.max(priority,0.75+0.05*(max('risk')/5));
  return Object.freeze({
    decisionKey,
    priority:Number(Math.max(0,Math.min(1,priority)).toFixed(6)),
    evidenceStrength:Number(evidenceStrength.toFixed(6)),
    independentAccounts:accounts.size,
    segments:[...segments].sort(),
    personas:[...personas].sort(),
    signalCount:signals.length,
    silentDemandSignals:signals.filter(s=>s.silentDemand).length,
    mandatory,
    reversibleRate:Number((signals.filter(s=>s.reversible).length/signals.length).toFixed(6)),
    outcomeKpis:[...new Set(signals.flatMap(s=>s.outcomeKpis))].sort(),
    evidenceBoundary:accounts.size<=1&&!mandatory?'SINGLE_ACCOUNT_LIMITED':'MULTI_SIGNAL'
  });
}
function rankDemandProblems(inputs=[]){
  const signals=inputs.map(normaliseDemandSignal);
  const groups=new Map();
  for(const signal of signals){
    if(!groups.has(signal.decisionKey)) groups.set(signal.decisionKey,[]);
    groups.get(signal.decisionKey).push(signal);
  }
  return [...groups.values()].map(aggregateProblem)
    .sort((a,b)=>b.priority-a.priority||b.evidenceStrength-a.evidenceStrength||a.decisionKey.localeCompare(b.decisionKey));
}
module.exports=Object.freeze({EVIDENCE_TYPES,SOURCE_TYPES,SILENT_SOURCES,normaliseDemandSignal,rankDemandProblems});
