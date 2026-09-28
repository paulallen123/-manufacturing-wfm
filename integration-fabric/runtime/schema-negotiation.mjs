import crypto from 'node:crypto';

const CREDENTIAL_NAME_PATTERN=/(^|[_\-.])(api[_-]?key|api[_-]?secret|access[_-]?token|refresh[_-]?token|password|passwd|secret|authorization|private[_-]?key|client[_-]?secret)($|[_\-.])/i;

function nonEmpty(value,name){
  const normalized=String(value??'').trim();
  if(!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function bool(value){ return value===true; }

function canonicalField(field){
  const sourceName=nonEmpty(field.sourceName??field.name,'field.sourceName');
  return {
    sourceName,
    stableId:String(field.stableId??sourceName),
    type:String(field.type??'unknown').toLowerCase(),
    required:bool(field.required),
    repeated:bool(field.repeated),
    sensitive:bool(field.sensitive),
    referenceTarget:field.referenceTarget?String(field.referenceTarget):null,
    unit:field.unit?String(field.unit):null,
    currency:field.currency?String(field.currency).toUpperCase():null
  };
}

function stableJson(value){
  if(Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if(value&&typeof value==='object'){
    return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function observeSchema({provider,objectType,version=null,observedAt=new Date().toISOString(),fields=[]}={}){
  const normalizedFields=fields.map(canonicalField).sort((a,b)=>a.stableId.localeCompare(b.stableId));
  const ids=new Set();
  for(const field of normalizedFields){
    if(ids.has(field.stableId)) throw new TypeError(`duplicate stable field id: ${field.stableId}`);
    ids.add(field.stableId);
  }
  const observed=new Date(observedAt);
  if(Number.isNaN(observed.getTime())) throw new TypeError('observedAt must be an ISO-8601 timestamp');
  const body={
    schemaContractVersion:1,
    provider:nonEmpty(provider,'provider'),
    objectType:nonEmpty(objectType,'objectType'),
    providerSchemaVersion:version===null||version===undefined?null:String(version),
    fields:normalizedFields
  };
  return {
    ...body,
    observedAt:String(observedAt),
    fingerprint:crypto.createHash('sha256').update(stableJson(body)).digest('hex')
  };
}

export function compareSchemas(previous,current){
  if(previous.provider!==current.provider||previous.objectType!==current.objectType){
    throw new TypeError('schemas must describe the same provider and objectType');
  }
  const before=new Map(previous.fields.map(field=>[field.stableId,field]));
  const after=new Map(current.fields.map(field=>[field.stableId,field]));
  const added=[];
  const removed=[];
  const changed=[];

  for(const [id,field] of after){
    if(!before.has(id)) added.push(field);
    else {
      const old=before.get(id);
      const dimensions=['sourceName','type','required','repeated','sensitive','referenceTarget','unit','currency'];
      const delta=dimensions.filter(key=>old[key]!==field[key]);
      if(delta.length) changed.push({stableId:id,dimensions:delta,before:old,after:field});
    }
  }
  for(const [id,field] of before){ if(!after.has(id)) removed.push(field); }

  const breakingReasons=[];
  for(const field of added){ if(field.required) breakingReasons.push(`required-field-added:${field.stableId}`); }
  for(const field of removed){ breakingReasons.push(`field-removed:${field.stableId}`); }
  for(const delta of changed){
    if(delta.dimensions.some(key=>['type','required','repeated','referenceTarget','unit','currency','sourceName'].includes(key))){
      breakingReasons.push(`field-contract-changed:${delta.stableId}`);
    }
    if(delta.before.sensitive===false&&delta.after.sensitive===true){
      breakingReasons.push(`field-became-sensitive:${delta.stableId}`);
    }
  }

  return {
    changed:previous.fingerprint!==current.fingerprint,
    classification:breakingReasons.length?'review-required':(added.length?'additive':'unchanged'),
    added,
    removed,
    changedFields:changed,
    breakingReasons
  };
}

export function captureExtensions(record,{mappedSourceFields=[],schema,maxFields=200}={}){
  if(!schema) throw new TypeError('schema is required');
  const mapped=new Set(mappedSourceFields.map(String));
  const byName=new Map(schema.fields.map(field=>[field.sourceName,field]));
  const extensions={};
  let count=0;
  for(const [key,value] of Object.entries(record||{})){
    if(mapped.has(key)) continue;
    const field=byName.get(key);
    if(!field) continue;
    if(field.sensitive||CREDENTIAL_NAME_PATTERN.test(key)) continue;
    if(count>=maxFields) throw new RangeError('extension field limit exceeded');
    extensions[key]=structuredClone(value);
    count+=1;
  }
  return extensions;
}
