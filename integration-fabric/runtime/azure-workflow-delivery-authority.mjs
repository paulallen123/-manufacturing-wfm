import {createHash} from 'node:crypto';

const SHA=/^sha256:[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NAME=/^[A-Za-z0-9](?:[A-Za-z0-9._()-]{0,126}[A-Za-z0-9_)])?$/;
const REGION=/^[a-z0-9]{2,32}$/;
const RUN=/^[A-Za-z0-9_-]{1,128}$/;
const TRACKING=/^[A-Za-z0-9._:-]{1,256}$/;
const SECRET=/(?:password|passwd|secret|token|credential|authorization|cookie|api[_-]?key|client[_-]?secret|access[_-]?token)/i;
const HOSTING=new Map([['consumption','2019-05-01'],['standard','2026-03-15']]);

function fail(message){throw new TypeError(message);}
function object(value,label,keys){
 if(value===null||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype) fail(`${label} must be a plain object`);
 const descriptors=Object.getOwnPropertyDescriptors(value);
 for(const key of Reflect.ownKeys(value)){
  if(typeof key!=='string') fail(`${label} symbols are not allowed`);
  if(SECRET.test(key)) fail(`${label} secret or credential fields are not allowed`);
  const descriptor=descriptors[key];
  if(!descriptor?.enumerable||!('value' in descriptor)) fail(`${label}.${key} hidden or executable evidence is not allowed`);
  if(!keys.includes(key)) fail(`${label}.${key} is not allowed`);
 }
 for(const key of keys) if(!Object.hasOwn(value,key)) fail(`${label}.${key} is required`);
 return value;
}
function array(value,label,min,max){
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length<min||value.length>max) fail(`${label} must be a plain array with ${min}-${max} items`);
 const descriptors=Object.getOwnPropertyDescriptors(value);
 for(let index=0;index<value.length;index++){
  if(!Object.hasOwn(value,index)) fail(`${label} cannot be sparse`);
  const descriptor=descriptors[index];
  if(!descriptor?.enumerable||!('value' in descriptor)) fail(`${label}[${index}] hidden or executable evidence is not allowed`);
 }
 const allowed=new Set(['length',...Array.from({length:value.length},(_,index)=>String(index))]);
 if(Reflect.ownKeys(value).some(key=>typeof key==='symbol'||!allowed.has(key))) fail(`${label} contains hidden or custom array evidence`);
 return value;
}
function text(value,label,max=256,pattern){
 if(typeof value!=='string'||value.length<1||value.length>max||/[\u0000-\u001f\u007f]/.test(value)) fail(`${label} must be bounded text`);
 if(pattern&&!pattern.test(value)) fail(`${label} has invalid format`);
 return value;
}
function fingerprint(value,label){if(typeof value!=='string'||!SHA.test(value)) fail(`${label} must be a canonical sha256 fingerprint`);return value;}
function optionalFingerprint(value,label){if(value===null)return null;return fingerprint(value,label);}
function boolean(value,label){if(typeof value!=='boolean') fail(`${label} must be boolean`);return value;}
function integer(value,label,max){if(!Number.isSafeInteger(value)||value<0||value>max) fail(`${label} must be a bounded non-negative integer`);return value;}
function instant(value,label){
 text(value,label,32);
 const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{1,7})Z$/.exec(value);
 if(!match)fail(`${label} must be a canonical UTC instant`);
 const milliseconds=Date.parse(`${match[1]}.${match[2].padEnd(3,'0').slice(0,3)}Z`);
 if(!Number.isFinite(milliseconds)||new Date(milliseconds).toISOString().slice(0,19)!==match[1])fail(`${label} must be a canonical UTC instant`);
 return BigInt(Math.trunc(milliseconds/1000))*10000000n+BigInt(match[2].padEnd(7,'0'));
}
function same(actual,expected,label){if(actual!==expected) fail(`${label} does not match approved scope`);}
function canonical(value){
 if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
 if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
 return JSON.stringify(value);
}
function digest(value){return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;}
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}

const POLICY_KEYS=['provider','wfmTenantId','connectionId','azureTenantId','subscriptionId','resourceGroupName','hostingModel','resourceName','workflowName','region','managementOrigin','apiVersion','dataset','principalFingerprint','workflowDefinitionFingerprint','connectionSetFingerprint','schemaFingerprint','mappingFingerprint','sourceScopeFingerprint','expectedCheckpointPredecessor','windowStart','windowEnd','expectedObservedAt','expectedClientTrackingId','approvedActionNames','deliveryActionName','maxPages','maxActions','maxRecords'];
const RECEIPT_KEYS=['provider','wfmTenantId','connectionId','azureTenantId','subscriptionId','resourceGroupName','hostingModel','resourceName','workflowName','region','managementOrigin','apiVersion','method','actionListPath','principalFingerprint','workflowDefinitionFingerprint','connectionSetFingerprint','schemaFingerprint','mappingFingerprint','sourceScopeFingerprint','checkpointPredecessor','windowStart','windowEnd','observedAt','run','pages','deliveryReceipt'];
const RUN_KEYS=['name','status','startTime','endTime','clientTrackingId','workflowDefinitionFingerprint'];
const PAGE_KEYS=['pageIndex','requestCursorFingerprint','nextCursorFingerprint','terminal','actions'];
const ACTION_KEYS=['name','status','startTime','endTime','trackingId','payloadDigest'];
const DELIVERY_KEYS=['dataset','runName','actionName','successful','complete','recordCount','payloadDigest','schemaFingerprint','mappingFingerprint','sourceScopeFingerprint','windowStart','windowEnd','observedAt'];

function exactOrigin(value){
 text(value,'managementOrigin',256);
 let url;try{url=new URL(value);}catch{fail('managementOrigin must be an exact URL origin');}
 if(value!=='https://management.azure.com'||url.origin!==value||url.pathname!=='/'||url.search||url.hash||url.username||url.password||url.port) fail('managementOrigin must be the exact public Azure management origin');
 return value;
}
function expectedPath(policy,runName){
 const prefix=`/subscriptions/${policy.subscriptionId}/resourceGroups/${policy.resourceGroupName}`;
 if(policy.hostingModel==='consumption') return `${prefix}/providers/Microsoft.Logic/workflows/${policy.resourceName}/runs/${runName}/actions`;
 return `${prefix}/providers/Microsoft.Web/sites/${policy.resourceName}/hostruntime/runtime/webhooks/workflow/api/management/workflows/${policy.workflowName}/runs/${runName}/actions`;
}
function validatePolicy(input){
 const value=object(input,'policy',POLICY_KEYS);
 same(value.provider,'azure-logic-apps-power-automate','provider');
 text(value.wfmTenantId,'wfmTenantId',128,NAME);text(value.connectionId,'connectionId',128,NAME);
 text(value.azureTenantId,'azureTenantId',36,UUID);text(value.subscriptionId,'subscriptionId',36,UUID);
 text(value.resourceGroupName,'resourceGroupName',90,NAME);
 if(!HOSTING.has(value.hostingModel)) fail('hostingModel must be consumption or standard');
 text(value.resourceName,'resourceName',128,NAME);text(value.workflowName,'workflowName',128,NAME);
 if(value.hostingModel==='consumption'&&value.resourceName!==value.workflowName) fail('Consumption resource and workflow names must match');
 text(value.region,'region',32,REGION);exactOrigin(value.managementOrigin);
 same(value.apiVersion,HOSTING.get(value.hostingModel),'apiVersion');
 text(value.dataset,'dataset',128,NAME);
 for(const key of ['principalFingerprint','workflowDefinitionFingerprint','connectionSetFingerprint','schemaFingerprint','mappingFingerprint','sourceScopeFingerprint']) fingerprint(value[key],key);
 text(value.expectedCheckpointPredecessor,'expectedCheckpointPredecessor',256);
 const start=instant(value.windowStart,'windowStart'),end=instant(value.windowEnd,'windowEnd'),observed=instant(value.expectedObservedAt,'expectedObservedAt');
 if(!(start<end&&end<=observed)) fail('policy window and observation time are invalid');
 text(value.expectedClientTrackingId,'expectedClientTrackingId',256,TRACKING);
 array(value.approvedActionNames,'approvedActionNames',1,128);
 const approved=new Set;
 for(const [index,name] of value.approvedActionNames.entries()){text(name,`approvedActionNames[${index}]`,128,NAME);if(approved.has(name))fail('approvedActionNames contains a duplicate action');approved.add(name);}
 text(value.deliveryActionName,'deliveryActionName',128,NAME);if(!approved.has(value.deliveryActionName))fail('deliveryActionName must be approved');
 integer(value.maxPages,'maxPages',1000);if(value.maxPages<1)fail('maxPages must be positive');
 integer(value.maxActions,'maxActions',100000);if(value.maxActions<approved.size)fail('maxActions is below the approved action count');
 integer(value.maxRecords,'maxRecords',1000000000);if(value.maxRecords<1)fail('maxRecords must be positive');
 return freeze({...value,approvedActionNames:[...value.approvedActionNames]});
}

export function createAzureWorkflowDeliveryAuthority(inputPolicy){
 const policy=validatePolicy(inputPolicy);
 return freeze({admit(inputReceipt){
  const receipt=object(inputReceipt,'receipt',RECEIPT_KEYS);
  for(const key of ['provider','wfmTenantId','connectionId','azureTenantId','subscriptionId','resourceGroupName','hostingModel','resourceName','workflowName','region','managementOrigin','apiVersion','principalFingerprint','workflowDefinitionFingerprint','connectionSetFingerprint','schemaFingerprint','mappingFingerprint','sourceScopeFingerprint','windowStart','windowEnd']) same(receipt[key],policy[key],key);
  same(receipt.checkpointPredecessor,policy.expectedCheckpointPredecessor,'checkpoint predecessor');
  same(receipt.method,'GET','method');
  const observedAt=instant(receipt.observedAt,'observedAt');same(receipt.observedAt,policy.expectedObservedAt,'observedAt');

  const run=object(receipt.run,'run',RUN_KEYS);
  text(run.name,'run.name',128,RUN);same(receipt.actionListPath,expectedPath(policy,run.name),'action list resource path');
  same(run.status,'Succeeded','run status');
  text(run.clientTrackingId,'run.clientTrackingId',256,TRACKING);same(run.clientTrackingId,policy.expectedClientTrackingId,'run client tracking identity');
  same(run.workflowDefinitionFingerprint,policy.workflowDefinitionFingerprint,'run workflow definition fingerprint');
  const runStart=instant(run.startTime,'run.startTime'),runEnd=instant(run.endTime,'run.endTime');
  if(runStart<instant(policy.windowEnd,'windowEnd')||runEnd<runStart||runEnd>observedAt) fail('run time is outside the approved closed source window and observation horizon');

  const pages=array(receipt.pages,'pages',1,policy.maxPages);
  const approved=new Set(policy.approvedActionNames),seenActions=new Map;
  let expectedCursor=null,totalActions=0;
  const seenCursors=new Set;
  for(let pageIndex=0;pageIndex<pages.length;pageIndex++){
   const page=object(pages[pageIndex],`pages[${pageIndex}]`,PAGE_KEYS);
   same(integer(page.pageIndex,`pages[${pageIndex}].pageIndex`,policy.maxPages-1),pageIndex,`page ${pageIndex} index`);
   optionalFingerprint(page.requestCursorFingerprint,`pages[${pageIndex}].requestCursorFingerprint`);
   optionalFingerprint(page.nextCursorFingerprint,`pages[${pageIndex}].nextCursorFingerprint`);
   same(page.requestCursorFingerprint,expectedCursor,`page ${pageIndex} cursor`);
   boolean(page.terminal,`pages[${pageIndex}].terminal`);
   const isLast=pageIndex===pages.length-1;
   if(page.terminal!==isLast) fail('only the final page can be terminal');
   if(isLast&&page.nextCursorFingerprint!==null) fail('terminal page must not expose a next cursor');
   if(!isLast&&page.nextCursorFingerprint===null) fail('nonterminal page requires a next cursor');
   if(page.nextCursorFingerprint!==null){
    if(seenCursors.has(page.nextCursorFingerprint)) fail('pagination cursor loop is not allowed');
    seenCursors.add(page.nextCursorFingerprint);
   }
   expectedCursor=page.nextCursorFingerprint;
   const actions=array(page.actions,`pages[${pageIndex}].actions`,1,policy.maxActions);
   totalActions+=actions.length;if(totalActions>policy.maxActions)fail('action count exceeds maxActions');
   for(let actionIndex=0;actionIndex<actions.length;actionIndex++){
    const action=object(actions[actionIndex],`pages[${pageIndex}].actions[${actionIndex}]`,ACTION_KEYS);
    text(action.name,'action.name',128,NAME);if(!approved.has(action.name))fail(`action ${action.name} is not approved`);
    if(seenActions.has(action.name))fail(`duplicate action ${action.name} is not allowed`);
    same(action.status,'Succeeded',`action ${action.name} status`);
    text(action.trackingId,`action ${action.name} trackingId`,256,TRACKING);fingerprint(action.payloadDigest,`action ${action.name} payloadDigest`);
    const actionStart=instant(action.startTime,`action ${action.name} startTime`),actionEnd=instant(action.endTime,`action ${action.name} endTime`);
    if(actionStart<runStart||actionEnd<actionStart||actionEnd>runEnd)fail(`action ${action.name} time is outside the workflow run`);
    seenActions.set(action.name,{name:action.name,status:action.status,startTime:action.startTime,endTime:action.endTime,trackingId:action.trackingId,payloadDigest:action.payloadDigest});
   }
  }
  if(seenActions.size!==approved.size||[...approved].some(name=>!seenActions.has(name)))fail('approved action set is incomplete');

  const delivery=object(receipt.deliveryReceipt,'deliveryReceipt',DELIVERY_KEYS);
  same(delivery.dataset,policy.dataset,'delivery dataset');same(delivery.runName,run.name,'delivery run name');same(delivery.actionName,policy.deliveryActionName,'delivery action name');
  same(delivery.successful,true,'delivery successful');same(delivery.complete,true,'delivery complete');
  integer(delivery.recordCount,'delivery recordCount',policy.maxRecords);
  fingerprint(delivery.payloadDigest,'delivery payloadDigest');
  same(delivery.payloadDigest,seenActions.get(policy.deliveryActionName).payloadDigest,'delivery payload digest');
  for(const key of ['schemaFingerprint','mappingFingerprint','sourceScopeFingerprint','windowStart','windowEnd']) same(delivery[key],policy[key],`delivery ${key}`);
  const deliveryObservedAt=instant(delivery.observedAt,'delivery observedAt');
  if(deliveryObservedAt<=runEnd||deliveryObservedAt>observedAt)fail('delivery receipt must be later than the workflow run and within the observation horizon');

  const actions=[...policy.approvedActionNames].map(name=>seenActions.get(name));
  const evidence={provider:policy.provider,wfmTenantId:policy.wfmTenantId,connectionId:policy.connectionId,azureTenantId:policy.azureTenantId,subscriptionId:policy.subscriptionId,resourceGroupName:policy.resourceGroupName,hostingModel:policy.hostingModel,resourceName:policy.resourceName,workflowName:policy.workflowName,region:policy.region,managementOrigin:policy.managementOrigin,apiVersion:policy.apiVersion,method:'GET',actionListPath:receipt.actionListPath,principalFingerprint:policy.principalFingerprint,workflowDefinitionFingerprint:policy.workflowDefinitionFingerprint,connectionSetFingerprint:policy.connectionSetFingerprint,approvedActionNames:[...policy.approvedActionNames],deliveryActionName:policy.deliveryActionName,maxPages:policy.maxPages,maxActions:policy.maxActions,maxRecords:policy.maxRecords,runName:run.name,clientTrackingId:run.clientTrackingId,runStart:run.startTime,runEnd:run.endTime,actions,delivery:{dataset:delivery.dataset,actionName:delivery.actionName,recordCount:delivery.recordCount,payloadDigest:delivery.payloadDigest,observedAt:delivery.observedAt},sourceScopeFingerprint:policy.sourceScopeFingerprint,schemaFingerprint:policy.schemaFingerprint,mappingFingerprint:policy.mappingFingerprint,checkpointPredecessor:policy.expectedCheckpointPredecessor,windowStart:policy.windowStart,windowEnd:policy.windowEnd,observedAt:policy.expectedObservedAt};
  return freeze({...evidence,evidenceFingerprint:digest(evidence),workflowDeliveryReconciliationCandidate:true,actionCount:actions.length,deliveryRecordCount:delivery.recordCount,checkpointAdvanceAllowed:false,deletionAuthority:false,workflowMutationAuthority:false,workflowResubmitAuthority:false,connectionMutationAuthority:false,operationalDecisionAuthority:false,causalClaimAuthority:false,writeBackAuthority:false,payrollAuthority:false,attendanceAuthority:false});
 }});
}
