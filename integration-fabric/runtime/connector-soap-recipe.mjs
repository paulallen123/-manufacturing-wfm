import {createHash} from 'node:crypto';
import {buildBoundProviderReadPlan} from './provider-read-requests.mjs';

function fail(message,code='WFM_SOAP_RECIPE_INVALID'){const e=new Error(message);e.code=code;throw e;}
function text(value,name,max=512){
  if(typeof value!=='string'||!value.trim())fail(name+' is required');
  const v=value.normalize('NFC').trim();
  if(v.length>max||/[\u0000-\u001f\u007f]/.test(v))fail(name+' is invalid');
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
function paramDef(raw,path){
  const d=plain(raw,path),kind=text(d.kind||'id',path+'.kind',32);
  if(!['id','integer','boolean','enum','text'].includes(kind))fail(path+'.kind unsupported');
  const out={name:text(d.name,path+'.name',80),kind,required:d.required!==false};
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
function paramValue(def,parameters){
  const raw=parameters?.[def.name];
  if(raw===undefined||raw===null||raw===''){
    if(def.required)fail('missing SOAP parameter '+def.name,'WFM_SOAP_PARAMETER_INVALID');
    return null;
  }
  if(def.kind==='integer'){
    const n=Number(raw);
    if(!Number.isSafeInteger(n)||n<def.min||n>def.max)fail('SOAP parameter outside bounds '+def.name,'WFM_SOAP_PARAMETER_INVALID');
    return String(n);
  }
  if(def.kind==='boolean'){
    if(typeof raw!=='boolean')fail('SOAP parameter must be boolean '+def.name,'WFM_SOAP_PARAMETER_INVALID');
    return raw?'true':'false';
  }
  const v=String(raw).normalize('NFC').trim();
  if(/[\u0000-\u001f\u007f]/.test(v))fail('SOAP parameter contains control characters '+def.name,'WFM_SOAP_PARAMETER_INVALID');
  if(def.kind==='id'&&!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v))fail('SOAP id parameter invalid '+def.name,'WFM_SOAP_PARAMETER_INVALID');
  if(def.kind==='enum'&&!def.values.includes(v))fail('SOAP enum parameter rejected '+def.name,'WFM_SOAP_PARAMETER_INVALID');
  if(def.kind==='text'&&v.length>def.maxLength)fail('SOAP text parameter too long '+def.name,'WFM_SOAP_PARAMETER_INVALID');
  return v;
}
function xmlEscape(value){
  return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
function envelopeParts(items){
  if(!Array.isArray(items)||!items.length||items.length>120)fail('envelopeParts must contain 1-120 entries');
  return items.map((item,i)=>{
    if(typeof item==='string'){
      if(item.length>8192||/<!DOCTYPE|<!ENTITY/i.test(item))fail('SOAP literal contains forbidden markup');
      return {literal:item};
    }
    const obj=plain(item,'envelopeParts['+i+']');
    if(Object.keys(obj).length!==1||!obj.param)fail('SOAP envelope entry must be literal or param');
    return {param:paramDef(obj.param,'envelopeParts['+i+'].param')};
  });
}
function supports(contract,target){
  if(!contract||contract.schemaVersion!==1||!contract.provider||!contract.binding)fail('valid connector contract required');
  if(!contract.transports.some(t=>t.adapter==='soap-wsdl'))fail('connector does not declare SOAP transport','WFM_SOAP_TRANSPORT_UNAVAILABLE');
  if(!contract.resources.some(r=>r.target===target))fail('connector target unavailable '+target,'WFM_SOAP_TARGET_UNAVAILABLE');
}
function buildEnvelope(parts,parameters){
  const body=parts.map(part=>part.literal!==undefined?part.literal:xmlEscape(paramValue(part.param,parameters)??'')).join('');
  if(!/^\s*<[^>]+>/.test(body)||!/<\/[^>]+>\s*$/.test(body))fail('SOAP envelope must be complete XML');
  if(/<!DOCTYPE|<!ENTITY/i.test(body))fail('SOAP envelope contains forbidden markup');
  return body;
}

export function defineSoapReadRecipe(raw){
  const x=plain(raw,'soap recipe');
  if(x.schemaVersion!==1)fail('soap recipe schemaVersion must be 1');
  const recipe={
    schemaVersion:1,
    id:text(x.id,'id',128),
    providerId:text(x.providerId,'providerId',128),
    target:text(x.target,'target',128),
    mappingProfile:text(x.mappingProfile,'mappingProfile',128),
    authMode:text(x.authMode,'authMode',80),
    soapAction:text(x.soapAction,'soapAction',512),
    pathSegments:(()=>{
      if(!Array.isArray(x.pathSegments)||!x.pathSegments.length||x.pathSegments.length>40)fail('pathSegments must contain 1-40 entries');
      return x.pathSegments.map((v,i)=>segment(v,'pathSegments['+i+']'));
    })(),
    envelopeParts:envelopeParts(x.envelopeParts),
    route:{
      routeId:text(x.route?.routeId||'soap-primary','route.routeId',128),
      region:text(x.route?.region||'provider','route.region',80),
      dataLocation:text(x.route?.dataLocation||'provider','route.dataLocation',80)
    }
  };
  return freeze({...recipe,recipeFingerprint:fingerprint(recipe)});
}

export function compileSoapReadRecipe({recipe,contract,connectionPlan,connectionEvidence,credentialRef,parameters={},nowMs=Date.now()}={}){
  const r=recipe?.recipeFingerprint?recipe:defineSoapReadRecipe(recipe);
  if(contract?.provider?.id!==r.providerId)fail('SOAP recipe provider mismatch','WFM_SOAP_BINDING_MISMATCH');
  supports(contract,r.target);
  const host=text(connectionPlan?.configuration?.endpointHost,'connectionPlan.configuration.endpointHost',253).toLowerCase();
  const url=new URL('https://'+host+'/'+r.pathSegments.map(encodeURIComponent).join('/'));
  const body=buildEnvelope(r.envelopeParts,parameters);
  return buildBoundProviderReadPlan(contract,{
    target:r.target,connectionPlan,connectionEvidence,credentialRef,nowMs,
    route:{...r.route,endpointHost:host},
    request:{
      method:'POST',
      url:url.toString(),
      headers:{accept:'text/xml, application/soap+xml','content-type':'text/xml; charset=utf-8',soapaction:r.soapAction},
      body,
      auth:{mode:r.authMode},
      readViaPostProven:true,
      responseFormat:'xml',
      immutableQueryId:r.recipeFingerprint
    },
    pagination:null,
    mappingProfile:r.mappingProfile
  });
}
