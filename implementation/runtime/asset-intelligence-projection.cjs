'use strict';

const CONTRACT_VERSION='VECTOR_ASSET_INTELLIGENCE_PROJECTION_V1';
const ASSET_TYPES=Object.freeze({
  people:new Set(['person','role','competency']),
  machines:new Set(['machine','automation','line']),
  materials:new Set(['material','wip','inventory','supplier-capacity']),
  energy:new Set(['energy']),
  tooling:new Set(['tooling','facility']),
  production:new Set(['work-order','order','product','quality-event']),
  finance:new Set(['cash-commitment']),
  knowledge:new Set(['knowledge','training'])
});

function text(v,max=240){return String(v??'').trim().slice(0,max);}
function iso(v){const raw=text(v,80),ms=Date.parse(raw);return raw&&Number.isFinite(ms)?new Date(ms).toISOString():null;}
function classFor(type){for(const [name,types] of Object.entries(ASSET_TYPES)) if(types.has(type)) return name;return null;}
function isStale(node,at,maxAgeMs){const observed=Date.parse(String(node.observedAt||'')),now=Date.parse(at);return !Number.isFinite(observed)||!Number.isFinite(now)||(now-observed)>maxAgeMs;}

function projectAssetIntelligence(revision,options={}){
  if(!revision||!revision.tenant||!revision.revision||!Array.isArray(revision.nodes)||!Array.isArray(revision.edges)) throw new Error('Valid Digital Twin revision is required.');
  const at=iso(options.at||new Date().toISOString());
  if(!at) throw new Error('Valid projection time is required.');
  const maxAgeMs=Number.isFinite(Number(options.maxAgeMs))&&Number(options.maxAgeMs)>0?Number(options.maxAgeMs):24*60*60*1000;
  const relations=new Map();
  for(const edge of revision.edges){
    if(!relations.has(edge.from)) relations.set(edge.from,[]);
    relations.get(edge.from).push({to:edge.to,relation:text(edge.relation,120),verified:edge.verified===true,source:text(edge.source,180)});
  }
  const groups={people:[],machines:[],materials:[],energy:[],tooling:[],production:[],finance:[],knowledge:[]};
  const excluded=[];
  for(const node of revision.nodes){
    const assetClass=classFor(String(node.type||''));
    if(!assetClass){excluded.push(node.id);continue;}
    groups[assetClass].push({
      id:text(node.id,180),type:text(node.type,80),state:text(node.state,80),verified:node.verified===true,
      confidence:Number.isFinite(Number(node.confidence))?Number(node.confidence):null,
      observedAt:iso(node.observedAt),effectiveAt:node.effectiveAt?iso(node.effectiveAt):null,
      stale:isStale(node,at,maxAgeMs),source:text(node.source,180),relations:(relations.get(node.id)||[]).sort((a,b)=>(a.relation+'|'+a.to).localeCompare(b.relation+'|'+b.to))
    });
  }
  for(const items of Object.values(groups)) items.sort((a,b)=>a.id.localeCompare(b.id));
  const summary=Object.fromEntries(Object.entries(groups).map(([name,items])=>[name,{count:items.length,verified:items.filter(x=>x.verified).length,stale:items.filter(x=>x.stale).length}]));
  return Object.freeze({
    contractVersion:CONTRACT_VERSION,tenant:revision.tenant,twinRevision:revision.revision,at,maxAgeMs,assets:groups,summary,excludedNodeIds:excluded.sort(),
    readOnly:true,grantsExecutionAuthority:false,
    claimBoundary:'This is a read-only projection of the existing Digital Twin. It does not replace ERP, MES, CMMS, QMS, payroll, safety or machine-control authority.'
  });
}

module.exports=Object.freeze({CONTRACT_VERSION,ASSET_TYPES,projectAssetIntelligence,classFor});
