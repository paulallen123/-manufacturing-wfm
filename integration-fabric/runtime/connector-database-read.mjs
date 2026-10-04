import {createHash} from 'node:crypto';
import {validateConnectionEvidence} from './connection-test-plan.mjs';
import {mapCanonicalRecord} from './connector-mapping-spec.mjs';
import {assessBatchRun} from './batch-reconciliation.mjs';

const DIALECTS=new Set(['postgresql','mysql','mssql','oracle','ansi']);
const CREDENTIAL=/(password|passwd|secret|token|authorization|credential|api[_-]?key|client[_-]?secret|private[_-]?key)/i;

function fail(message,code='WFM_DATABASE_READ_INVALID'){const e=new Error(message);e.code=code;throw e;}
function text(value,name,max=256){
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
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(function(k){return JSON.stringify(k)+':'+canonical(value[k]);}).join(',')+'}';
  return JSON.stringify(value);
}
const sha256=value=>createHash('sha256').update(canonical(value)).digest('hex');
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function integer(value,name,min,max,defaultValue){
  const raw=value===undefined?defaultValue:value,n=Number(raw);
  if(!Number.isSafeInteger(n)||n<min||n>max)fail(name+' is outside supported bounds');
  return n;
}
function identifier(value,name){
  const v=text(value,name,128);
  if(!/^[A-Za-z_][A-Za-z0-9_$#]*$/.test(v)||CREDENTIAL.test(v))fail(name+' is not a safe database identifier');
  return v;
}
function qualifiedIdentifier(value,name){
  const parts=text(value,name,260).split('.');
  if(parts.length<1||parts.length>3)fail(name+' must have 1-3 identifier segments');
  return parts.map(function(p,i){return identifier(p,name+'['+i+']');}).join('.');
}
function columns(value){
  if(!Array.isArray(value)||!value.length||value.length>200)fail('columns must contain 1-200 entries');
  const list=value.map(function(v,i){return identifier(v,'columns['+i+']');});
  if(new Set(list).size!==list.length)fail('columns must be unique');
  return list;
}
function supports(contract,target){
  if(!contract||contract.schemaVersion!==1||!contract.provider||!contract.binding)fail('valid connector contract required');
  if(!contract.transports.some(function(t){return t.adapter==='database-readmodel';}))fail('connector does not declare database transport','WFM_DATABASE_TRANSPORT_UNAVAILABLE');
  if(!contract.resources.some(function(r){return r.target===target;}))fail('connector target unavailable '+target,'WFM_DATABASE_TARGET_UNAVAILABLE');
}
function mappingFingerprint(spec){
  const value=text(spec&&spec.mappingFingerprint,'mappingSpec.mappingFingerprint',80);
  if(!/^sha256:[a-f0-9]{64}$/.test(value))fail('mapping fingerprint is invalid');
  return value;
}
function fixedSelect(recipe){
  const select=recipe.columns.join(', ');
  const where=recipe.checkpoint?' WHERE '+recipe.checkpoint.column+' > ?':'';
  const order=' ORDER BY '+recipe.orderBy.join(', ');
  if(recipe.dialect==='mssql')return 'SELECT TOP '+recipe.pageSize+' '+select+' FROM '+recipe.sourceView+where+order;
  if(recipe.dialect==='postgresql'||recipe.dialect==='mysql')return 'SELECT '+select+' FROM '+recipe.sourceView+where+order+' LIMIT '+recipe.pageSize;
  return 'SELECT '+select+' FROM '+recipe.sourceView+where+order+' FETCH FIRST '+recipe.pageSize+' ROWS ONLY';
}
function checkpointBindings(rule,value){
  if(!rule)return [];
  if(value===undefined||value===null||value==='')fail('checkpointValue is required','WFM_DATABASE_CHECKPOINT_INVALID');
  if(rule.kind==='integer'){
    const s=String(value);
    if(!/^(0|[1-9]\d*)$/.test(s))fail('integer checkpoint must be an unsigned decimal string','WFM_DATABASE_CHECKPOINT_INVALID');
    return [s];
  }
  if(rule.kind==='iso8601'){
    const s=text(String(value),'checkpointValue',64);
    if(!Number.isFinite(Date.parse(s)))fail('timestamp checkpoint is invalid','WFM_DATABASE_CHECKPOINT_INVALID');
    return [new Date(s).toISOString()];
  }
  return [text(String(value),'checkpointValue',512)];
}
function exactKeys(row,expected,rowIndex){
  plain(row,'database row '+rowIndex);
  const actual=Object.keys(row).sort(),want=expected.slice().sort();
  if(canonical(actual)!==canonical(want))fail('database row columns do not match reviewed schema','WFM_DATABASE_SCHEMA_MISMATCH');
  return row;
}

export function defineDatabaseReadRecipe(raw){
  const x=plain(raw,'database recipe');
  if(x.schemaVersion!==1)fail('database recipe schemaVersion must be 1');
  const dialect=text(x.dialect,'dialect',32).toLowerCase();
  if(!DIALECTS.has(dialect))fail('unsupported database dialect');
  const cols=columns(x.columns);
  const orderBy=(Array.isArray(x.orderBy)&&x.orderBy.length?x.orderBy:[cols[0]]).map(function(v,i){return identifier(v,'orderBy['+i+']');});
  if(orderBy.some(function(v){return !cols.includes(v);}))fail('orderBy must use reviewed columns');
  let checkpoint=null;
  if(x.checkpoint){
    const cp=plain(x.checkpoint,'checkpoint');
    const column=identifier(cp.column,'checkpoint.column');
    if(!cols.includes(column))fail('checkpoint column must be a reviewed column');
    const kind=text(cp.kind||'opaque','checkpoint.kind',32);
    if(!['opaque','integer','iso8601'].includes(kind))fail('unsupported checkpoint kind');
    checkpoint={column:column,kind:kind};
  }
  const recipe={
    schemaVersion:1,id:text(x.id,'id',128),providerId:text(x.providerId,'providerId',128),
    target:text(x.target,'target',128),dataset:text(x.dataset,'dataset',128),
    mappingProfile:text(x.mappingProfile,'mappingProfile',128),dialect:dialect,
    sourceView:qualifiedIdentifier(x.sourceView,'sourceView'),columns:cols,orderBy:orderBy,
    checkpoint:checkpoint,datasetMode:text(x.datasetMode||'snapshot','datasetMode',32),
    pageSize:integer(x.pageSize,'pageSize',1,10000,1000),
    maxRows:integer(x.maxRows,'maxRows',1,1000000,100000)
  };
  if(!['snapshot','delta'].includes(recipe.datasetMode))fail('datasetMode must be snapshot or delta');
  const query=fixedSelect(recipe);
  return freeze(Object.assign({},recipe,{
    query:query,
    queryFingerprint:'sha256:'+sha256({dialect:dialect,query:query}),
    schemaFingerprint:'sha256:'+sha256({columns:cols,sourceView:recipe.sourceView})
  }));
}

export async function acquireDatabaseRead(args={}){
  const recipe=args.recipe,contract=args.contract,connectionPlan=args.connectionPlan,connectionEvidence=args.connectionEvidence;
  const mappingSpec=args.mappingSpec,databaseExecutor=args.databaseExecutor,runId=args.runId;
  const previousCheckpoint=args.previousCheckpoint??null,nowMs=args.nowMs??Date.now();
  const maxConnectionAgeMs=args.maxConnectionAgeMs??30*60*1000;
  const r=recipe&&recipe.queryFingerprint?recipe:defineDatabaseReadRecipe(recipe);
  if(contract&&contract.provider&&contract.provider.id!==r.providerId)fail('database recipe provider mismatch','WFM_DATABASE_BINDING_MISMATCH');
  supports(contract,r.target);
  if(typeof databaseExecutor!=='function')throw new TypeError('databaseExecutor is required');
  if(!connectionPlan||!connectionPlan.configuration||
     connectionPlan.configuration.providerKey!==contract.provider.id||
     connectionPlan.configuration.wfmTenantId!==contract.binding.tenantId||
     connectionPlan.configuration.connectionId!==contract.binding.connectionId||
     connectionPlan.configuration.adapter!=='database-readmodel')fail('database connection is not bound to connector contract','WFM_DATABASE_BINDING_MISMATCH');
  const connection=validateConnectionEvidence(connectionPlan,connectionEvidence,{nowMs:nowMs,maxAgeMs:maxConnectionAgeMs});
  if(!['CONNECTION_VERIFIED','CONNECTION_AND_SAMPLE_VERIFIED'].includes(connection.status))fail('database connection proof rejected: '+connection.reasons.join(', '),'WFM_DATABASE_CONNECTION_NOT_VERIFIED');
  const bindings=checkpointBindings(r.checkpoint,args.checkpointValue??null);
  const authority=freeze({
    schemaVersion:1,providerId:contract.provider.id,tenantId:contract.binding.tenantId,connectionId:contract.binding.connectionId,
    configurationFingerprint:connectionPlan.configurationFingerprint,sourceView:r.sourceView,
    query:r.query,queryFingerprint:r.queryFingerprint,bindings:bindings,maxRows:r.pageSize,
    readOnly:true,transactionMode:'read-only',writeAllowed:false,ddlAllowed:false,procedureCallAllowed:false
  });
  const result=plain(await databaseExecutor(authority),'database result');
  const expected={
    providerId:contract.provider.id,tenantId:contract.binding.tenantId,connectionId:contract.binding.connectionId,
    configurationFingerprint:connectionPlan.configurationFingerprint,queryFingerprint:r.queryFingerprint
  };
  for(const key of Object.keys(expected))if(result[key]!==expected[key])fail('database result '+key+' does not match authority','WFM_DATABASE_RESULT_MISMATCH');
  if(result.readOnlyTransaction!==true||result.complete!==true)fail('database executor did not prove a complete read-only transaction','WFM_DATABASE_RESULT_NOT_VERIFIED');
  const observedAt=text(result.observedAt,'database result observedAt',40);
  if(!Number.isFinite(Date.parse(observedAt)))fail('database result observedAt invalid');
  if(!Array.isArray(result.rows)||result.rows.length>r.pageSize||result.rows.length>r.maxRows)fail('database result exceeds row bounds','WFM_DATABASE_LIMIT');
  const rows=result.rows.map(function(row,i){return exactKeys(row,r.columns,i);});
  if(result.rowCount!==rows.length)fail('database result rowCount does not match rows','WFM_DATABASE_RESULT_MISMATCH');
  if(result.schemaFingerprint!==r.schemaFingerprint)fail('database schema fingerprint drifted','WFM_DATABASE_SCHEMA_MISMATCH');
  const mapFp=mappingFingerprint(mappingSpec);
  const providerReceipt=freeze({
    schemaVersion:1,providerId:contract.provider.id,tenantId:contract.binding.tenantId,connectionId:contract.binding.connectionId,
    target:r.target,configurationFingerprint:connectionPlan.configurationFingerprint,
    requestFingerprint:r.queryFingerprint,responseSha256:sha256(rows),responseFormat:'json',
    contentType:'application/x-vector-database-rows',httpStatus:200,observedAt:observedAt,
    latencyMs:integer(result.latencyMs,'latencyMs',0,120000,0),readOnly:true,checkpointAdvanceAllowed:false
  });
  const records=rows.map(function(row){return mapCanonicalRecord({spec:mappingSpec,providerId:contract.provider.id,sourceRecord:row,receipt:providerReceipt});});
  const identities=records.map(function(record){return r.target==='worker'?record.externalId:(record.sourceRecordId||record.eventId);});
  const duplicates=identities.filter(function(id,i){return identities.indexOf(id)!==i;});
  const scope={
    providerId:contract.provider.id,connectionId:contract.binding.connectionId,resource:r.target,
    tenant:contract.binding.tenantId,environment:connectionPlan.configuration.environment,
    serverInstance:connectionPlan.configuration.sourceInstanceId,dataset:r.dataset
  };
  const sourceWatermark='sha256:'+sha256(records);
  const reconciliation=assessBatchRun({
    provider:contract.provider.id,connector:'vector-db-'+r.target,runId:text(runId,'runId',128),
    scope:scope,requiredScopeDimensions:['tenant','environment','serverInstance','dataset'],
    sourceWatermark:sourceWatermark,previousCheckpoint:previousCheckpoint,watermarkKind:'opaque',
    rowCount:records.length,expectedRowCount:rows.length,complete:true,checksumVerified:true,schemaVerified:true,
    duplicateRowKeys:Array.from(new Set(duplicates)),parseErrors:0,transferErrors:0,sourceDeclaresDelta:r.datasetMode==='delta'
  });
  const checkpointCandidate=reconciliation.safeToAdvanceWatermark?freeze({
    schemaVersion:1,scopeNamespace:reconciliation.scopeNamespace,watermark:sourceWatermark,
    watermarkKind:'opaque',runId:runId,rowCount:records.length
  }):null;
  return freeze({
    schemaVersion:1,status:reconciliation.safeToCommit?'SAFE_TO_STAGE':'QUARANTINED',
    providerId:contract.provider.id,tenantId:contract.binding.tenantId,connectionId:contract.binding.connectionId,
    target:r.target,dataset:r.dataset,runId:runId,records:records,sourceWatermark:sourceWatermark,
    schemaFingerprints:[r.schemaFingerprint],mappingProfiles:[r.mappingProfile],mappingFingerprint:mapFp,
    receiptCount:1,diagnostics:[],reconciliation:reconciliation,checkpointCandidate:checkpointCandidate,
    deletionAuthority:false,customerProofClaimAllowed:false,
    database:{sourceView:r.sourceView,queryFingerprint:r.queryFingerprint,rowCount:rows.length}
  });
}
