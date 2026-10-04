import {createHash} from 'node:crypto';
import {validateConnectionEvidence} from './connection-test-plan.mjs';
import {mapCanonicalRecord} from './connector-mapping-spec.mjs';
import {assessBatchRun} from './batch-reconciliation.mjs';

function fail(message,code='WFM_FILE_BATCH_INVALID'){const e=new Error(message);e.code=code;throw e;}
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
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
const sha256Bytes=value=>createHash('sha256').update(value).digest('hex');
const sha256=value=>createHash('sha256').update(canonical(value)).digest('hex');
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function integer(value,name,min,max,defaultValue){
  const raw=value===undefined?defaultValue:value,n=Number(raw);
  if(!Number.isSafeInteger(n)||n<min||n>max)fail(name+' is outside supported bounds');
  return n;
}
function safeFileName(value){
  const name=text(value,'fileName',240);
  if(name==='.'||name==='..'||name.includes('/')||name.includes('\\')||name.includes('..')||name.startsWith('.'))fail('fileName must be a simple provider file name');
  return name;
}
function formatBytes(bytes){
  if(bytes instanceof Uint8Array)return Buffer.from(bytes);
  if(Buffer.isBuffer(bytes))return bytes;
  fail('file bytes must be a Uint8Array or Buffer');
}
function decodeUtf8(buffer){
  try{return new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{fail('file is not valid UTF-8','WFM_FILE_BATCH_ENCODING_INVALID');}
}
function headersList(value){
  if(!Array.isArray(value)||!value.length||value.length>500)fail('CSV headers must contain 1-500 columns');
  const seen=new Set();
  return value.map((v,i)=>{
    const h=text(v,'csv.headers['+i+']',120);
    if(seen.has(h))fail('duplicate CSV header '+h);
    seen.add(h);return h;
  });
}
function parseCsv(input,{delimiter=',',headers,maxRecords}){
  if(typeof delimiter!=='string'||delimiter.length!==1||![';',',','\t','|'].includes(delimiter))fail('unsupported CSV delimiter');
  const rows=[];let row=[],field='',quoted=false,i=0;
  const pushField=()=>{row.push(field);field='';};
  const pushRow=()=>{
    if(row.length===1&&row[0]===''&&rows.length===0)return;
    rows.push(row);row=[];
    if(rows.length>maxRecords+1)fail('CSV record count exceeds configured limit','WFM_FILE_BATCH_LIMIT');
  };
  while(i<input.length){
    const c=input[i];
    if(quoted){
      if(c==='"'){
        if(input[i+1]==='"'){field+='"';i+=2;continue;}
        quoted=false;i++;continue;
      }
      field+=c;i++;continue;
    }
    if(c==='"'){
      if(field.length)fail('CSV quote may only start an empty field');
      quoted=true;i++;continue;
    }
    if(c===delimiter){pushField();i++;continue;}
    if(c==='\r'||c==='\n'){
      pushField();pushRow();
      if(c==='\r'&&input[i+1]==='\n')i+=2;else i++;
      continue;
    }
    if(c==='\0')fail('CSV contains NUL byte');
    field+=c;i++;
  }
  if(quoted)fail('CSV ended inside a quoted field');
  if(field.length||row.length){pushField();pushRow();}
  if(!rows.length)fail('CSV file is empty');
  const actual=rows.shift().map(v=>v.trim());
  if(canonical(actual)!==canonical(headers))fail('CSV header does not match reviewed schema','WFM_FILE_BATCH_SCHEMA_MISMATCH');
  return rows.map((values,rowIndex)=>{
    if(values.length!==headers.length)fail('CSV row '+(rowIndex+2)+' has wrong column count','WFM_FILE_BATCH_SCHEMA_MISMATCH');
    return Object.fromEntries(headers.map((h,j)=>[h,values[j]]));
  });
}
function parseJsonArray(input,{maxRecords}){
  let value;
  try{value=JSON.parse(input);}catch{fail('JSON batch is invalid','WFM_FILE_BATCH_JSON_INVALID');}
  if(!Array.isArray(value))fail('JSON batch must be a top-level array','WFM_FILE_BATCH_JSON_INVALID');
  if(value.length>maxRecords)fail('JSON record count exceeds configured limit','WFM_FILE_BATCH_LIMIT');
  return value.map((item,i)=>{
    if(!item||typeof item!=='object'||Array.isArray(item)||(Object.getPrototypeOf(item)!==Object.prototype&&Object.getPrototypeOf(item)!==null))fail('JSON row '+i+' must be a plain object','WFM_FILE_BATCH_JSON_INVALID');
    return item;
  });
}
function supports(contract,target){
  if(!contract||contract.schemaVersion!==1||!contract.provider||!contract.binding)fail('valid connector contract required');
  if(!contract.transports.some(t=>t.adapter==='file-batch'))fail('connector does not declare file/SFTP transport','WFM_FILE_BATCH_TRANSPORT_UNAVAILABLE');
  if(!contract.resources.some(r=>r.target===target))fail('connector target unavailable '+target,'WFM_FILE_BATCH_TARGET_UNAVAILABLE');
}
function mappingFingerprint(spec){
  const value=text(spec?.mappingFingerprint,'mappingSpec.mappingFingerprint',80);
  if(!/^sha256:[a-f0-9]{64}$/.test(value))fail('mapping fingerprint is invalid');
  return value;
}

export function defineFileBatchRecipe(raw){
  const x=plain(raw,'file recipe');
  if(x.schemaVersion!==1)fail('file recipe schemaVersion must be 1');
  const format=text(x.format,'format',40);
  if(!['csv','json-array'].includes(format))fail('unsupported file batch format');
  const mode=text(x.datasetMode||'snapshot','datasetMode',40);
  if(!['snapshot','delta'].includes(mode))fail('datasetMode must be snapshot or delta');
  const recipe={
    schemaVersion:1,id:text(x.id,'id',128),providerId:text(x.providerId,'providerId',128),
    target:text(x.target,'target',128),dataset:text(x.dataset,'dataset',128),
    mappingProfile:text(x.mappingProfile,'mappingProfile',128),format,datasetMode:mode,
    fileName:{prefix:text(x.fileName?.prefix,'fileName.prefix',120),suffix:text(x.fileName?.suffix,'fileName.suffix',80)},
    maxBytes:integer(x.maxBytes,'maxBytes',1,64*1024*1024,16*1024*1024),
    maxRecords:integer(x.maxRecords,'maxRecords',1,1_000_000,100_000),
    csv:format==='csv'?{
      delimiter:x.csv?.delimiter??',',
      headers:headersList(x.csv?.headers)
    }:null
  };
  const schemaFingerprint='sha256:'+sha256({format:recipe.format,csv:recipe.csv,dataset:recipe.dataset});
  return freeze({...recipe,schemaFingerprint,recipeFingerprint:'sha256:'+sha256(recipe)});
}

export function acquireFileBatch({
  recipe,contract,connectionPlan,connectionEvidence,transportReceipt,bytes,mappingSpec,
  runId,previousCheckpoint=null,nowMs=Date.now(),maxConnectionAgeMs=30*60*1000
}={}){
  const r=recipe?.recipeFingerprint?recipe:defineFileBatchRecipe(recipe);
  if(contract?.provider?.id!==r.providerId)fail('file recipe provider mismatch','WFM_FILE_BATCH_BINDING_MISMATCH');
  supports(contract,r.target);
  if(!connectionPlan?.configuration)fail('connectionPlan is required');
  if(connectionPlan.configuration.providerKey!==contract.provider.id||
     connectionPlan.configuration.wfmTenantId!==contract.binding.tenantId||
     connectionPlan.configuration.connectionId!==contract.binding.connectionId||
     connectionPlan.configuration.adapter!=='file-batch')fail('file connection plan is not bound to connector contract','WFM_FILE_BATCH_BINDING_MISMATCH');
  const connection=validateConnectionEvidence(connectionPlan,connectionEvidence,{nowMs,maxAgeMs:maxConnectionAgeMs});
  if(!['CONNECTION_VERIFIED','CONNECTION_AND_SAMPLE_VERIFIED'].includes(connection.status))fail('file connection proof rejected: '+connection.reasons.join(', '),'WFM_FILE_BATCH_CONNECTION_NOT_VERIFIED');
  const receipt=plain(transportReceipt,'transportReceipt');
  const fileName=safeFileName(receipt.fileName);
  if(!fileName.startsWith(r.fileName.prefix)||!fileName.endsWith(r.fileName.suffix))fail('fileName is outside reviewed recipe','WFM_FILE_BATCH_FILENAME_REJECTED');
  for(const [key,want] of Object.entries({
    providerId:contract.provider.id,tenantId:contract.binding.tenantId,connectionId:contract.binding.connectionId,
    configurationFingerprint:connectionPlan.configurationFingerprint
  }))if(receipt[key]!==want)fail('transport receipt '+key+' does not match connector binding','WFM_FILE_BATCH_BINDING_MISMATCH');
  if(receipt.readOnly!==true||receipt.complete!==true||receipt.rawCredentialObserved===true)fail('transport receipt is not a complete read-only transfer','WFM_FILE_BATCH_TRANSPORT_NOT_VERIFIED');
  const observedAt=text(receipt.observedAt,'transportReceipt.observedAt',40);
  if(!Number.isFinite(Date.parse(observedAt)))fail('transportReceipt.observedAt is invalid');
  const buffer=formatBytes(bytes);
  if(buffer.byteLength>r.maxBytes)fail('file exceeds configured byte limit','WFM_FILE_BATCH_LIMIT');
  if(receipt.sizeBytes!==buffer.byteLength)fail('transport receipt size does not match file bytes','WFM_FILE_BATCH_CHECKSUM_MISMATCH');
  const fileHash=sha256Bytes(buffer);
  if(receipt.fileSha256!==fileHash)fail('transport receipt checksum does not match file bytes','WFM_FILE_BATCH_CHECKSUM_MISMATCH');
  const body=decodeUtf8(buffer);
  const rows=r.format==='csv'?parseCsv(body,{...r.csv,maxRecords:r.maxRecords}):parseJsonArray(body,{maxRecords:r.maxRecords});
  if(receipt.expectedRowCount!==undefined&&receipt.expectedRowCount!==null&&receipt.expectedRowCount!==rows.length)fail('transport receipt row count does not match parsed records','WFM_FILE_BATCH_SCHEMA_MISMATCH');
  const mapFp=mappingFingerprint(mappingSpec);
  const providerReceipt=freeze({
    schemaVersion:1,providerId:contract.provider.id,tenantId:contract.binding.tenantId,connectionId:contract.binding.connectionId,
    target:r.target,configurationFingerprint:connectionPlan.configurationFingerprint,
    requestFingerprint:'file:'+fileHash,responseSha256:fileHash,responseFormat:r.format==='csv'?'text':'json',
    contentType:r.format==='csv'?'text/csv':'application/json',httpStatus:200,observedAt,latencyMs:0,
    readOnly:true,checkpointAdvanceAllowed:false
  });
  const records=rows.map(row=>mapCanonicalRecord({spec:mappingSpec,providerId:contract.provider.id,sourceRecord:row,receipt:providerReceipt}));
  const identities=records.map(record=>r.target==='worker'?record.externalId:(record.sourceRecordId||record.eventId));
  const duplicates=identities.filter((id,i)=>identities.indexOf(id)!==i);
  const scope={
    providerId:contract.provider.id,connectionId:contract.binding.connectionId,resource:r.target,
    tenant:contract.binding.tenantId,environment:connectionPlan.configuration.environment,
    serverInstance:connectionPlan.configuration.sourceInstanceId,dataset:r.dataset
  };
  const sourceWatermark='sha256:'+fileHash;
  const reconciliation=assessBatchRun({
    provider:contract.provider.id,connector:'vector-file-'+r.target,runId:text(runId,'runId',128),
    scope,requiredScopeDimensions:['tenant','environment','serverInstance','dataset'],
    sourceWatermark,previousCheckpoint,watermarkKind:'opaque',rowCount:records.length,
    expectedRowCount:receipt.expectedRowCount??rows.length,complete:true,checksumVerified:true,schemaVerified:true,
    duplicateRowKeys:[...new Set(duplicates)],parseErrors:0,transferErrors:0,sourceDeclaresDelta:r.datasetMode==='delta'
  });
  const checkpointCandidate=reconciliation.safeToAdvanceWatermark?freeze({
    schemaVersion:1,scopeNamespace:reconciliation.scopeNamespace,watermark:sourceWatermark,
    watermarkKind:'opaque',runId,rowCount:records.length
  }):null;
  return freeze({
    schemaVersion:1,status:reconciliation.safeToCommit?'SAFE_TO_STAGE':'QUARANTINED',
    providerId:contract.provider.id,tenantId:contract.binding.tenantId,connectionId:contract.binding.connectionId,
    target:r.target,dataset:r.dataset,runId,records,sourceWatermark,
    schemaFingerprints:[r.schemaFingerprint],mappingProfiles:[r.mappingProfile],mappingFingerprint:mapFp,
    receiptCount:1,diagnostics:[],reconciliation,checkpointCandidate,
    deletionAuthority:false,customerProofClaimAllowed:false,
    file:{fileName,sizeBytes:buffer.byteLength,fileSha256:fileHash,format:r.format}
  });
}
