import {createHash} from 'node:crypto';
import {buildBoundProviderReadPlan} from './provider-read-requests.mjs';

const METHODS=new Set(['GET','HEAD','POST']);
const ADAPTERS=new Set(['http-json','odata']);
const CREDENTIAL=/(authorization|password|secret|token|api[_-]?key|client[_-]?secret|cookie)/i;
const BAD_HEADER=/^(authorization|proxy-authorization|cookie|host|content-length|connection|transfer-encoding|upgrade|x-forwarded-|forwarded$)/i;

function fail(message,code='WFM_CONNECTOR_RECIPE_INVALID'){const e=new Error(message);e.code=code;throw e;}
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
const fingerprint=value=>'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function inert(value,path='value',depth=0){
  if(depth>24) fail(path+' exceeds nesting limit');
  if(value===null||typeof value==='string'||typeof value==='boolean') return value;
  if(typeof value==='number'){if(!Number.isFinite(value)) fail(path+' contains non-finite number');return value;}
  if(Array.isArray(value)) return value.map((v,i)=>inert(v,path+'['+i+']',depth+1));
  plain(value,path);
  const out={};
  for(const [k,v] of Object.entries(value)){if(CREDENTIAL.test(k)) fail(path+' contains credential-like field '+k);out[k]=inert(v,path+'.'+k,depth+1);}
  return out;
}
function segment(value,name){
  const v=text(value,name,180);
  if(v==='.'||v==='..'||/[\\/?#]/.test(v)) fail(name+' must be one exact path segment');
  return v;
}
function queryName(value,name){
  const v=text(value,name,80);
  if(!/^[A-Za-z0-9_$.-]+$/.test(v)) fail(name+' contains invalid characters');
  return v;
}
function param(raw,path){
  const d=plain(raw,path);
  const kind=text(d.kind||'id',path+'.kind',40);
  if(!['id','integer','boolean','enum','text'].includes(kind)) fail(path+'.kind unsupported');
  const out={name:text(d.name,path+'.name',80),kind,required:d.required!==false};
  if(kind==='integer'){
    out.min=d.min===undefined?0:Number(d.min);out.max=d.max===undefined?Number.MAX_SAFE_INTEGER:Number(d.max);
    if(!Number.isSafeInteger(out.min)||!Number.isSafeInteger(out.max)||out.min>out.max) fail(path+' integer bounds invalid');
  }
  if(kind==='enum'){
    if(!Array.isArray(d.values)||!d.values.length) fail(path+'.values required');
    out.values=[...new Set(d.values.map((v,i)=>text(v,path+'.values['+i+']',120)))];
  }
  if(kind==='text'){
    out.maxLength=d.maxLength===undefined?256:Number(d.maxLength);
    if(!Number.isSafeInteger(out.maxLength)||out.maxLength<1||out.maxLength>4096) fail(path+'.maxLength invalid');
  }
  return out;
}
function paramValue(def,parameters){
  const raw=parameters?.[def.name];
  if(raw===undefined||raw===null||raw===''){
    if(def.required) fail('missing recipe parameter '+def.name,'WFM_CONNECTOR_RECIPE_PARAMETER_INVALID');
    return null;
  }
  if(def.kind==='integer'){
    const n=Number(raw);
    if(!Number.isSafeInteger(n)||n<def.min||n>def.max) fail('parameter outside bounds '+def.name,'WFM_CONNECTOR_RECIPE_PARAMETER_INVALID');
    return String(n);
  }
  if(def.kind==='boolean'){
    if(typeof raw!=='boolean') fail('parameter must be boolean '+def.name,'WFM_CONNECTOR_RECIPE_PARAMETER_INVALID');
    return raw?'true':'false';
  }
  const v=String(raw).normalize('NFC').trim();
  if(/[\u0000-\u001f\u007f]/.test(v)) fail('parameter contains control characters '+def.name,'WFM_CONNECTOR_RECIPE_PARAMETER_INVALID');
  if(def.kind==='id'&&!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v)) fail('invalid id parameter '+def.name,'WFM_CONNECTOR_RECIPE_PARAMETER_INVALID');
  if(def.kind==='enum'&&!def.values.includes(v)) fail('enum parameter rejected '+def.name,'WFM_CONNECTOR_RECIPE_PARAMETER_INVALID');
  if(def.kind==='text'&&v.length>def.maxLength) fail('text parameter too long '+def.name,'WFM_CONNECTOR_RECIPE_PARAMETER_INVALID');
  return v;
}
function headers(input={}){
  plain(input,'headers');const out={};
  for(const [k,v] of Object.entries(input)){
    const name=text(k,'header name',80).toLowerCase();
    if(BAD_HEADER.test(name)) fail('recipe cannot define transport/auth header '+name);
    if(typeof v!=='string'||/[\r\n\0]/.test(v)) fail('invalid header '+name);
    out[name]=v;
  }
  return out;
}
function pathParts(items){
  if(!Array.isArray(items)||!items.length||items.length>40) fail('pathSegments must contain 1-40 entries');
  return items.map((item,i)=>{
    if(typeof item==='string') return {literal:segment(item,'pathSegments['+i+']')};
    const o=plain(item,'pathSegments['+i+']');
    if(Object.keys(o).length!==1||!o.param) fail('path entry must be literal or param');
    return {param:param(o.param,'pathSegments['+i+'].param')};
  });
}
function queryItems(items=[]){
  if(!Array.isArray(items)||items.length>40) fail('query must contain at most 40 entries');
  const seen=new Set();
  return items.map((item,i)=>{
    const o=plain(item,'query['+i+']'),name=queryName(o.name,'query['+i+'].name');
    if(seen.has(name)) fail('duplicate query parameter '+name);seen.add(name);
    const fixed=Object.hasOwn(o,'fixed'),dynamic=Object.hasOwn(o,'param');
    if(fixed===dynamic) fail('query entry must define exactly one of fixed or param');
    if(fixed){
      if(!['string','number','boolean'].includes(typeof o.fixed)) fail('fixed query value must be scalar');
      return {name,fixed:String(o.fixed)};
    }
    return {name,param:param(o.param,'query['+i+'].param')};
  });
}
function body(method,value){
  if(method!=='POST'){if(value!==undefined&&value!==null) fail('GET/HEAD recipe cannot define a body');return null;}
  if(value===undefined||value===null) fail('POST recipe requires fixedJsonBody');
  return inert(value,'fixedJsonBody');
}
function supports(contract,adapter,target){
  if(!contract||contract.schemaVersion!==1||!contract.provider||!contract.binding) fail('valid connector contract required');
  if(!contract.transports.some(t=>t.adapter===adapter)) fail('connector transport unavailable '+adapter,'WFM_CONNECTOR_RECIPE_TRANSPORT_UNAVAILABLE');
  if(!contract.resources.some(r=>r.target===target)) fail('connector target unavailable '+target,'WFM_CONNECTOR_RECIPE_TARGET_UNAVAILABLE');
}

export function defineConnectorReadRecipe(raw){
  const x=plain(raw,'recipe');
  if(x.schemaVersion!==1) fail('recipe.schemaVersion must be 1');
  const method=text(x.method,'method',12).toUpperCase(),adapter=text(x.adapter,'adapter',40);
  if(!METHODS.has(method)) fail('unsupported method');
  if(!ADAPTERS.has(adapter)) fail('unsupported zero-cost adapter');
  const readViaPostProven=x.readViaPostProven===true;
  if(method==='POST'&&!readViaPostProven) fail('POST requires readViaPostProven');
  if(method!=='POST'&&readViaPostProven) fail('readViaPostProven only applies to POST');
  const recipe={
    schemaVersion:1,id:text(x.id,'id',128),providerId:text(x.providerId,'providerId',128),
    target:text(x.target,'target',128),mappingProfile:text(x.mappingProfile,'mappingProfile',128),
    adapter,method,authMode:text(x.authMode,'authMode',80),readViaPostProven,
    pathSegments:pathParts(x.pathSegments),query:queryItems(x.query||[]),headers:headers(x.headers||{}),
    fixedJsonBody:body(method,x.fixedJsonBody),pagination:x.pagination===undefined?null:inert(x.pagination,'pagination'),
    route:{routeId:text(x.route?.routeId||'primary','route.routeId',128),region:text(x.route?.region||'provider','route.region',80),dataLocation:text(x.route?.dataLocation||'provider','route.dataLocation',80)}
  };
  return freeze({...recipe,recipeFingerprint:fingerprint(recipe)});
}

export function compileConnectorReadRecipe({recipe,contract,connectionPlan,connectionEvidence,credentialRef,parameters={},nowMs=Date.now()}={}){
  const r=recipe?.recipeFingerprint?recipe:defineConnectorReadRecipe(recipe);
  if(contract?.provider?.id!==r.providerId) fail('recipe provider mismatch','WFM_CONNECTOR_RECIPE_BINDING_MISMATCH');
  supports(contract,r.adapter,r.target);
  const host=text(connectionPlan?.configuration?.endpointHost,'connectionPlan.configuration.endpointHost',253).toLowerCase();
  const parts=r.pathSegments.map(p=>encodeURIComponent(p.literal!==undefined?p.literal:paramValue(p.param,parameters)));
  const url=new URL('https://'+host+'/'+parts.join('/'));
  for(const q of r.query){
    const value=q.fixed!==undefined?q.fixed:paramValue(q.param,parameters);
    if(value!==null) url.searchParams.set(q.name,value);
  }
  const request={
    method:r.method,url:url.toString(),headers:{...r.headers},
    body:r.method==='POST'?JSON.stringify(r.fixedJsonBody):null,
    auth:{mode:r.authMode},readViaPostProven:r.readViaPostProven,immutableQueryId:r.recipeFingerprint
  };
  const defs=[...r.pathSegments.filter(p=>p.param).map(p=>p.param),...r.query.filter(q=>q.param).map(q=>q.param)];
  const pagination=r.pagination===null?null:freeze({...structuredClone(r.pagination),recipeParameters:freeze(Object.fromEntries(defs.map(d=>[d.name,paramValue(d,parameters)])))});
  return buildBoundProviderReadPlan(contract,{
    target:r.target,connectionPlan,connectionEvidence,credentialRef,nowMs,
    route:{...r.route,endpointHost:host},request,pagination,mappingProfile:r.mappingProfile
  });
}
