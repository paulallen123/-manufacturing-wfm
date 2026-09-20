const SENSITIVE=/(password|secret|token|credential)/i;
const WILDCARD=/[*?]/;

function text(value,name){
  if(typeof value!=='string'||!value.trim()) throw new Error(name+' must be a non-empty string');
  return value.trim();
}
function cleanList(values,name){
  if(values==null) return Object.freeze([]);
  if(!Array.isArray(values)) throw new Error(name+' must be an array');
  return Object.freeze([...new Set(values.map((v,i)=>text(v,`${name}[${i}]`)))]);
}
function assertExact(values,name){
  for(const value of values) if(WILDCARD.test(value)) throw new Error(name+' must not contain wildcard authority: '+value);
}

export function createGovernedProjectionPolicy(input){
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new Error('projection policy must be an object');
  const provider=text(input.provider,'provider');
  if(!Array.isArray(input.projections)||!input.projections.length) throw new Error('projections must be a non-empty array');
  const seen=new Set();
  const projections=input.projections.map((entry,index)=>{
    if(!entry||typeof entry!=='object'||Array.isArray(entry)) throw new Error(`projections[${index}] must be an object`);
    const id=text(entry.id,`projections[${index}].id`);
    if(WILDCARD.test(id)) throw new Error('projection id must be exact: '+id);
    if(seen.has(id)) throw new Error('duplicate projection id: '+id);
    seen.add(id);
    if(entry.providerReadOnlySemantics!==true) throw new Error('projection '+id+' must prove provider read-only semantics');
    const allowedParameters=cleanList(entry.allowedParameters,`projection ${id} allowedParameters`);
    const allowedFields=cleanList(entry.allowedFields,`projection ${id} allowedFields`);
    assertExact(allowedParameters,'allowedParameters');
    assertExact(allowedFields,'allowedFields');
    for(const field of allowedFields) if(SENSITIVE.test(field)) throw new Error('sensitive field denied in projection '+id+': '+field);
    return Object.freeze({
      id,
      kind:text(entry.kind||'governed-query',`projection ${id} kind`),
      providerReadOnlySemantics:true,
      allowedParameters,
      allowedFields,
      stableIdFields:cleanList(entry.stableIdFields,`projection ${id} stableIdFields`),
      scopeFields:cleanList(entry.scopeFields,`projection ${id} scopeFields`),
      pageMode:entry.pageMode?text(entry.pageMode,`projection ${id} pageMode`):null,
      deltaFields:cleanList(entry.deltaFields,`projection ${id} deltaFields`),
      datasetKind:entry.datasetKind?text(entry.datasetKind,`projection ${id} datasetKind`):'sparse-projection',
      authoritativeForExistence:entry.authoritativeForExistence===true,
      schemaFingerprintRequired:entry.schemaFingerprintRequired!==false
    });
  });
  return Object.freeze({provider,projections:Object.freeze(projections),arbitraryQueryAllowed:false,directSqlAllowed:false,mutationAllowed:false});
}

export function authorizeGovernedProjectionRead({policy,projectionId,parameters={},fields=[]}){
  if(!policy||!Array.isArray(policy.projections)) throw new Error('compiled projection policy required');
  const id=text(projectionId,'projectionId');
  const projection=policy.projections.find(p=>p.id===id);
  if(!projection) throw new Error('projection is not allowlisted: '+id);
  if(!parameters||typeof parameters!=='object'||Array.isArray(parameters)) throw new Error('parameters must be an object');
  for(const key of Object.keys(parameters)){
    if(SENSITIVE.test(key)) throw new Error('sensitive projection parameter denied: '+key);
    if(!projection.allowedParameters.includes(key)) throw new Error('projection parameter is not allowlisted: '+key);
  }
  const requested=cleanList(fields,'fields');
  for(const field of requested){
    if(SENSITIVE.test(field)) throw new Error('sensitive projection field denied: '+field);
    if(projection.allowedFields.length&&!projection.allowedFields.includes(field)) throw new Error('projection field is not allowlisted: '+field);
  }
  return Object.freeze({provider:policy.provider,projectionId:id,kind:projection.kind,parameters:Object.freeze({...parameters}),fields:requested,datasetKind:projection.datasetKind,authoritativeForExistence:projection.authoritativeForExistence,schemaFingerprintRequired:projection.schemaFingerprintRequired,stableIdFields:projection.stableIdFields,scopeFields:projection.scopeFields,mutationAllowed:false,arbitraryQueryAllowed:false,directSqlAllowed:false});
}

export function assessProjectionPageChain({pages,finalPageReached,scopeProven=false,reconciliationComplete=false,datasetKind='sparse-projection',authoritativeForExistence=false}){
  if(!Array.isArray(pages)||!pages.length) throw new Error('pages must be a non-empty array');
  const ordinals=[];
  const ids=new Set();
  for(let i=0;i<pages.length;i++){
    const page=pages[i];
    if(!page||typeof page!=='object'||Array.isArray(page)) throw new Error('page '+i+' must be an object');
    if(!Number.isInteger(page.ordinal)||page.ordinal<0) throw new Error('page ordinal must be a non-negative integer');
    const pageId=text(page.pageId,'pageId');
    if(ids.has(pageId)) throw new Error('duplicate page detected: '+pageId);
    ids.add(pageId);
    ordinals.push(page.ordinal);
    if(page.error) throw new Error('projection page chain contains an error');
  }
  ordinals.sort((a,b)=>a-b);
  for(let i=0;i<ordinals.length;i++) if(ordinals[i]!==i) throw new Error('projection page gap detected at ordinal '+i);
  const complete=finalPageReached===true;
  const canInferAbsence=complete&&scopeProven===true&&reconciliationComplete===true&&datasetKind==='complete-snapshot'&&authoritativeForExistence===true;
  return Object.freeze({pageCount:pages.length,complete,scopeProven:scopeProven===true,reconciliationComplete:reconciliationComplete===true,canInferAbsence,checkpointMayAdvance:complete,missingRecordDisposition:canInferAbsence?'tombstone-candidate':'do-not-delete'});
}
