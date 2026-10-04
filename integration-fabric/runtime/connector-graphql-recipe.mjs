import {createHash} from 'node:crypto';
import {buildBoundProviderReadPlan} from './provider-read-requests.mjs';

const CREDENTIAL=/(password|passwd|secret|token|authorization|credential|api[_-]?key|client[_-]?secret|private[_-]?key)/i;

function fail(message,code='WFM_GRAPHQL_RECIPE_INVALID'){const e=new Error(message);e.code=code;throw e;}
function text(value,name,max=1024){
  if(typeof value!=='string'||!value.trim())fail(name+' is required');
  const v=value.normalize('NFC').trim();
  if(v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v))fail(name+' is invalid');
  return v;
}
function plain(value,name){
  if(!value||typeof value!=='object'||Array.isArray(value)||(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null))fail(name+' must be a plain object');
  return value;
}
function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
const fingerprint=value=>'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function segment(value,name){
  const v=text(value,name,180);
  if(v==='.'||v==='..'||/[\\/?#]/.test(v))fail(name+' must be one exact path segment');
  return v;
}
function variableName(value,name){
  const v=text(value,name,80);
  if(!/^[_A-Za-z][_0-9A-Za-z]*$/.test(v)||CREDENTIAL.test(v))fail(name+' is unsafe');
  return v;
}
function variableDef(raw,path){
  const d=plain(raw,path),kind=text(d.kind||'id',path+'.kind',32);
  if(!['id','integer','boolean','enum','text','iso8601'].includes(kind))fail(path+'.kind unsupported');
  const out={name:variableName(d.name,path+'.name'),kind,required:d.required!==false};
  if(kind==='integer'){
    out.min=d.min===undefined?0:Number(d.min);out.max=d.max===undefined?Number.MAX_SAFE_INTEGER:Number(d.max);
    if(!Number.isSafeInteger(out.min)||!Number.isSafeInteger(out.max)||out.min>out.max)fail(path+' integer bounds invalid');
  }
  if(kind==='enum'){
    if(!Array.isArray(d.values)||!d.values.length)fail(path+'.values required');
    out.values=[...new Set(d.values.map((v,i)=>text(v,path+'.values['+i+']',160)))];
  }
  if(kind==='text'){
    out.maxLength=d.maxLength===undefined?512:Number(d.maxLength);
    if(!Number.isSafeInteger(out.maxLength)||out.maxLength<1||out.maxLength>4096)fail(path+'.maxLength invalid');
  }
  return out;
}
function variableValue(def,variables){
  const raw=variables?.[def.name];
  if(raw===undefined||raw===null||raw===''){
    if(def.required)fail('missing GraphQL variable '+def.name,'WFM_GRAPHQL_VARIABLE_INVALID');
    return null;
  }
  if(def.kind==='integer'){
    const n=Number(raw);
    if(!Number.isSafeInteger(n)||n<def.min||n>def.max)fail('GraphQL variable outside bounds '+def.name,'WFM_GRAPHQL_VARIABLE_INVALID');
    return n;
  }
  if(def.kind==='boolean'){
    if(typeof raw!=='boolean')fail('GraphQL variable must be boolean '+def.name,'WFM_GRAPHQL_VARIABLE_INVALID');
    return raw;
  }
  if(def.kind==='iso8601'){
    const s=text(String(raw),'GraphQL variable '+def.name,64);
    const ms=Date.parse(s);
    if(!Number.isFinite(ms))fail('GraphQL timestamp variable invalid '+def.name,'WFM_GRAPHQL_VARIABLE_INVALID');
    return new Date(ms).toISOString();
  }
  const v=String(raw).normalize('NFC').trim();
  if(/[\u0000-\u001f\u007f]/.test(v))fail('GraphQL variable contains control characters '+def.name,'WFM_GRAPHQL_VARIABLE_INVALID');
  if(def.kind==='id'&&!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v))fail('GraphQL id variable invalid '+def.name,'WFM_GRAPHQL_VARIABLE_INVALID');
  if(def.kind==='enum'&&!def.values.includes(v))fail('GraphQL enum variable rejected '+def.name,'WFM_GRAPHQL_VARIABLE_INVALID');
  if(def.kind==='text'&&v.length>def.maxLength)fail('GraphQL text variable too long '+def.name,'WFM_GRAPHQL_VARIABLE_INVALID');
  return v;
}
function stripLiterals(query){
  let out='',i=0;
  while(i<query.length){
    if(query[i]==='#'){
      while(i<query.length&&query[i]!=='\n'){out+=' ';i++;}
      continue;
    }
    if(query.startsWith('"""',i)){
      out+='   ';i+=3;
      while(i<query.length&&!query.startsWith('"""',i)){out+=' ';i++;}
      if(i>=query.length)fail('GraphQL block string is unterminated');
      out+='   ';i+=3;continue;
    }
    if(query[i]==='"'){
      out+=' ';i++;
      let escaped=false,closed=false;
      while(i<query.length){
        const c=query[i];out+=' ';i++;
        if(escaped){escaped=false;continue;}
        if(c==='\\'){escaped=true;continue;}
        if(c==='"'){closed=true;break;}
      }
      if(!closed)fail('GraphQL string is unterminated');
      continue;
    }
    out+=query[i++];
  }
  return out;
}
function validateQuery(value){
  const query=text(value,'query',50000);
  const stripped=stripLiterals(query);
  if(/\bmutation\b/i.test(stripped)||/\bsubscription\b/i.test(stripped))fail('GraphQL recipe may contain read queries only','WFM_GRAPHQL_MUTATION_FORBIDDEN');
  const trimmed=stripped.trim();
  if(!(trimmed.startsWith('query')||trimmed.startsWith('{')))fail('GraphQL recipe must be a query operation');
  const operationMatches=trimmed.match(/\bquery\b/g)||[];
  if(operationMatches.length>1)fail('GraphQL recipe must contain one query operation');
  return query;
}
function supports(contract,target){
  if(!contract||contract.schemaVersion!==1||!contract.provider||!contract.binding)fail('valid connector contract required');
  if(!contract.transports.some(t=>t.adapter==='graphql'))fail('connector does not declare GraphQL transport','WFM_GRAPHQL_TRANSPORT_UNAVAILABLE');
  if(!contract.resources.some(r=>r.target===target))fail('connector target unavailable '+target,'WFM_GRAPHQL_TARGET_UNAVAILABLE');
}
function pathParts(value){
  if(!Array.isArray(value)||!value.length||value.length>40)fail('pathSegments must contain 1-40 entries');
  return value.map((v,i)=>{
    if(typeof v==='string')return {literal:segment(v,'pathSegments['+i+']')};
    const x=plain(v,'pathSegments['+i+']');
    if(Object.keys(x).length!==1||!x.param)fail('GraphQL path entry must be literal or param');
    return {param:variableDef(x.param,'pathSegments['+i+'].param')};
  });
}

export function defineGraphqlReadRecipe(raw){
  const x=plain(raw,'GraphQL recipe');
  if(x.schemaVersion!==1)fail('GraphQL recipe schemaVersion must be 1');
  const defs=Array.isArray(x.variables)?x.variables.map((v,i)=>variableDef(v,'variables['+i+']')):[];
  if(new Set(defs.map(v=>v.name)).size!==defs.length)fail('GraphQL variables must be unique');
  const recipe={
    schemaVersion:1,id:text(x.id,'id',128),providerId:text(x.providerId,'providerId',128),
    target:text(x.target,'target',128),mappingProfile:text(x.mappingProfile,'mappingProfile',128),
    authMode:text(x.authMode,'authMode',80),pathSegments:pathParts(x.pathSegments||['graphql']),
    query:validateQuery(x.query),operationName:x.operationName?variableName(x.operationName,'operationName'):null,
    variables:defs,
    route:{
      routeId:text(x.route?.routeId||'graphql-primary','route.routeId',128),
      region:text(x.route?.region||'provider','route.region',80),
      dataLocation:text(x.route?.dataLocation||'provider','route.dataLocation',80)
    }
  };
  return freeze({...recipe,queryFingerprint:fingerprint({query:recipe.query,operationName:recipe.operationName}),recipeFingerprint:fingerprint(recipe)});
}

export function compileGraphqlReadRecipe({recipe,contract,connectionPlan,connectionEvidence,credentialRef,variables={},nowMs=Date.now()}={}){
  const r=recipe?.queryFingerprint?recipe:defineGraphqlReadRecipe(recipe);
  if(contract?.provider?.id!==r.providerId)fail('GraphQL recipe provider mismatch','WFM_GRAPHQL_BINDING_MISMATCH');
  supports(contract,r.target);
  const host=text(connectionPlan?.configuration?.endpointHost,'connectionPlan.configuration.endpointHost',253).toLowerCase();
  const url=new URL('https://'+host+'/'+r.pathSegments.map(part=>encodeURIComponent(part.literal!==undefined?part.literal:variableValue(part.param,variables))).join('/'));
  const values={};
  for(const def of r.variables){
    const value=variableValue(def,variables);
    if(value!==null)values[def.name]=value;
  }
  const body={query:r.query,variables:values};
  if(r.operationName)body.operationName=r.operationName;
  return buildBoundProviderReadPlan(contract,{
    target:r.target,connectionPlan,connectionEvidence,credentialRef,nowMs,
    route:{...r.route,endpointHost:host},
    request:{
      method:'POST',url:url.toString(),
      headers:{accept:'application/json','content-type':'application/json'},
      body:JSON.stringify(body),auth:{mode:r.authMode},readViaPostProven:true,responseFormat:'json',
      immutableQueryId:r.queryFingerprint
    },
    pagination:null,mappingProfile:r.mappingProfile
  });
}
