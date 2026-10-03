import {createHash} from 'node:crypto';
import {createRegionalRoutePolicy,authorizeRegionalRoute} from './regional-route-authority.mjs';
import {safeAuthReference,validateConnectionEvidence} from './connection-test-plan.mjs';
import {assertConnectorOperation} from './universal-connector-contract.mjs';

const required=(value,name)=>{
  if(typeof value!=='string'||!value.trim()) throw new TypeError(`${name} is required`);
  const text=value.normalize('NFC').trim();
  if(text.includes('\0')) throw new TypeError(`${name} contains NUL`);
  return text;
};
const integer=(value,name,min,max)=>{
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<min||n>max) throw new TypeError(`${name} must be between ${min} and ${max}`);
  return n;
};
const exactHost=(value,name='endpointHost')=>{
  const host=required(value,name).toLowerCase();
  if(host.includes('*')||host.includes('/')||host.includes('@')) throw new TypeError(`${name} must be an exact HTTPS host`);
  const url=new URL(`https://${host}`);
  if(url.host.toLowerCase()!==host||url.username||url.password||url.pathname!=='/'||url.search||url.hash) throw new TypeError(`${name} is invalid`);
  return host;
};
const exactId=(value,name)=>{
  const text=required(value,name);
  if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{1,127}$/.test(text)) throw new TypeError(`${name} has an invalid identity format`);
  return text;
};
const credentialRef=value=>{
  const ref=required(value,'credentialRef');
  if(!safeAuthReference(ref)) throw new TypeError('credentialRef must be an opaque managed secret reference');
  return ref;
};
const freeze=value=>{
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}
  return value;
};
const sha256=value=>createHash('sha256').update(String(value)).digest('hex');

function assertProvider(contract,providerId){
  if(!contract||contract.schemaVersion!==1||!contract.binding||!contract.provider) throw new TypeError('valid universal connector contract is required');
  if(contract.provider.id!==providerId) throw new Error(`connector contract is for ${contract.provider.id}, not ${providerId}`);
}
function authorizeRead(contract,target){
  return assertConnectorOperation(contract,{
    tenantId:contract.binding.tenantId,
    connectionId:contract.binding.connectionId,
    providerId:contract.provider.id,
    target,
    verb:'read'
  });
}
function verifiedConnection(contract,{connectionPlan,connectionEvidence,credentialRef:ref,expectedHost,nowMs=Date.now()}){
  if(!connectionPlan?.configuration) throw new TypeError('bound connectionPlan is required');
  const config=connectionPlan.configuration;
  const host=exactHost(expectedHost);
  const mismatches=[];
  if(config.providerKey!==contract.provider.id) mismatches.push('provider');
  if(config.wfmTenantId!==contract.binding.tenantId) mismatches.push('tenant');
  if(config.connectionId!==contract.binding.connectionId) mismatches.push('connection');
  if(config.endpointHost!==host) mismatches.push('endpoint');
  const opaqueRef=credentialRef(ref);
  if(connectionPlan.credentialFingerprint!==sha256(opaqueRef)) mismatches.push('credential-reference');
  if(mismatches.length){
    const error=new Error(`connection proof binding mismatch: ${mismatches.join(', ')}`);
    error.code='WFM_PROVIDER_CONNECTION_BINDING_MISMATCH';
    throw error;
  }
  const result=validateConnectionEvidence(connectionPlan,connectionEvidence,{nowMs});
  if(!['CONNECTION_VERIFIED','CONNECTION_AND_SAMPLE_VERIFIED'].includes(result.status)){
    const error=new Error(`connection proof rejected: ${result.reasons.join(', ')}`);
    error.code='WFM_PROVIDER_CONNECTION_NOT_VERIFIED';
    error.reasons=result.reasons;
    throw error;
  }
  return freeze({
    configurationFingerprint:connectionPlan.configurationFingerprint,
    observedAt:result.observedAt,
    sourceInstanceId:config.sourceInstanceId,
    endpointHost:host,
    credentialRef:opaqueRef
  });
}
function exactRoute(contract,{routeId,endpointHost,region,dataLocation}){
  const host=exactHost(endpointHost);
  const policy=createRegionalRoutePolicy({
    providerId:contract.provider.id,
    routes:[{id:required(routeId,'routeId'),region:required(region,'region'),dataLocation:required(dataLocation,'dataLocation'),endpointHosts:[host],allowedTransferDestinations:[],sourceCountries:[],customerChosenDataLocation:true}]
  });
  return authorizeRegionalRoute({policy,routeId,endpointUrl:`https://${host}/`});
}
function basePlan(contract,{target,route,credentialRef:ref,connectionPlan,connectionEvidence,nowMs,request,pagination,mappingProfile}){
  authorizeRead(contract,target);
  const connection=verifiedConnection(contract,{connectionPlan,connectionEvidence,credentialRef:ref,expectedHost:route.endpointHost,nowMs});
  const routeAuthority=exactRoute(contract,route);
  const url=new URL(request.url);
  if(url.protocol!=='https:'||url.host.toLowerCase()!==routeAuthority.endpointHost||url.username||url.password||url.hash) throw new Error('request violates exact provider endpoint authority');
  return freeze({
    schemaVersion:1,
    binding:{tenantId:contract.binding.tenantId,connectionId:contract.binding.connectionId,providerId:contract.provider.id,bindingHash:contract.bindingHash},
    connection,
    target,
    operationClass:'read',
    route:routeAuthority,
    credentialRef:connection.credentialRef,
    request,
    pagination,
    mappingProfile,
    writeAuthority:false,
    checkpointAdvanceAllowed:false
  });
}
export function buildStaffologyWorkerPageRead({contract,connectionPlan,connectionEvidence,credentialRef:ref,employerId,pageNum=0,pageSize=100,nowMs}={}){
  assertProvider(contract,'iris-staffology-payroll');
  const employer=exactId(employerId,'employerId'),page=integer(pageNum,'pageNum',0,1_000_000),size=integer(pageSize,'pageSize',1,500);
  const host='api.staffology.co.uk',url=new URL(`https://${host}/employers/${encodeURIComponent(employer)}/employees`);
  url.searchParams.set('pageNum',String(page));url.searchParams.set('pageSize',String(size));
  return basePlan(contract,{target:'worker',connectionPlan,connectionEvidence,credentialRef:ref,nowMs,route:{routeId:'staffology-uk',endpointHost:host,region:'uk',dataLocation:'uk'},request:{method:'GET',url:url.toString(),headers:{accept:'application/json'},body:null,auth:{mode:'basic-api-key',username:'vector'}},pagination:{style:'page-number',pageNum:page,pageSize:size,terminal:'short-page'},mappingProfile:'staffology-worker-v1'});
}

export function buildStaffologyWorkerDetailRead({contract,connectionPlan,connectionEvidence,credentialRef:ref,employerId,employeeId,nowMs}={}){
  assertProvider(contract,'iris-staffology-payroll');
  const employer=exactId(employerId,'employerId');
  const employee=exactId(employeeId,'employeeId');
  const host='api.staffology.co.uk';
  const url=new URL(`https://${host}/employers/${encodeURIComponent(employer)}/employees/${encodeURIComponent(employee)}`);
  return basePlan(contract,{target:'worker',connectionPlan,connectionEvidence,credentialRef:ref,nowMs,route:{routeId:'staffology-uk',endpointHost:host,region:'uk',dataLocation:'uk'},request:{method:'GET',url:url.toString(),headers:{accept:'application/json'},body:null,auth:{mode:'basic-api-key',username:'vector'},immutableQueryId:'staffology-worker-detail-v1'},pagination:null,mappingProfile:'staffology-worker-detail-v1'});
}

function netsuiteHost(value){
  const host=exactHost(value,'accountHost');
  if(!/^[a-z0-9][a-z0-9-]{1,80}\.suitetalk\.api\.netsuite\.com$/.test(host)) throw new TypeError('accountHost must be an exact NetSuite SuiteTalk account host');
  return host;
}
export function buildNetSuiteWorkerSuiteQLRead({contract,connectionPlan,connectionEvidence,credentialRef:ref,limit=1000,offset=0,region='provider',dataLocation='provider',nowMs}={}){
  assertProvider(contract,'oracle-netsuite');
  const host=netsuiteHost(connectionPlan?.configuration?.endpointHost),pageSize=integer(limit,'limit',1,1000),pageOffset=integer(offset,'offset',0,99_999);
  if(pageOffset%pageSize!==0) throw new TypeError('NetSuite offset must be divisible by limit');
  const url=new URL(`https://${host}/services/rest/query/v1/suiteql`);
  url.searchParams.set('limit',String(pageSize));url.searchParams.set('offset',String(pageOffset));
  const query='SELECT id, entityid, firstname, lastname, email, isinactive FROM employee ORDER BY id';
  return basePlan(contract,{target:'worker',connectionPlan,connectionEvidence,credentialRef:ref,nowMs,route:{routeId:'netsuite-account',endpointHost:host,region,dataLocation},request:{method:'POST',url:url.toString(),headers:{accept:'application/json','content-type':'application/json',prefer:'transient'},body:JSON.stringify({q:query}),auth:{mode:'oauth2-bearer'},readViaPostProven:true,immutableQueryId:'netsuite-worker-core-v1'},pagination:{style:'limit-offset',limit:pageSize,offset:pageOffset,maxResults:100_000,uniqueOrder:'id'},mappingProfile:'netsuite-worker-v1'});
}
export function buildSapS4ProductionOrderRead({contract,connectionPlan,connectionEvidence,credentialRef:ref,top=500,skip=0,region='provider',dataLocation='provider',nowMs}={}){
  assertProvider(contract,'sap-s4hana');
  const host=exactHost(connectionPlan?.configuration?.endpointHost),pageSize=integer(top,'top',1,1000),pageOffset=integer(skip,'skip',0,10_000_000);
  const url=new URL(`https://${host}/sap/opu/odata/sap/API_PRODUCTION_ORDER_2_SRV/A_ProductionOrder_2`);
  url.searchParams.set('$top',String(pageSize));url.searchParams.set('$skip',String(pageOffset));url.searchParams.set('$orderby','ManufacturingOrder');
  return basePlan(contract,{target:'production-demand',connectionPlan,connectionEvidence,credentialRef:ref,nowMs,route:{routeId:'sap-s4-primary',endpointHost:host,region,dataLocation},request:{method:'GET',url:url.toString(),headers:{accept:'application/json'},body:null,auth:{mode:'managed-provider-auth'},immutableQueryId:'sap-s4-production-order-v2'},pagination:{style:'odata-v2-skip',top:pageSize,skip:pageOffset,uniqueOrder:'ManufacturingOrder'},mappingProfile:'sap-s4-production-demand-v1'});
}
export function assertProviderReadPlan(plan,contract){
  if(!plan||plan.schemaVersion!==1||plan.operationClass!=='read'||plan.writeAuthority!==false) throw new TypeError('valid read-only provider plan is required');
  if(plan.binding.bindingHash!==contract.bindingHash||plan.binding.tenantId!==contract.binding.tenantId||plan.binding.connectionId!==contract.binding.connectionId||plan.binding.providerId!==contract.provider.id){
    const error=new Error('provider read plan is not bound to this connector contract');error.code='WFM_PROVIDER_READ_BINDING_MISMATCH';throw error;
  }
  authorizeRead(contract,plan.target);
  const url=new URL(plan.request.url);
  if(url.host.toLowerCase()!==plan.route.endpointHost||plan.connection.endpointHost!==plan.route.endpointHost) throw new Error('provider read plan endpoint authority changed');
  return true;
}
