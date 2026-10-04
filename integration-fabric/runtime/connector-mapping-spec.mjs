import {createHash} from 'node:crypto';

const CREDENTIAL=/(authorization|password|passwd|secret|token|api[_-]?key|client[_-]?secret|cookie|private[_-]?key)/i;
const WORKER_FIELDS=new Set(['externalId','employeeNumber','displayName','siteExternalId','departmentExternalId','active']);
const EVENT_FIELDS=new Set(['eventId','occurredAt','sourceRecordId','siteExternalId']);
const PATH_SEGMENT=/^[A-Za-z0-9_-]{1,80}$/;
const FORBIDDEN_SEGMENTS=new Set(['__proto__','prototype','constructor']);

function fail(message,code='WFM_MAPPING_SPEC_INVALID'){const e=new Error(message);e.code=code;throw e;}
function text(value,name,max=256){
  if(typeof value!=='string'||!value.trim()) fail(name+' is required');
  const v=value.normalize('NFC').trim();
  if(v.length>max||/[\u0000-\u001f\u007f]/.test(v)) fail(name+' is invalid');
  return v;
}
function plain(value,name){
  if(!value||typeof value!=='object'||Array.isArray(value)||(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)) fail(name+' must be a plain object');
  return value;
}
function canonical(value){
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
const sha256=value=>createHash('sha256').update(canonical(value)).digest('hex');
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function scalar(value,path){
  if(value===null||['string','number','boolean'].includes(typeof value)){
    if(typeof value==='number'&&!Number.isFinite(value)) fail(path+' contains non-finite number');
    return value;
  }
  fail(path+' must be a scalar');
}
function sourcePath(value,name){
  const raw=text(value,name,320);
  const parts=raw.split('.');
  if(!parts.length||parts.some(p=>!PATH_SEGMENT.test(p)||FORBIDDEN_SEGMENTS.has(p))) fail(name+' contains unsafe path segment');
  if(parts.some(p=>CREDENTIAL.test(p))) fail(name+' references credential-like source field');
  return parts;
}
function mappingKey(value,name){
  const v=text(value,name,80);
  if(!/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(v)||CREDENTIAL.test(v)) fail(name+' is unsafe');
  return v;
}
function expression(raw,path,depth=0){
  if(depth>8) fail(path+' expression depth exceeded');
  const x=plain(raw,path);
  const kinds=['path','literal','concat','map'].filter(k=>Object.hasOwn(x,k));
  if(kinds.length!==1) fail(path+' must define exactly one expression type');
  const kind=kinds[0];
  if(kind==='literal') return {literal:scalar(x.literal,path+'.literal')};
  if(kind==='path'){
    const out={path:sourcePath(x.path,path+'.path'),kind:text(x.kind||'string',path+'.kind',40),optional:x.optional===true};
    if(!['string','id','number','boolean','date','raw-scalar'].includes(out.kind)) fail(path+'.kind unsupported');
    return out;
  }
  if(kind==='concat'){
    if(!Array.isArray(x.concat)||x.concat.length<1||x.concat.length>12) fail(path+'.concat must contain 1-12 expressions');
    return {
      concat:x.concat.map((v,i)=>expression(v,path+'.concat['+i+']',depth+1)),
      separator:x.separator===undefined?' ':String(x.separator).slice(0,16),
      optional:x.optional===true
    };
  }
  const m=plain(x.map,path+'.map');
  const out={map:{path:sourcePath(m.path,path+'.map.path'),cases:[],optional:x.optional===true}};
  if(!Array.isArray(m.cases)||!m.cases.length||m.cases.length>32) fail(path+'.map.cases must contain 1-32 cases');
  for(let i=0;i<m.cases.length;i++){
    const c=plain(m.cases[i],path+'.map.cases['+i+']');
    if(!Array.isArray(c.values)||!c.values.length||c.values.length>32) fail(path+'.map.cases['+i+'].values required');
    out.map.cases.push({values:c.values.map((v,j)=>scalar(v,path+'.map.cases['+i+'].values['+j+']')),output:scalar(c.output,path+'.map.cases['+i+'].output')});
  }
  if(Object.hasOwn(m,'default')) out.map.default=scalar(m.default,path+'.map.default');
  return out;
}
function normalizeMap(input,name,allowedKeys=null){
  const raw=plain(input||{},name),out={};
  for(const [key,value] of Object.entries(raw)){
    if(allowedKeys&&!allowedKeys.has(key)) fail(name+' contains unsupported canonical field '+key);
    const safe=allowedKeys?key:mappingKey(key,name+' key');
    out[safe]=expression(value,name+'.'+safe);
  }
  return out;
}
function getPath(record,parts){
  let value=record;
  for(const part of parts){
    if(!value||typeof value!=='object'||Array.isArray(value)||!Object.hasOwn(value,part)) return undefined;
    value=value[part];
  }
  return value;
}
function normalizeString(value,kind,name){
  if(value===undefined||value===null) return undefined;
  if(kind==='raw-scalar'){
    if(!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value)) fail(name+' is not scalar');
    return value;
  }
  if(kind==='number'){
    const n=Number(value);
    if(!Number.isFinite(n)) fail(name+' is not numeric');
    return n;
  }
  if(kind==='boolean'){
    if(typeof value!=='boolean') fail(name+' is not boolean');
    return value;
  }
  if(kind==='date'){
    const d=new Date(value);
    if(!Number.isFinite(d.getTime())) fail(name+' is not a valid date');
    return d.toISOString();
  }
  const s=String(value).normalize('NFC').trim();
  if(kind==='id'&&!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(s)) fail(name+' is not a valid identity');
  return s;
}
function sameScalar(a,b){return typeof a===typeof b&&Object.is(a,b)||String(a)===String(b);}
function evaluate(expr,record,path){
  if(Object.hasOwn(expr,'literal')) return expr.literal;
  if(expr.path){
    const value=getPath(record,expr.path);
    if(value===undefined||value===null||value===''){
      if(expr.optional) return undefined;
      fail(path+' required source value is missing','WFM_MAPPING_SOURCE_INVALID');
    }
    return normalizeString(value,expr.kind,path);
  }
  if(expr.concat){
    const values=expr.concat.map((item,i)=>evaluate(item,record,path+'.concat['+i+']')).filter(v=>v!==undefined&&v!==null&&String(v)!=='');
    if(!values.length){
      if(expr.optional) return undefined;
      fail(path+' concat produced no value','WFM_MAPPING_SOURCE_INVALID');
    }
    return values.join(expr.separator).trim();
  }
  const value=getPath(record,expr.map.path);
  if(value===undefined||value===null){
    if(expr.map.optional||expr.optional) return undefined;
    fail(path+' mapped source value is missing','WFM_MAPPING_SOURCE_INVALID');
  }
  for(const c of expr.map.cases) if(c.values.some(v=>sameScalar(v,value))) return c.output;
  if(Object.hasOwn(expr.map,'default')) return expr.map.default;
  if(expr.map.optional||expr.optional) return undefined;
  fail(path+' mapped source value is outside reviewed cases','WFM_MAPPING_SOURCE_INVALID');
}
function assertReceipt(receipt,providerId){
  plain(receipt,'receipt');
  if(receipt.providerId!==providerId||receipt.readOnly!==true||receipt.checkpointAdvanceAllowed!==false) fail('mapping requires exact read-only provider receipt','WFM_MAPPING_RECEIPT_INVALID');
  const observedAt=text(receipt.observedAt,'receipt.observedAt',40);
  if(!Number.isFinite(Date.parse(observedAt))) fail('receipt.observedAt invalid');
  return observedAt;
}

export function defineCanonicalMappingSpec(raw){
  const x=plain(raw,'mapping');
  if(x.schemaVersion!==1) fail('mapping.schemaVersion must be 1');
  const canonicalType=text(x.canonicalType,'canonicalType',40);
  if(!['worker','canonical-event'].includes(canonicalType)) fail('unsupported canonicalType');
  const providerId=text(x.providerId,'providerId',128),id=text(x.id,'id',128),sourceObjectType=text(x.sourceObjectType,'sourceObjectType',128);
  const fields=normalizeMap(x.fields,'fields',canonicalType==='worker'?WORKER_FIELDS:EVENT_FIELDS);
  if(canonicalType==='worker'&&!fields.externalId) fail('worker mapping requires externalId');
  if(canonicalType==='canonical-event'&&!fields.sourceRecordId) fail('canonical-event mapping requires sourceRecordId');
  if(canonicalType==='canonical-event'&&!fields.occurredAt) fail('canonical-event mapping requires occurredAt');
  const extraName=canonicalType==='worker'?'attributes':'payload';
  const extras=normalizeMap(x[extraName]||{},extraName,null);
  const fixed={};
  if(canonicalType==='canonical-event') fixed.eventType=text(x.eventType,'eventType',128);
  const material={schemaVersion:1,id,providerId,sourceObjectType,canonicalType,fields,[extraName]:extras,...fixed};
  return freeze({...material,mappingFingerprint:'sha256:'+sha256(material)});
}

export function mapCanonicalRecord({spec,providerId,sourceRecord,receipt}={}){
  const s=spec?.mappingFingerprint?spec:defineCanonicalMappingSpec(spec);
  if(providerId!==s.providerId) fail('mapping provider mismatch','WFM_MAPPING_BINDING_MISMATCH');
  const observedAt=assertReceipt(receipt,providerId);
  const record=plain(sourceRecord,'sourceRecord');
  const fields={};
  for(const [key,expr] of Object.entries(s.fields)){
    const value=evaluate(expr,record,'fields.'+key);
    if(value!==undefined) fields[key]=value;
  }
  if(s.canonicalType==='worker'){
    const attributes={sourceSystem:providerId,sourceObservedAt:observedAt,mappingFingerprint:s.mappingFingerprint};
    for(const [key,expr] of Object.entries(s.attributes||{})){
      const value=evaluate(expr,record,'attributes.'+key);
      if(value!==undefined) attributes[key]=value;
    }
    return freeze({...fields,attributes});
  }
  const payload={mappingFingerprint:s.mappingFingerprint};
  for(const [key,expr] of Object.entries(s.payload||{})){
    const value=evaluate(expr,record,'payload.'+key);
    if(value!==undefined) payload[key]=value;
  }
  const sourceRecordId=text(fields.sourceRecordId,'sourceRecordId',256);
  const eventId=fields.eventId||providerId+':'+s.eventType+':'+sourceRecordId+':'+sha256(payload).slice(0,24);
  return freeze({
    eventId,eventType:s.eventType,occurredAt:fields.occurredAt,sourceSystem:providerId,sourceRecordId,
    ...(fields.siteExternalId?{siteExternalId:fields.siteExternalId}:{}),payload
  });
}
