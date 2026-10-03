import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {observeSchema} from './schema-negotiation.mjs';
import {assertProviderReadPlan} from './provider-read-requests.mjs';

const require=createRequire(import.meta.url);
const {mapEmployee:mapStaffologyEmployee}=require('../../integrations/staffology/staffology-adapter.cjs');

function required(value,name){
  if(value===null||value===undefined||String(value).trim()==='') throw new TypeError(`${name} is required`);
  return String(value).normalize('NFC').trim();
}
function plainObject(value,name){
  if(!value||typeof value!=='object'||Array.isArray(value)||(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)) throw new TypeError(`${name} must be a plain object`);
  return value;
}
function finiteInt(value,name,min=0){
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<min) throw new TypeError(`${name} must be an integer >= ${min}`);
  return n;
}
function sha256(value){
  return createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
}
function freeze(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}
  return value;
}
function validateExecution(plan,execution){
  plainObject(execution,'execution');
  const receipt=plainObject(execution.receipt,'execution.receipt');
  if(receipt.readOnly!==true||receipt.checkpointAdvanceAllowed!==false) throw new Error('mapping requires a read-only uncommitted provider receipt');
  if(receipt.providerId!==plan.binding.providerId||receipt.tenantId!==plan.binding.tenantId||receipt.connectionId!==plan.binding.connectionId||receipt.target!==plan.target||receipt.configurationFingerprint!==plan.connection.configurationFingerprint){
    const error=new Error('provider execution receipt does not match read plan');
    error.code='WFM_PROVIDER_MAPPING_BINDING_MISMATCH';
    throw error;
  }
  return receipt;
}
function valueType(value){
  if(value===null) return 'null';
  if(Array.isArray(value)) return 'array';
  if(typeof value==='object') return 'object';
  if(typeof value==='number') return Number.isInteger(value)?'integer':'number';
  return typeof value;
}
function schemaObservation(provider,objectType,records,observedAt){
  const fields=new Map();
  for(const record of records){
    if(!record||typeof record!=='object'||Array.isArray(record)) continue;
    for(const [key,value] of Object.entries(record)){
      const prior=fields.get(key);
      const next=valueType(value);
      fields.set(key,prior&&prior!==next?'mixed':next);
    }
  }
  return observeSchema({
    provider,
    objectType,
    observedAt,
    fields:[...fields.entries()].map(([sourceName,type])=>({
      sourceName,
      stableId:sourceName,
      type,
      required:false,
      repeated:type==='array',
      sensitive:/email|phone|address|name|pay|salary|bank|tax/i.test(sourceName)
    }))
  });
}
function executionEnvelope(plan,execution,records,extra={}){
  const receipt=validateExecution(plan,execution);
  return freeze({
    schemaVersion:1,
    providerId:plan.binding.providerId,
    tenantId:plan.binding.tenantId,
    connectionId:plan.binding.connectionId,
    target:plan.target,
    mappingProfile:plan.mappingProfile,
    configurationFingerprint:receipt.configurationFingerprint,
    requestFingerprint:receipt.requestFingerprint,
    sourceObservedAt:receipt.observedAt,
    rowCount:records.length,
    sourceVersion:'sha256:'+sha256(records),
    records,
    ...extra,
    checkpointAdvanceAllowed:false
  });
}
function boolFromNetSuite(value){
  if(value===true||value==='T'||value==='true'||value===1||value==='1') return true;
  if(value===false||value==='F'||value==='false'||value===0||value==='0'||value===null||value===undefined||value==='') return false;
  throw new TypeError('NetSuite boolean field has an unsupported value');
}
function stringOrUndefined(value){
  if(value===null||value===undefined) return undefined;
  const text=String(value).trim();
  return text||undefined;
}
export function mapNetSuiteWorkerPage({plan,execution}={}){
  assertProviderReadPlan(plan,{schemaVersion:1,binding:{...plan.binding},bindingHash:plan.binding.bindingHash,provider:{id:plan.binding.providerId}});
  if(plan.binding.providerId!=='oracle-netsuite'||plan.mappingProfile!=='netsuite-worker-v1') throw new Error('NetSuite worker mapper received incompatible read plan');
  const receipt=validateExecution(plan,execution);
  const data=plainObject(execution.data,'NetSuite response');
  if(!Array.isArray(data.items)) throw new TypeError('NetSuite response items must be an array');
  const count=finiteInt(data.count??data.items.length,'NetSuite count');
  const offset=finiteInt(data.offset??plan.pagination.offset,'NetSuite offset');
  const totalResults=finiteInt(data.totalResults??count,'NetSuite totalResults');
  if(count!==data.items.length) throw new Error('NetSuite response count does not match items');
  if(count>plan.pagination.limit) throw new Error('NetSuite response exceeds requested page limit');
  if(offset!==plan.pagination.offset) throw new Error('NetSuite response offset does not match requested page');
  if(totalResults<offset+count) throw new Error('NetSuite totalResults is smaller than the observed page window');
  const seen=new Set();
  const records=data.items.map(item=>{
    plainObject(item,'NetSuite employee');
    const externalId=required(item.id,'NetSuite employee id');
    if(seen.has(externalId)) throw new Error(`duplicate NetSuite employee id: ${externalId}`);
    seen.add(externalId);
    const first=stringOrUndefined(item.firstname),last=stringOrUndefined(item.lastname),number=stringOrUndefined(item.entityid);
    const displayName=[first,last].filter(Boolean).join(' ')||number||externalId;
    const record={externalId,displayName,active:!boolFromNetSuite(item.isinactive),attributes:{sourceSystem:'oracle-netsuite',sourceObservedAt:receipt.observedAt}};
    if(number) record.employeeNumber=number;
    const email=stringOrUndefined(item.email);
    if(email) record.attributes.email=email;
    return record;
  });
  const hasMore=data.hasMore===true;
  if(hasMore!==(offset+count<totalResults)) throw new Error('NetSuite hasMore contradicts count/offset/totalResults');
  return executionEnvelope(plan,execution,records,{
    schemaObservation:schemaObservation('oracle-netsuite','employee',data.items,receipt.observedAt),
    page:freeze({count,offset,totalResults,hasMore,complete:!hasMore&&offset+count>=totalResults})
  });
}
function staffologyPathIdentity(urlValue){
  const url=new URL(urlValue);
  const match=/^\/employers\/([^/]+)\/employees\/([^/]+)$/.exec(url.pathname);
  if(!match) throw new Error('Staffology worker detail plan path is invalid');
  return {employerId:decodeURIComponent(match[1]),employeeId:decodeURIComponent(match[2])};
}
export function mapStaffologyWorkerDetail({plan,execution}={}){
  if(plan.binding.providerId!=='iris-staffology-payroll'||plan.mappingProfile!=='staffology-worker-detail-v1') throw new Error('Staffology worker mapper received incompatible read plan');
  const receipt=validateExecution(plan,execution);
  const identity=staffologyPathIdentity(plan.request.url);
  const mapped=mapStaffologyEmployee(execution.data,{
    employerId:identity.employerId,
    employeeId:identity.employeeId,
    acquiredAt:receipt.observedAt,
    sourcePath:new URL(plan.request.url).pathname
  });
  const person=mapped.canonicalPerson;
  const record={
    externalId:mapped.externalId,
    displayName:[person.firstName,person.lastName].filter(Boolean).join(' '),
    active:person.status!=='Former',
    attributes:{
      sourceSystem:'iris-staffology-payroll',
      sourceObservedAt:receipt.observedAt,
      sourceRevision:mapped.revision
    }
  };
  if(mapped.data?.identity?.payrollCode) record.employeeNumber=mapped.data.identity.payrollCode;
  if(person.email) record.attributes.email=person.email;
  if(person.jobTitle) record.attributes.jobTitle=person.jobTitle;
  if(person.department) record.attributes.departmentName=person.department;
  return executionEnvelope(plan,execution,[record],{
    schemaObservation:schemaObservation('iris-staffology-payroll','employee',[execution.data],receipt.observedAt),
    page:freeze({count:1,complete:true})
  });
}
function odataRows(data){
  plainObject(data,'SAP OData response');
  if(Array.isArray(data.value)) return {rows:data.value,next:data['@odata.nextLink']??null};
  if(data.d&&typeof data.d==='object'&&!Array.isArray(data.d)&&Array.isArray(data.d.results)) return {rows:data.d.results,next:data.d.__next??null};
  throw new TypeError('SAP OData response must contain value[] or d.results[]');
}
function observedTime(value,fallback){
  if(typeof value==='string'){
    const v=value.trim();
    const legacy=/^\/Date\((\d+)(?:[+-]\d{4})?\)\/$/.exec(v);
    if(legacy){
      const date=new Date(Number(legacy[1]));
      if(Number.isFinite(date.getTime())) return {time:date.toISOString(),fallback:false};
    }
    const date=new Date(v);
    if(Number.isFinite(date.getTime())) return {time:date.toISOString(),fallback:false};
  }
  return {time:fallback,fallback:true};
}
const SAP_PAYLOAD_FIELDS=[
  'Product','ProductionPlant','ManufacturingOrderType','ManufacturingOrderCategory',
  'MfgOrderPlannedStartDate','MfgOrderPlannedEndDate','MfgOrderPlannedTotalQty',
  'ProductionUnit','OrderIsCreated','OrderIsReleased','OrderIsClosed','LastChangeDateTime'
];
export function mapSapS4ProductionDemandPage({plan,execution}={}){
  if(plan.binding.providerId!=='sap-s4hana'||plan.mappingProfile!=='sap-s4-production-demand-v1') throw new Error('SAP production mapper received incompatible read plan');
  const receipt=validateExecution(plan,execution);
  const {rows,next}=odataRows(execution.data);
  if(rows.length>plan.pagination.top) throw new Error('SAP response exceeds requested $top');
  const seen=new Set();
  const records=rows.map(row=>{
    plainObject(row,'SAP production order');
    const order=required(row.ManufacturingOrder,'SAP ManufacturingOrder');
    if(seen.has(order)) throw new Error(`duplicate SAP ManufacturingOrder: ${order}`);
    seen.add(order);
    const payload={};
    for(const key of SAP_PAYLOAD_FIELDS) if(row[key]!==undefined&&row[key]!==null) payload[key]=row[key];
    const observed=observedTime(row.LastChangeDateTime,receipt.observedAt);
    if(observed.fallback) payload.observedAtFallback=true;
    return {
      eventId:`sap-s4hana:production-demand:${order}:${sha256(payload).slice(0,24)}`,
      eventType:'production_demand_snapshot',
      occurredAt:observed.time,
      sourceSystem:'sap-s4hana',
      sourceRecordId:order,
      ...(row.ProductionPlant?{siteExternalId:String(row.ProductionPlant)}:{}),
      payload
    };
  });
  return executionEnvelope(plan,execution,records,{
    schemaObservation:schemaObservation('sap-s4hana','A_ProductionOrder_2',rows,receipt.observedAt),
    page:freeze({count:rows.length,hasMore:Boolean(next),nextLinkPresent:Boolean(next),complete:!next})
  });
}
