'use strict';
// Repair proposal for the supplied adapter. NOT deployed or wired into VECTOR.
// All effects require an externally verified server-side authority/ownership boundary.
const {createHash} = require('node:crypto');
const ORIGIN = 'https://api.staffology.co.uk';

class StaffologyError extends Error {
  constructor(message, {code='STAFFOLOGY_INVALID', status=400, retryable=false}={}) {
    super(message); this.name='StaffologyError'; this.code=code; this.status=status; this.retryable=retryable;
  }
}
const failure=(code,message,status=409)=>new StaffologyError(message,{code,status});
const clean=(value,maximum=180)=>String(value??'').trim().replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').slice(0,maximum);
function requiredId(value,label) {
  if(typeof value!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/.test(value))
    throw failure('STAFFOLOGY_IDENTITY_INVALID',`${label} is invalid.`,400);
  return value;
}
function exactText(value,label,max=80) {
  if(typeof value!=='string'||!value||value!==value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))
    throw failure('STAFFOLOGY_INVALID',`${label} is invalid.`,400);
  return value;
}
function canonical(value,depth=0) {
  if(depth>64)throw failure('STAFFOLOGY_JSON_INVALID','JSON depth exceeds the evidence limit.');
  if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value))return '['+Array.from(value,v=>canonical(v,depth+1)).join(',')+']';
  if(value&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value)))
    return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k],depth+1)).join(',')+'}';
  throw failure('STAFFOLOGY_JSON_INVALID','Evidence must be finite, plain JSON.');
}
const sha256=value=>createHash('sha256').update(canonical(value)).digest('hex');
const bytesHash=value=>createHash('sha256').update(value).digest('hex');
function immutable(value) {
  const copy=JSON.parse(canonical(value));
  function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
  return freeze(copy);
}
function dateOnly(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw failure('STAFFOLOGY_EFFECTIVE_DATE_INVALID','A complete calendar date is required.',400);
  const parsed=new Date(value+'T00:00:00Z');
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)throw failure('STAFFOLOGY_EFFECTIVE_DATE_INVALID','Calendar date is invalid.',400);
  return value;
}
function integer(value,label,min,max) {
  if(!Number.isSafeInteger(value)||value<min||value>max)throw failure('STAFFOLOGY_INVALID',`${label} is outside the supported range.`,400);
  return value;
}
function validatedOrigin(value) {
  let url;try{url=new URL(value);}catch{throw failure('STAFFOLOGY_CONFIG_INVALID','Invalid provider origin.',503);}
  if(url.origin!==ORIGIN||url.username||url.password||url.search||url.hash||url.pathname!=='/')
    throw failure('STAFFOLOGY_CONFIG_INVALID','Only the approved Staffology API origin is allowed.',503);
  return ORIGIN;
}
function loadConfiguration(env=process.env) {
  const apiKey=env.STAFFOLOGY_API_KEY;
  if(typeof apiKey!=='string'||apiKey.length<16||/[\r\n\u0000]/.test(apiKey))throw failure('STAFFOLOGY_AUTH_MISSING','Staffology credential is unavailable.',503);
  return Object.freeze({apiKey,baseUrl:validatedOrigin(env.STAFFOLOGY_BASE_URL||ORIGIN),timeoutMs:10000});
}

async function request(client,config,path,{method='GET',body,acceptedStatuses=[],authorizeWrite}={}) {
  const validated=loadConfiguration({STAFFOLOGY_API_KEY:config?.apiKey,STAFFOLOGY_BASE_URL:config?.baseUrl});
  if(typeof client!=='function'||typeof path!=='string'||!path.startsWith('/')||path.startsWith('//')||/[\\\r\n#]/.test(path))throw failure('STAFFOLOGY_CONFIG_INVALID','Invalid request destination.',503);
  const url=new URL(path,validated.baseUrl);
  if(url.origin!==ORIGIN||!['GET','POST'].includes(method))throw failure('STAFFOLOGY_CONFIG_INVALID','Request is outside the supported contract.',503);
  const isWrite=method!=='GET';
  const encoded=body===undefined?undefined:canonical(body);
  if(isWrite) {
    if(!/^\/employers\/[A-Za-z0-9_.:-]+\/payrun\/[A-Za-z]+\/importpay$/.test(url.pathname)||typeof authorizeWrite!=='function')
      throw failure('STAFFOLOGY_WRITE_NOT_AUTHORIZED','Payroll import requires verified server-side authority.',403);
    if(await authorizeWrite({method,path:url.pathname+url.search,bodySha256:bytesHash(encoded||'')})!==true)
      throw failure('STAFFOLOGY_WRITE_NOT_AUTHORIZED','Payroll import authority was not granted.',403);
  }
  const headers={accept:'application/json',authorization:'Basic '+Buffer.from('vector:'+validated.apiKey,'utf8').toString('base64')};
  if(encoded!==undefined)headers['content-type']='application/json';
  const timeoutMs=integer(config?.timeoutMs??validated.timeoutMs,'Request deadline',1,60000);
  const deadlineAt=performance.now()+timeoutMs;
  const checkDeadline=()=>{if(controller.signal.aborted||performance.now()>=deadlineAt)throw Error('REQUEST_DEADLINE');};
  const controller=new AbortController();let timer,reader,responseBody;
  const cancel=()=>{controller.abort();const stream=reader||responseBody;if(typeof stream?.cancel==='function')void Promise.resolve(stream.cancel()).catch(()=>{});};
  const deadline=new Promise((resolve,reject)=>{timer=setTimeout(()=>{cancel();reject(Error('REQUEST_DEADLINE'));},timeoutMs);});
  let result;
  try {
    result=await Promise.race([deadline,(async()=>{
      const response=await client(url.toString(),{method,headers,body:encoded,redirect:'error',signal:controller.signal});
      responseBody=response?.body;
      try{checkDeadline();}catch(error){cancel();throw error;}
      const status=response?.status;
      if(!Number.isInteger(status))throw failure('STAFFOLOGY_RESPONSE_INVALID','Provider status is invalid.',502);
      // Status remains authoritative even when error bodies are HTML/plain text.
      if(status===401||status===403)throw failure('STAFFOLOGY_AUTH_REJECTED','Staffology authentication failed.',502);
      if(!(status>=200&&status<300)&&!acceptedStatuses.includes(status))throw new StaffologyError(`Staffology returned HTTP ${status}.`,{code:'STAFFOLOGY_PROVIDER_ERROR',status:502,retryable:!isWrite&&(status===429||status>=500)});
      if(acceptedStatuses.includes(status)&&status===404){cancel();return {status,body:null,requestId:null};}
      // Never call text(): enforce the byte bound while consuming the stream.
      // Content-Length is untrusted and compressed responses can expand.
      const buffer=Buffer.allocUnsafe(4*1024*1024);let bytes=0;
      if(response.body!==null) {
        if(typeof response.body?.getReader!=='function')throw failure('STAFFOLOGY_RESPONSE_INVALID','Provider response requires a bounded readable body.',502);
        reader=response.body.getReader();
        while(true) {
          checkDeadline();
          const {done,value}=await reader.read();
          checkDeadline();
          if(done)break;
          if(!(value instanceof Uint8Array))throw failure('STAFFOLOGY_RESPONSE_INVALID','Provider stream must contain bytes.',502);
          if(bytes+value.byteLength>buffer.length)throw failure('STAFFOLOGY_RESPONSE_INVALID','Provider response exceeds the size limit.',502);
          buffer.set(value,bytes);bytes+=value.byteLength;
        }
      }
      const text=buffer.toString('utf8',0,bytes);
      let parsed=null;
      if(text){try{parsed=JSON.parse(text);canonical(parsed);}catch{throw failure('STAFFOLOGY_RESPONSE_INVALID','Provider response is not valid finite JSON.',502);}}
      checkDeadline();
      return {body:parsed,status,requestId:clean(response.headers?.get?.('x-request-id'),180)||null,responseSha256:bytesHash(text),requestSha256:encoded===undefined?null:bytesHash(encoded)};
    })()]);
  } catch(error) {
    cancel();
    if(error instanceof StaffologyError&&(!isWrite||['STAFFOLOGY_AUTH_REJECTED','STAFFOLOGY_PROVIDER_ERROR'].includes(error.code)))throw error;
    throw new StaffologyError(isWrite?'Staffology write requires reconciliation.':'Staffology read failed.',{code:isWrite?'STAFFOLOGY_OUTCOME_UNCERTAIN':'STAFFOLOGY_TRANSPORT_ERROR',status:503,retryable:!isWrite});
  } finally {clearTimeout(timer);}
  return result;
}

function mapEmployee(record,context) {
  const employerId=requiredId(context?.employerId,'Employer identity');
  const employeeId=requiredId(record?.id,'Employee identity');
  if(record.employerId!==undefined&&record.employerId!==employerId)throw failure('STAFFOLOGY_EMPLOYER_MISMATCH','Employee belongs to another employer.');
  if(context.employeeId&&context.employeeId!==employeeId)throw failure('STAFFOLOGY_RESPONSE_IDENTITY_MISMATCH','Employee detail identity differs from the list.');
  const personal=record.personalDetails,employment=record.employmentDetails;
  if(!personal||!employment||Array.isArray(personal)||Array.isArray(employment))throw failure('STAFFOLOGY_RESPONSE_INVALID','Complete nested employee details are required.',502);
  const effectiveFrom=dateOnly(employment.starterDetails?.startDate);
  const payrollCode=exactText(employment.payrollCode,'Payroll code');
  const effectiveTo=employment.leaverDetails?.leaveDate?dateOnly(employment.leaverDetails.leaveDate):null;
  if(effectiveTo&&effectiveTo<effectiveFrom)throw failure('STAFFOLOGY_EFFECTIVE_DATE_INVALID','Employment ends before it starts.');
  if((employment.leaverDetails?.hasLeft===true||record.status==='Former')&&!effectiveTo)throw failure('STAFFOLOGY_EFFECTIVE_DATE_INVALID','A leaver date is required.');
  if(record.status!==undefined&&!['Current','Former','Upcoming'].includes(record.status))throw failure('STAFFOLOGY_RESPONSE_INVALID','Employee status is not recognized.',502);
  const person={firstName:clean(personal.firstName,120),lastName:clean(personal.lastName,120),email:clean(personal.email,254)};
  if(!person.firstName||!person.lastName)throw failure('STAFFOLOGY_RESPONSE_INVALID','Required Person name fields are missing.',502);
  const canonicalPerson={employeeId,...person,startDate:effectiveFrom};
  if(record.status!==undefined)canonicalPerson.status=record.status;
  if(effectiveTo)canonicalPerson.endDate=effectiveTo;
  if(employment.jobTitle)canonicalPerson.jobTitle=clean(employment.jobTitle,120);
  if(employment.department?.title)canonicalPerson.department=clean(employment.department.title,120);
  const identity={provider:'staffology',employerId,employeeId,payrollCode};
  const employmentData={effectiveFrom,effectiveTo,status:record.status??null};
  const revision='sha256:'+sha256({identity,canonicalPerson,employment:employmentData});
  return {externalId:employeeId,revision,operation:'upsert',canonicalPerson,
    data:{identity,person,employment:employmentData,provenance:{provider:'staffology',acquiredAt:context.acquiredAt??null,sourcePath:context.sourcePath??null,sourceRevision:record.revision??record.updatedAt??null,revisionKind:'derived-mapped-content-sha256'}}};
}
async function acquireEmployees({client=globalThis.fetch,config,employerId,pageSize=100,maxPages=1000,now=Date.now}) {
  const employer=requiredId(employerId,'Employer identity');integer(pageSize,'Page size',1,500);integer(maxPages,'Page limit',1,10000);
  const seen=new Set(),records=[];let complete=false,pageNum=0;
  for(;pageNum<maxPages;pageNum++) {
    const listPath=`/employers/${encodeURIComponent(employer)}/employees?pageNum=${pageNum}&pageSize=${pageSize}`;
    const result=await request(client,config,listPath);
    if(!Array.isArray(result.body)||result.body.length>pageSize)throw failure('STAFFOLOGY_PAGINATION_INCOMPLETE','Employee page is outside the documented Item[] contract.',502);
    for(const item of result.body) {
      const id=requiredId(item?.id,'List employee identity');
      if(seen.has(id))throw failure('STAFFOLOGY_DUPLICATE_EMPLOYEE','Duplicate employee ID in paginated acquisition.');
      seen.add(id);
      const detailPath=`/employers/${encodeURIComponent(employer)}/employees/${encodeURIComponent(id)}`;
      // Item URLs are not followed: construct a same-origin, same-employer path.
      if(item.url){let itemUrl;try{itemUrl=new URL(item.url,ORIGIN);}catch{throw failure('STAFFOLOGY_RESPONSE_INVALID','Invalid employee item URL.',502);}
        if(itemUrl.origin!==ORIGIN||itemUrl.pathname!==detailPath||itemUrl.search||itemUrl.hash||itemUrl.username||itemUrl.password)throw failure('STAFFOLOGY_RESPONSE_IDENTITY_MISMATCH','Employee item URL contradicts its identity.');}
      const detail=await request(client,config,detailPath);
      records.push(mapEmployee(detail.body,{employerId:employer,employeeId:id,acquiredAt:new Date(now()).toISOString(),sourcePath:detailPath}));
    }
    if(result.body.length<pageSize){complete=true;break;}
  }
  if(!complete)throw failure('STAFFOLOGY_PAGINATION_INCOMPLETE','Page bound reached without a terminal short page.',502);
  const identityHashes=records.map(r=>[r.externalId,r.revision]).sort((a,b)=>a[0].localeCompare(b[0]));
  return {objectType:'people',cursor:`pageNum:${pageNum}`,sourceVersion:sha256({employer,records:identityHashes}),records,
    paginationComplete:true,atomicProviderSnapshot:false};
}

// Exact decimal arithmetic for the declared hourly-basic contract. Not a tax engine.
function decimal(value) {
  const s=typeof value==='number'&&Number.isFinite(value)?String(value):value;
  if(typeof s!=='string'||!/^\d{1,9}(?:\.\d{1,6})?$/.test(s))throw failure('STAFFOLOGY_PAYROLL_LINE_INVALID','Expected a bounded non-negative decimal.',400);
  const [whole,fraction='']=s.split('.');return {n:BigInt(whole+fraction),scale:fraction.length,text:s};
}
function decimalEqual(a,b){const x=decimal(a),y=decimal(b);return x.n*10n**BigInt(y.scale)===y.n*10n**BigInt(x.scale);}
function amountProduct(hours,rate,rounding) {
  const a=decimal(hours),b=decimal(rate),numerator=a.n*b.n*100n,denominator=10n**BigInt(a.scale+b.scale);
  let cents=numerator/denominator;const rest=numerator%denominator;
  if(rounding==='exact-cent'&&rest!==0n)throw failure('STAFFOLOGY_ROUNDING_AUTHORITY_REQUIRED','Sub-cent result needs an explicit approved rounding policy.');
  if(!['exact-cent','half-up'].includes(rounding))throw failure('STAFFOLOGY_ROUNDING_AUTHORITY_REQUIRED','Declare the approved rounding policy.');
  if(rounding==='half-up'&&2n*rest>=denominator)cents++;
  if(cents>99999999999n)throw failure('STAFFOLOGY_PAYROLL_LINE_INVALID','Calculated pay is outside the bounded contract.',400);
  return `${cents/100n}.${String(cents%100n).padStart(2,'0')}`;
}
function mapPayroll(input) {
  const employerId=requiredId(input?.employerId,'Employer identity'),employeeId=requiredId(input?.employeeId,'Employee identity');
  const payrollCode=exactText(input?.payrollCode,'Payroll code');
  const effectiveDate=dateOnly(input?.effectiveDate);
  if(input.mode!=='hourly-basic-replacement'||!Array.isArray(input.lines)||input.lines.length!==1)throw failure('STAFFOLOGY_MAPPING_AUTHORITY_REQUIRED','This proposal supports one explicitly mapped hourly basic replacement only.');
  const line=input.lines[0],code=exactText(line?.code,'Basic pay code');
  const hours=decimal(line.hours),rate=decimal(line.rate),rounding=input.rounding;
  const expectedBasicPay=amountProduct(line.hours,line.rate,rounding);
  if(typeof input.taxYear!=='string'||!/^Year\d{4}$/.test(input.taxYear)||!['Monthly','Weekly','Fortnightly','FourWeekly','Quarterly','HalfYearly','Annual','Daily','Custom'].includes(input.payPeriod))throw failure('STAFFOLOGY_RUN_IDENTITY_INVALID','Explicit payroll run coordinates are required.');
  const run={taxYear:input.taxYear,payPeriod:input.payPeriod,periodNumber:integer(input.periodNumber,'Period',1,366),ordinal:integer(input.ordinal,'Ordinal',1,1000),version:integer(input.version,'Version',0,100000)};
  const entryId=requiredId(input.entryId,'Provider entry identity');
  const source={system:'VECTOR',tenant:requiredId(input.tenant,'Tenant identity'),batchId:requiredId(input.batchId,'Batch identity'),revision:exactText(input.sourceRevision,'Source revision',100)};
  const importBody=[{payrollCode,basis:'Hourly',payCode:code,payAmount:Number(rate.text),payAmountMultiplier:Number(hours.text),lines:[]}];
  if(!decimalEqual(importBody[0].payAmount,rate.text)||!decimalEqual(importBody[0].payAmountMultiplier,hours.text))throw failure('STAFFOLOGY_PAYROLL_LINE_INVALID','Wire conversion changed a decimal value.');
  return immutable({employerId,employeeId,entryId,payrollCode,effectiveDate,run,source,mode:input.mode,rounding,expectedBasicPay,basic:{code,hours:hours.text,rate:rate.text},importBody});
}

function financialSnapshot(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw failure('STAFFOLOGY_RESPONSE_INVALID','A complete evidence object is required.',502);
  // Deliberately preserve the whole private evidence object. It may contain PII:
  // callers MUST store it in their existing restricted evidence store, never logs.
  const snapshot=immutable(value);return Object.freeze({snapshot,sha256:sha256(snapshot)});
}
function compareFinancialSnapshots(left,right) {
  const a=financialSnapshot(left),b=financialSnapshot(right),differences=[];
  const kind=v=>v===null?'null':Array.isArray(v)?'array':typeof v;
  function compare(x,y,p) {
    if(kind(x)!==kind(y)){differences.push({path:p,expectedType:kind(x),actualType:kind(y)});return;}
    if(x===undefined&&y===undefined)return;
    if(canonical(x)===canonical(y))return;
    if(x===null||typeof x!=='object'){differences.push({path:p,expected:x,actual:y});return;}
    if(Array.isArray(x)&&x.length!==y.length)differences.push({path:p+'.length',expected:x.length,actual:y.length});
    for(const key of [...new Set([...Object.keys(x),...Object.keys(y)])].sort())compare(x[key],y[key],p+'.'+key);
  }
  compare(a.snapshot,b.snapshot,'$');return {matches:a.sha256===b.sha256,expectedSha256:a.sha256,actualSha256:b.sha256,differences};
}
function validateRun(actual,expected,versionField='version') {
  for(const [field,want] of Object.entries({taxYear:expected.run.taxYear,payPeriod:expected.run.payPeriod,period:expected.run.periodNumber,ordinal:expected.run.ordinal,[versionField]:expected.run.version}))
    if(actual?.[field]!==want)throw failure('STAFFOLOGY_RUN_IDENTITY_MISMATCH',`Provider run ${field} differs from the authorised target.`);
  if(actual.state!=='Open'||actual.isClosed===true)throw failure('STAFFOLOGY_RUN_NOT_OPEN','The selected payroll draft is not open.');
}
function validateEntryIdentity(entry,expected) {
  validateRun(entry,expected,'payRunVersion');
  if(entry.isRemoved===true||entry.isRolledBack===true||entry.isLatestVersion===false)throw failure('STAFFOLOGY_ENTRY_NOT_CURRENT','Removed, rolled-back or obsolete entries cannot be written.');
  if(entry?.id!==expected.entryId||entry?.employee?.id!==expected.employeeId||entry?.employmentDetails?.payrollCode!==expected.payrollCode)
    throw failure('STAFFOLOGY_RESPONSE_IDENTITY_MISMATCH','Provider employee, entry or payroll code mismatch.');
  if(entry.employerId!==undefined&&entry.employerId!==expected.employerId)throw failure('STAFFOLOGY_RESPONSE_IDENTITY_MISMATCH','Provider employer mismatch.');
}
function validateProviderResponse(observation,expected) {
  if(observation?.employerId!==expected.employerId)throw failure('STAFFOLOGY_RESPONSE_IDENTITY_MISMATCH','Readback employer path is not bound.');
  validateRun(observation.run,expected);validateEntryIdentity(observation.entry,expected);
  const e=observation.entry,p=e.payOptions;
  if(!p||p.basis!=='Hourly'||!decimalEqual(p.payAmount,expected.basic.rate)||!decimalEqual(p.payAmountMultiplier,expected.basic.hours))throw failure('STAFFOLOGY_FINANCIAL_MISMATCH','Provider rate, hours or basis do not match.');
  if(p.payCode!==expected.basic.code)throw failure('STAFFOLOGY_FINANCIAL_MISMATCH','Provider basic pay code does not match.');
  if(!e.totals||typeof e.totals!=='object'||Array.isArray(e.totals))throw failure('STAFFOLOGY_FINANCIAL_EVIDENCE_MISSING','Calculated provider totals are missing.');
  // PayRunTotals suppresses zero properties. Only the documented missing zero
  // field within a PRESENT totals object is normalized, never an absent object.
  const actual=e.totals.basicPay===undefined&&decimalEqual(expected.expectedBasicPay,'0')?0:e.totals.basicPay;
  if(!decimalEqual(actual,expected.expectedBasicPay))throw failure('STAFFOLOGY_FINANCIAL_MISMATCH','Calculated basic pay does not match the intended amount.');
  const lines=p.regularPayLines;
  if(!Array.isArray(lines)||lines.length!==1||lines[0].code!==expected.basic.code||!decimalEqual(lines[0].rate,expected.basic.rate)||!decimalEqual(lines[0].multiplier,expected.basic.hours)||!decimalEqual(lines[0].value,expected.expectedBasicPay))throw failure('STAFFOLOGY_FINANCIAL_MISMATCH','Provider basic pay line differs from the intended line.');
  // The retained payOptions.basicPay is preserved, NOT assumed to equal totals.
  return immutable({providerReference:e.id,run:expected.run,verification:'basic-pay-verified',fullPayrollVerified:false,financial:financialSnapshot(e)});
}
function validateReplacementBaseline(entry,expected) {
  const p=entry?.payOptions,lines=p?.regularPayLines;
  // This is replacement, not append. Never erase additional or ambiguous pay.
  // An empty/absent baseline is outside this explicitly mapped one-line scope.
  if(p?.basis!=='Hourly'||p.payCode!==expected.basic.code||!Array.isArray(lines)||lines.length!==1||lines[0]?.code!==expected.basic.code||
    (p.lines!==undefined&&(!Array.isArray(p.lines)||p.lines.length!==0)))
    throw failure('STAFFOLOGY_REPLACEMENT_UNSAFE','The baseline is not an isolated mapped hourly basic line.');
  try {
    if(!decimalEqual(lines[0].rate,p.payAmount)||!decimalEqual(lines[0].multiplier,p.payAmountMultiplier)||
      !entry.totals||!decimalEqual(lines[0].value,entry.totals.basicPay))throw Error('BASELINE_INCONSISTENT');
  } catch {
    throw failure('STAFFOLOGY_REPLACEMENT_UNSAFE','Baseline basic rate, hours and calculated amount must be complete and consistent.');
  }
}
function financialTransition(baseline,observation,basicVerified) {
  // Invoke only AFTER validating the readback against independently approved
  // input. Every other change, including run totals and unknown fields, holds.
  const approved=new Set(['/entry/totals/basicPay','/entry/payOptions/payAmount',
    '/entry/payOptions/payAmountMultiplier','/entry/payOptions/regularPayLines/0/rate',
    '/entry/payOptions/regularPayLines/0/multiplier','/entry/payOptions/regularPayLines/0/value']);
  const changes=[],kind=v=>v===null?'null':Array.isArray(v)?'array':typeof v;
  const escaped=k=>k.replace(/~/g,'~0').replace(/\//g,'~1');
  function walk(a,b,path,aPresent=true,bPresent=true) {
    if(aPresent&&bPresent&&canonical(a)===canonical(b))return;
    if(aPresent&&bPresent&&kind(a)===kind(b)&&a!==null&&typeof a==='object'&&(!Array.isArray(a)||a.length===b.length)) {
      for(const k of [...new Set([...Object.keys(a),...Object.keys(b)])].sort())
        walk(a[k],b[k],path+'/'+escaped(k),Object.hasOwn(a,k),Object.hasOwn(b,k));
      return;
    }
    const allowed=basicVerified&&aPresent&&bPresent&&kind(a)===kind(b)&&approved.has(path);
    changes.push({path,before:aPresent?{present:true,type:kind(a),value:a}:{present:false},
      after:bPresent?{present:true,type:kind(b),value:b}:{present:false},classification:allowed?'approved-basic-input':'unclassified'});
  }
  walk({run:baseline.run.snapshot,entry:baseline.entry.snapshot},{run:observation.run,entry:observation.entry},'');
  return immutable({baseline:{runSha256:baseline.run.sha256,entrySha256:baseline.entry.sha256},
    readback:{runSha256:sha256(observation.run),entrySha256:sha256(observation.entry)},
    matchesApprovedTransition:changes.every(c=>c.classification==='approved-basic-input'),changes});
}
const BINDING_FIELDS=['tenant','implementationRunId','candidateSha','deploymentId','configurationId','employerId'];
function validateBinding(value) {
  for(const key of BINDING_FIELDS)requiredId(value?.[key],key);
  if(!/^[a-f0-9]{40}$/.test(value.candidateSha))throw failure('STAFFOLOGY_BINDING_INVALID','Full source commit identity is required.');
  return immutable(Object.fromEntries(BINDING_FIELDS.map(key=>[key,value[key]])));
}
function businessKey(payload) {
  // Do not include caller delivery label, revision, build or configuration: a
  // reattempt of the SAME business operation cannot manufacture a fresh key.
  return 'staffology:'+sha256({tenant:payload.source.tenant,batchId:payload.source.batchId,employerId:payload.employerId,employeeId:payload.employeeId,run:payload.run});
}
function createDeliveryCoordinator({store,client=globalThis.fetch,config,binding,authorizeWrite}) {
  const scope=validateBinding(binding),bindingDigest=sha256(scope);
  if(!store||!['get','begin','assertOwned','recordEvidence','acknowledge','markUncertain'].every(k=>typeof store[k]==='function'))throw failure('STAFFOLOGY_STORE_INVALID','An explicit durable atomic/owned store contract is required.',500);
  async function owned(deliveryId,token,digest){if(await store.assertOwned({deliveryId,token,digest,bindingDigest})!==true)throw failure('STAFFOLOGY_OWNERSHIP_LOST','Delivery ownership is no longer current.');}
  function assertScope(input){for(const key of BINDING_FIELDS)if(input[key]!==scope[key])throw failure('STAFFOLOGY_BINDING_MISMATCH',`Delivery ${key} does not match the trusted runtime binding.`);}
  function sameIntent(row,digest){if(row.digest!==digest||row.bindingDigest!==bindingDigest)throw failure('STAFFOLOGY_DELIVERY_CONFLICT','Business operation already exists with another intent or runtime binding.');}
  const runPath=p=>`/employers/${encodeURIComponent(p.employerId)}/payrun/${p.run.taxYear}/${p.run.payPeriod}/${p.run.periodNumber}`;
  const importPath=p=>`/employers/${encodeURIComponent(p.employerId)}/payrun/${p.run.payPeriod}/importpay?ordinal=${p.run.ordinal}&linesOnly=false&append=false&updateExisting=false&validateOnly=false`;
  async function observe(payload) {
    const opened=await request(client,config,`/open?employerId=${encodeURIComponent(payload.employerId)}`);
    const relevant=Array.isArray(opened.body)?opened.body.filter(r=>r.payPeriod===payload.run.payPeriod&&r.ordinal===payload.run.ordinal):[];
    if(relevant.length!==1)throw failure('STAFFOLOGY_RUN_IDENTITY_MISMATCH','Current open schedule is missing or ambiguous.');
    validateRun(relevant[0],payload);
    const r=await request(client,config,runPath(payload)+`?ordinal=${payload.run.ordinal}&version=${payload.run.version}`);
    validateRun(r.body,payload);
    const start=dateOnly(r.body.startDate),end=dateOnly(r.body.endDate);
    if(start>end||payload.effectiveDate<start||payload.effectiveDate>end)throw failure('STAFFOLOGY_RUN_IDENTITY_MISMATCH','Effective date is outside the authorised run period.');
    const e=await request(client,config,runPath(payload)+`/${encodeURIComponent(payload.entryId)}?ordinal=${payload.run.ordinal}`,{acceptedStatuses:[404]});
    if(e.status===404)throw failure('STAFFOLOGY_READBACK_UNRESOLVED','Provider entry is not available for reconciliation.');
    validateEntryIdentity(e.body,payload);
    return {employerId:payload.employerId,run:r.body,entry:e.body,provenance:{origin:ORIGIN,runPath:runPath(payload),entryPath:runPath(payload)+'/'+payload.entryId,openResponseSha256:opened.responseSha256,runResponseSha256:r.responseSha256,entryResponseSha256:e.responseSha256}};
  }
  async function retainEvidence(deliveryId,token,phase,observation) {
    const evidence=immutable({phase,observedAt:new Date().toISOString(),run:financialSnapshot(observation.run),entry:financialSnapshot(observation.entry),provenance:observation.provenance});
    if(await store.recordEvidence(deliveryId,evidence,token)!==true)throw failure('STAFFOLOGY_EVIDENCE_NOT_PERSISTED','Complete private evidence was not persisted.');
    return evidence;
  }
  function persistedBaseline(row) {
    const b=row?.baseline;
    if(!b||b.phase!=='baseline'||!b.run?.snapshot||!b.entry?.snapshot||sha256(b.run.snapshot)!==b.run.sha256||sha256(b.entry.snapshot)!==b.entry.sha256)
      throw failure('STAFFOLOGY_BASELINE_NOT_PERSISTED','Original complete baseline is unavailable or inconsistent.');
    validateRun(b.run.snapshot,row.payload);validateEntryIdentity(b.entry.snapshot,row.payload);
    validateReplacementBaseline(b.entry.snapshot,row.payload);
    return immutable(b);
  }
  async function reconcile({deliveryId,token}) {
    const row=await store.get(deliveryId);
    if(!row||row.bindingDigest!==bindingDigest||row.digest!==sha256(row.payload))throw failure('STAFFOLOGY_BINDING_MISMATCH','Reconciliation must use the persisted, exact-bound intent.');
    await owned(deliveryId,token,row.digest);
    try {
      const baseline=persistedBaseline(row);
      const intendedDispatch={deliveryId,digest:row.digest,bindingDigest,
        baselineSha256:baseline.entry.sha256,baselineRunSha256:baseline.run.sha256,
        request:{method:'POST',path:importPath(row.payload),bodySha256:bytesHash(canonical(row.payload.importBody))}};
      if(!row.dispatchAttempt||canonical(row.dispatchAttempt)!==canonical(intendedDispatch))
        throw failure('STAFFOLOGY_DISPATCH_NOT_RECORDED','Recovery requires the original bound intent-to-dispatch record.');
      const observation=await observe(row.payload);
      await retainEvidence(deliveryId,token,'readback',observation);
      let verified,verificationError;
      try{verified=validateProviderResponse(observation,row.payload);}catch(error){verificationError=error;}
      const comparison=financialTransition(baseline,observation,Boolean(verified));
      if(await store.recordEvidence(deliveryId,immutable({phase:'comparison',comparison}),token)!==true)
        throw failure('STAFFOLOGY_EVIDENCE_NOT_PERSISTED','Complete private financial comparison was not persisted.');
      if(verificationError)throw verificationError;
      if(!comparison.matchesApprovedTransition)throw failure('STAFFOLOGY_FINANCIAL_DELTA_UNCLASSIFIED','Financial changes outside the approved basic input require review.');
      const receipt=immutable({...verified,comparison});
      await owned(deliveryId,token,row.digest);
      await store.acknowledge(deliveryId,receipt,token);
      const saved=await store.get(deliveryId);
      if(!saved||saved.status!=='acknowledged'||saved.digest!==row.digest||saved.bindingDigest!==bindingDigest||!saved.receipt||sha256(saved.receipt)!==sha256(receipt))throw failure('STAFFOLOGY_RECEIPT_NOT_PERSISTED','Independent local receipt readback failed.');
      return {status:'reconciled',receipt};
    } catch(error) {
      await store.markUncertain(deliveryId,{code:error.code||'STAFFOLOGY_VERIFICATION_UNCERTAIN'},token);
      return {status:'unresolved',code:error.code||'STAFFOLOGY_VERIFICATION_UNCERTAIN'};
    }
  }
  async function deliver(input) {
    assertScope(input);
    const payload=mapPayroll(input),deliveryId=businessKey(payload),digest=sha256(payload);
    const prior=await store.get(deliveryId);
    if(prior){sameIntent(prior,digest);return prior.status==='acknowledged'?{replayed:true,deliveryId,receipt:prior.receipt}:{replayed:true,deliveryId,reconciliationRequired:true,status:prior.status};}
    const claim=await store.begin({deliveryId,digest,bindingDigest,payload,status:'sending'});
    if(claim?.acquired!==true){const existing=await store.get(deliveryId);if(!existing)throw failure('STAFFOLOGY_STORE_INVALID','Lost claim has no persisted intent.');sameIntent(existing,digest);return {replayed:true,deliveryId,reconciliationRequired:existing.status!=='acknowledged',status:existing.status};}
    const token=exactText(claim.token,'Private delivery ownership token',256);
    await owned(deliveryId,token,digest);
    // Approval is an external server-verified capability, never an input flag.
    const baseline=await observe(payload);
    const evidence=await retainEvidence(deliveryId,token,'baseline',baseline);
    validateReplacementBaseline(baseline.entry,payload);
    const stored=await store.get(deliveryId);
    if(!stored||stored.digest!==digest||stored.bindingDigest!==bindingDigest||sha256(persistedBaseline(stored))!==sha256(evidence))
      throw failure('STAFFOLOGY_BASELINE_NOT_PERSISTED','Stored baseline does not match the exact pre-write observation.');
    const baselineSha256=financialSnapshot(baseline.entry).sha256;
    const permit=immutable({binding:scope,deliveryId,digest,run:payload.run,entryId:payload.entryId,baselineSha256,baselineRunSha256:evidence.run.sha256,expectedBasicPay:payload.expectedBasicPay,rounding:payload.rounding});
    if(typeof authorizeWrite!=='function'||await authorizeWrite(permit)!==true)throw failure('STAFFOLOGY_WRITE_NOT_AUTHORIZED','Verified payroll import authority is required.',403);
    let transportAccepted=false,dispatchStarted=false;
    try {
      await request(async(url,options)=>{
        let active=true,called=false,response;
        try {
          // The EXISTING store must validate current fence/lease, exact binding
          // AND server-side authority inside its consequential-effect guard,
          // then invoke dispatch without yielding between validation and effect.
          // It must first persist a one-time bound dispatchAttempt in that same
          // transaction. This proves an attempt was reserved, NOT remote success.
          // Returning true without invoking the callback is NOT sufficient.
          const allowed=await store.assertOwned({deliveryId,token,digest,bindingDigest,permit,
            request:immutable({method:options.method,path:new URL(url).pathname+new URL(url).search,bodySha256:bytesHash(options.body)}),
            dispatch:()=>{
              if(!active||called||options.signal.aborted)throw failure('STAFFOLOGY_OWNERSHIP_LOST','Guarded dispatch is no longer available.');
              called=true;dispatchStarted=true;
              response=Promise.resolve(client(url,options));
              // A store failure after dispatch must still retain an ambiguous
              // outcome without leaking an unhandled transport rejection.
              void response.catch(()=>{});
            }});
          if(allowed!==true||!called)throw failure('STAFFOLOGY_OWNERSHIP_LOST','The store did not perform an authorised owned dispatch.');
          return await response;
        } finally {active=false;}
      },config,importPath(payload),{
        method:'POST',body:payload.importBody,authorizeWrite:async()=>{
          if(await authorizeWrite(permit)!==true)return false;
          await owned(deliveryId,token,digest);return true;
        }
      });
      transportAccepted=true;
    } catch(error) {
      // Revoked authority/ownership before dispatch cannot become a fabricated
      // acknowledgement merely because the provider already has matching pay.
      if(!dispatchStarted)throw error;
      await store.markUncertain(deliveryId,{code:error.code||'STAFFOLOGY_OUTCOME_UNCERTAIN'},token);
      if(error.code==='STAFFOLOGY_AUTH_REJECTED')return {replayed:false,deliveryId,transportAccepted:false,reconciliationRequired:true,reconciliation:{status:'unresolved',code:error.code}};
    }
    const checked=await reconcile({deliveryId,token});
    return {replayed:false,deliveryId,transportAccepted,reconciliationRequired:checked.status!=='reconciled',reconciliation:checked,...(checked.receipt?{receipt:checked.receipt}:{})};
  }
  return {deliver,reconcile};
}
module.exports={StaffologyError,loadConfiguration,request,mapEmployee,acquireEmployees,mapPayroll,financialSnapshot,compareFinancialSnapshots,validateProviderResponse,createDeliveryCoordinator,canonical,sha256};
