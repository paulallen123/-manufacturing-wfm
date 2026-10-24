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
  const leaver=employment.leaverDetails;
  if(leaver!==undefined&&leaver!==null&&(typeof leaver!=='object'||Array.isArray(leaver)))
    throw failure('STAFFOLOGY_RESPONSE_INVALID','Employee leaver details are invalid.',502);
  const hasLeft=leaver?.hasLeft??null;
  if(hasLeft!==null&&typeof hasLeft!=='boolean')
    throw failure('STAFFOLOGY_RESPONSE_INVALID','Employee leaver status is invalid.',502);
  const effectiveTo=leaver?.leaveDate?dateOnly(leaver.leaveDate):null;
  if(effectiveTo&&effectiveTo<effectiveFrom)throw failure('STAFFOLOGY_EFFECTIVE_DATE_INVALID','Employment ends before it starts.');
  if(record.status!==undefined&&!['Current','Former','Upcoming'].includes(record.status))throw failure('STAFFOLOGY_RESPONSE_INVALID','Employee status is not recognized.',502);
  if((['Current','Upcoming'].includes(record.status)&&hasLeft===true)||(record.status==='Former'&&hasLeft===false))
    throw failure('STAFFOLOGY_EMPLOYEE_LIFECYCLE_UNRESOLVED','Employee status contradicts the provider leaver status.');
  if(effectiveTo&&['Current','Upcoming'].includes(record.status)&&hasLeft===null)
    throw failure('STAFFOLOGY_EMPLOYEE_LIFECYCLE_UNRESOLVED','An employee end date requires explicit provider leaver status.');
  if((hasLeft===true||record.status==='Former')&&!effectiveTo)throw failure('STAFFOLOGY_EFFECTIVE_DATE_INVALID','A leaver date is required.');
  const person={firstName:clean(personal.firstName,120),lastName:clean(personal.lastName,120),email:clean(personal.email,254)};
  if(!person.firstName||!person.lastName)throw failure('STAFFOLOGY_RESPONSE_INVALID','Required Person name fields are missing.',502);
  const canonicalPerson={employeeId,...person,startDate:effectiveFrom};
  if(record.status!==undefined)canonicalPerson.status=record.status;
  if(effectiveTo)canonicalPerson.endDate=effectiveTo;
  if(employment.jobTitle)canonicalPerson.jobTitle=clean(employment.jobTitle,120);
  if(employment.department?.title)canonicalPerson.department=clean(employment.department.title,120);
  const identity={provider:'staffology',employerId,employeeId,payrollCode};
  const employmentData={effectiveFrom,effectiveTo,status:record.status??null,hasLeft};
  const revision='sha256:'+sha256({identity,canonicalPerson,employment:employmentData});
  return {externalId:employeeId,revision,operation:'upsert',canonicalPerson,
    data:{identity,person,employment:employmentData,provenance:{provider:'staffology',acquiredAt:context.acquiredAt??null,sourcePath:context.sourcePath??null,sourceRevision:record.revision??record.updatedAt??null,revisionKind:'derived-mapped-content-sha256'}}};
}
async function acquireEmployees({client=globalThis.fetch,config,employerId,pageSize=100,maxPages=1000,allowedEmployeeIds=null,now=Date.now}) {
  const employer=requiredId(employerId,'Employer identity');integer(pageSize,'Page size',1,500);integer(maxPages,'Page limit',1,10000);
  if(allowedEmployeeIds!==null&&!Array.isArray(allowedEmployeeIds))throw failure('STAFFOLOGY_EMPLOYEE_COHORT_MISMATCH','The approved employee cohort is invalid.',403);const allowed=allowedEmployeeIds===null?null:new Set(allowedEmployeeIds);if(allowed&&(allowed.size!==allowedEmployeeIds.length||[...allowed].some(value=>requiredId(value,'Allowed employee identity')!==value)))throw failure('STAFFOLOGY_EMPLOYEE_COHORT_MISMATCH','The approved employee cohort is invalid.',403);
  const seen=new Set(),records=[];let complete=false,pageNum=0;
  for(;pageNum<maxPages;pageNum++) {
    const listPath=`/employers/${encodeURIComponent(employer)}/employees?pageNum=${pageNum}&pageSize=${pageSize}`;
    const result=await request(client,config,listPath);
    if(!Array.isArray(result.body)||result.body.length>pageSize)throw failure('STAFFOLOGY_PAGINATION_INCOMPLETE','Employee page is outside the documented Item[] contract.',502);
    const page=result.body.map(item=>{
      const id=requiredId(item?.id,'List employee identity');
      if(seen.has(id))throw failure('STAFFOLOGY_DUPLICATE_EMPLOYEE','Duplicate employee ID in paginated acquisition.');
      if(allowed&&!allowed.has(id))throw failure('STAFFOLOGY_EMPLOYEE_COHORT_MISMATCH','Provider list contains an employee outside the approved exact cohort.',403);
      seen.add(id);
      const detailPath=`/employers/${encodeURIComponent(employer)}/employees/${encodeURIComponent(id)}`;
      // Item URLs are not followed: construct a same-origin, same-employer path.
      if(item.url){let itemUrl;try{itemUrl=new URL(item.url,ORIGIN);}catch{throw failure('STAFFOLOGY_RESPONSE_INVALID','Invalid employee item URL.',502);}
        if(itemUrl.origin!==ORIGIN||itemUrl.pathname!==detailPath||itemUrl.search||itemUrl.hash||itemUrl.username||itemUrl.password)throw failure('STAFFOLOGY_RESPONSE_IDENTITY_MISMATCH','Employee item URL contradicts its identity.');}
      return {id,detailPath};
    });
    // Validate the complete list page against the trusted cohort before any
    // per-employee detail request can disclose an out-of-scope identity.
    for(const {id,detailPath} of page) {
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

function replacementSafety(entry,employee=null) {
  const p=entry?.payOptions,lines=p?.regularPayLines,employment=employee?.employmentDetails||entry?.employmentDetails||{},leaver=employment?.leaverDetails||{};
  if(employee){
    if(employee.status!=='Current')return immutable({safe:false,reason:'employee-not-current'});
    if(employment.onHold===true)return immutable({safe:false,reason:'employee-on-hold'});
    if(leaver.hasLeft===true)return immutable({safe:false,reason:'employee-has-left'});
    if(leaver.leaveDate!=null)return immutable({safe:false,reason:'employee-leave-date-present'});
    if(leaver.paymentAfterLeaving===true)return immutable({safe:false,reason:'employee-payment-after-leaving'});
  }
  if(entry?.paymentAfterLeaving===true)return immutable({safe:false,reason:'entry-payment-after-leaving'});
  if(entry?.unpaidAbsence===true)return immutable({safe:false,reason:'entry-unpaid-absence'});
  if(entry?.recievingOffsetPay===true)return immutable({safe:false,reason:'entry-receiving-offset-pay'});
  if(entry?.percentageOfWorkingDaysPaidAsNormal!=null&&Number(entry.percentageOfWorkingDaysPaidAsNormal)!==1)return immutable({safe:false,reason:'working-days-percentage-not-normal'});
  if(entry?.workingDaysNotPaidAsNormal!=null&&Number(entry.workingDaysNotPaidAsNormal)!==0)return immutable({safe:false,reason:'working-days-not-normal'});
  if(p?.autoAdjustForLeave===true)return immutable({safe:false,reason:'pay-options-auto-adjust-for-leave'});
  if(Array.isArray(p?.excludedRegularPayLines)&&p.excludedRegularPayLines.length>0)return immutable({safe:false,reason:'excluded-regular-pay-lines'});
  if(p?.basis!=='Hourly')return immutable({safe:false,reason:'basis-not-hourly'});
  if(typeof p.payCode!=='string'||!p.payCode.trim())return immutable({safe:false,reason:'pay-code-missing'});
  if(!Array.isArray(lines)||lines.length!==1||lines[0]?.code!==p.payCode)return immutable({safe:false,reason:'regular-line-not-isolated'});
  if(p.lines!==undefined&&(!Array.isArray(p.lines)||p.lines.length!==0))return immutable({safe:false,reason:'additional-lines-present'});
  const line=lines[0];
  if(line.leaveId!=null)return immutable({safe:false,reason:'basic-line-leave-linked'});
  if(Number(line.leaveStatutoryDaysPaid||0)>0)return immutable({safe:false,reason:'basic-line-statutory-leave-days'});
  if(Number(line.leaveStatutoryWeeksPaid||0)>0)return immutable({safe:false,reason:'basic-line-statutory-leave-weeks'});
  if(line.autoAdjustForLeave===true)return immutable({safe:false,reason:'basic-line-auto-adjust-for-leave'});
  if(line.isLeaveBasedBackPayLine===true)return immutable({safe:false,reason:'basic-line-leave-backpay'});
  try{
    if(!decimalEqual(line.rate,p.payAmount)||!decimalEqual(line.multiplier,p.payAmountMultiplier)||!entry.totals)
      return immutable({safe:false,reason:'basic-line-inconsistent'});
    const basicPay=entry.totals.basicPay===undefined&&decimalEqual(line.value,'0')?'0':entry.totals.basicPay;
    if(!decimalEqual(line.value,basicPay))return immutable({safe:false,reason:'basic-line-inconsistent'});
  }catch{return immutable({safe:false,reason:'basic-line-incomplete'});}
  return immutable({safe:true,reason:null});
}

async function discoverPayroll({client=globalThis.fetch,config,employerId,allowedEmployeeIds=null,pageSize=500,maxPages=100}={}) {
  const employer=requiredId(employerId,'Employer identity');
  integer(pageSize,'Page size',1,500);integer(maxPages,'Page limit',1,1000);
  const allowed=allowedEmployeeIds===null?null:new Set(allowedEmployeeIds);
  if(allowed&&(!Array.isArray(allowedEmployeeIds)||allowed.size!==allowedEmployeeIds.length||[...allowed].some(id=>requiredId(id,'Allowed employee identity')!==id)))
    throw failure('STAFFOLOGY_EMPLOYEE_COHORT_MISMATCH','The approved payroll discovery cohort is invalid.',403);
  const opened=await request(client,config,`/open?employerId=${encodeURIComponent(employer)}`);
  if(!Array.isArray(opened.body))throw failure('STAFFOLOGY_RESPONSE_INVALID','Open pay-run response must be an array.',502);
  const runs=[];
  for(const open of opened.body){
    if(open?.state!=='Open'||open?.isClosed===true||open?.isRolledBack===true||open?.isLatestVersion===false)continue;
    const taxYear=exactText(open.taxYear,'Tax year',32),payPeriod=exactText(open.payPeriod,'Pay period',32);
    if(!/^Year\d{4}$/.test(taxYear))throw failure('STAFFOLOGY_RUN_IDENTITY_INVALID','Open payroll tax year is invalid.',502);
    const period=integer(open.period,'Period',1,366),ordinal=integer(open.ordinal,'Ordinal',1,1000),version=integer(open.version,'Version',0,100000);
    const basePath=`/employers/${encodeURIComponent(employer)}/payrun/${taxYear}/${payPeriod}/${period}`;
    const payCodesResult=await request(client,config,basePath+`/paycodes?ordinal=${ordinal}&version=${version}`);
    const payCodeRows=Array.isArray(payCodesResult.body)?payCodesResult.body:Array.isArray(payCodesResult.body?.items)?payCodesResult.body.items:null;
    if(!payCodeRows)throw failure('STAFFOLOGY_RESPONSE_INVALID','Pay-run pay-code discovery response is invalid.',502);
    const payCodes=new Map();
    for(const row of payCodeRows){
      const code=exactText(row?.code,'Pay code identity',80);
      if(payCodes.has(code))throw failure('STAFFOLOGY_RESPONSE_INVALID','Duplicate pay-code identity returned during discovery.',502);
      const semantic={
        code,
        isDeduction:row.isDeduction===true,isNiable:row.isNiable===true,isTaxable:row.isTaxable===true,
        isPensionable:row.isPensionable===true,isAttachable:row.isAttachable===true,
        isRealTimeClass1aNiable:row.isRealTimeClass1aNiable===true,
        isNotContributingToHolidayPay:row.isNotContributingToHolidayPay===true,
        isQualifyingEarningsForAe:row.isQualifyingEarningsForAe===true,isNotTierable:row.isNotTierable===true,
        isAutoAdjust:row.isAutoAdjust===true,calculationType:row.calculationType??null,
        multiplierType:row.multiplierType??null,dailyRateMultiplier:row.dailyRateMultiplier??null,
        hourlyRateMultiplier:row.hourlyRateMultiplier??null,isSystemCode:row.isSystemCode===true,
        isControlCode:row.isControlCode===true,isNotional:row.isNotional===true
      };
      payCodes.set(code,immutable({semantic,sha256:sha256(row)}));
    }
    let firstRun=null,complete=false;const entries=[],seen=new Set();
    for(let pageNum=0;pageNum<maxPages;pageNum++){
      const result=await request(client,config,basePath+`?ordinal=${ordinal}&version=${version}&pageNum=${pageNum}&pageSize=${pageSize}`);
      const run=result.body;
      if(!run||typeof run!=='object'||Array.isArray(run))throw failure('STAFFOLOGY_RESPONSE_INVALID','Pay-run discovery response is invalid.',502);
      if(run.taxYear!==taxYear||run.payPeriod!==payPeriod||run.period!==period||run.ordinal!==ordinal||run.version!==version||run.state!=='Open'||run.isClosed===true)
        throw failure('STAFFOLOGY_RUN_IDENTITY_MISMATCH','Pay-run discovery coordinates changed during readback.',502);
      if(!firstRun)firstRun=run;
      const pageEntries=Array.isArray(run.entries)?run.entries:[];
      if(pageEntries.length>pageSize)throw failure('STAFFOLOGY_PAGINATION_INCOMPLETE','Pay-run entry page exceeds requested size.',502);
      for(const item of pageEntries){
        const entryId=requiredId(item?.id,'Pay-run entry identity');
        if(seen.has(entryId))throw failure('STAFFOLOGY_RESPONSE_INVALID','Duplicate pay-run entry identity returned during discovery.',502);
        seen.add(entryId);
        const providerEmployeeId=requiredId(item?.metadata?.employeeId,'Provider employee identity');
        if(allowed&&!allowed.has(providerEmployeeId))continue;
        const entryPath=basePath+'/'+encodeURIComponent(entryId);
        if(item?.url){
          let itemUrl;try{itemUrl=new URL(item.url,ORIGIN);}catch{throw failure('STAFFOLOGY_RESPONSE_INVALID','Pay-run entry URL is invalid.',502);}
          if(itemUrl.origin!==ORIGIN||itemUrl.pathname!==entryPath||itemUrl.search||itemUrl.hash||itemUrl.username||itemUrl.password)
            throw failure('STAFFOLOGY_RESPONSE_IDENTITY_MISMATCH','Pay-run entry URL contradicts its identity.',502);
        }
        const detail=await request(client,config,entryPath+`?ordinal=${ordinal}`);
        const e=detail.body;
        if(!e||e.id!==entryId||e?.employee?.id!==providerEmployeeId||e.taxYear!==taxYear||e.payPeriod!==payPeriod||e.period!==period||e.ordinal!==ordinal||e.payRunVersion!==version)
          throw failure('STAFFOLOGY_RESPONSE_IDENTITY_MISMATCH','Pay-run entry detail differs from discovered coordinates.',502);
        const employeePath=`/employers/${encodeURIComponent(employer)}/employees/${encodeURIComponent(providerEmployeeId)}`;
        const employeeResult=await request(client,config,employeePath);
        const employee=employeeResult.body;
        if(!employee||employee.id!==providerEmployeeId)throw failure('STAFFOLOGY_RESPONSE_IDENTITY_MISMATCH','Payroll discovery employee detail differs from the entry identity.',502);
        const payrollCode=exactText(e?.employmentDetails?.payrollCode,'Payroll code',80);
        if(exactText(employee?.employmentDetails?.payrollCode,'Employee payroll code',80)!==payrollCode)
          throw failure('STAFFOLOGY_RESPONSE_IDENTITY_MISMATCH','Employee payroll code differs from the pay-run entry.',502);
        const payCode=exactText(e?.payOptions?.payCode,'Pay code',80),definition=payCodes.get(payCode);
        if(!definition)throw failure('STAFFOLOGY_MAPPING_AUTHORITY_REQUIRED','Entry pay code has no matching current pay-run definition.',409);
        const safety=replacementSafety(e,employee);
        entries.push(immutable({
          entryId,providerEmployeeId,payrollCode,basis:e?.payOptions?.basis??null,payCode,
          payCodeDefinition:definition.semantic,payCodeDefinitionSha256:definition.sha256,
          regularLineCount:Array.isArray(e?.payOptions?.regularPayLines)?e.payOptions.regularPayLines.length:0,
          safeReplacement:safety.safe,safeReplacementReason:safety.reason
        }));
      }
      if(pageEntries.length<pageSize){complete=true;break;}
    }
    if(!complete)throw failure('STAFFOLOGY_PAGINATION_INCOMPLETE','Pay-run discovery page bound reached.',502);
    runs.push(immutable({
      taxYear,payPeriod,period,ordinal,version,
      dates:{startDate:dateOnly(firstRun.startDate),endDate:dateOnly(firstRun.endDate),paymentDate:firstRun.paymentDate?dateOnly(firstRun.paymentDate):null},
      entries
    }));
  }
  return immutable({employerId:employer,runs,providerMethods:['GET'],providerWritePerformed:false});
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
  const payCodeDefinitionSha256=input.payCodeDefinitionSha256==null?null:exactText(input.payCodeDefinitionSha256,'Pay-code definition digest',64);
  if(payCodeDefinitionSha256!==null&&!/^[a-f0-9]{64}$/.test(payCodeDefinitionSha256))throw failure('STAFFOLOGY_MAPPING_AUTHORITY_REQUIRED','A current pay-code semantic digest is required.');
  const sourceLineDigest=input.sourceLineDigest==null?null:exactText(input.sourceLineDigest,'Released source line digest',64);
  if(sourceLineDigest!==null&&!/^[a-f0-9]{64}$/.test(sourceLineDigest))throw failure('STAFFOLOGY_PAYROLL_LINE_INVALID','Exact released source-line digest is invalid.',400);
  const source={system:'VECTOR',tenant:requiredId(input.tenant,'Tenant identity'),batchId:requiredId(input.batchId,'Batch identity'),revision:exactText(input.sourceRevision,'Source revision',100),...(sourceLineDigest?{sourceLineDigest}:{})};
  const importBody=[{payrollCode,basis:'Hourly',payCode:code,payAmount:Number(rate.text),payAmountMultiplier:Number(hours.text),lines:[]}];
  if(!decimalEqual(importBody[0].payAmount,rate.text)||!decimalEqual(importBody[0].payAmountMultiplier,hours.text))throw failure('STAFFOLOGY_PAYROLL_LINE_INVALID','Wire conversion changed a decimal value.');
  return immutable({employerId,employeeId,entryId,payrollCode,effectiveDate,run,source,mode:input.mode,rounding,expectedBasicPay,payCodeDefinitionSha256,basic:{code,hours:hours.text,rate:rate.text},importBody});
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
function calculatedBasicPay(entry,expected) {
  if(!entry?.totals||typeof entry.totals!=='object'||Array.isArray(entry.totals))throw failure('STAFFOLOGY_FINANCIAL_EVIDENCE_MISSING','Calculated provider totals are missing.');
  // PayRunTotals suppresses documented zero properties. Normalize only a
  // missing basicPay inside a present totals object for an expected zero.
  if(entry.totals.basicPay===undefined){if(decimalEqual(expected.expectedBasicPay,'0'))return 0;throw failure('STAFFOLOGY_FINANCIAL_EVIDENCE_MISSING','Calculated provider basic pay is missing.');}
  return entry.totals.basicPay;
}
function validateProviderResponse(observation,expected) {
  if(observation?.employerId!==expected.employerId)throw failure('STAFFOLOGY_RESPONSE_IDENTITY_MISMATCH','Readback employer path is not bound.');
  validateRun(observation.run,expected);validateEntryIdentity(observation.entry,expected);
  const safety=replacementSafety(observation.entry,observation.employee);
  if(!safety.safe)throw failure('STAFFOLOGY_REPLACEMENT_UNSAFE','Current employee/payroll state is unsafe for replacement.');
  if(expected.payCodeDefinitionSha256){
    const payCodes=Array.isArray(observation.payCodes)?observation.payCodes:Array.isArray(observation.payCodes?.items)?observation.payCodes.items:[],
      matching=payCodes.filter(row=>row?.code===expected.basic.code);
    if(matching.length!==1||sha256(matching[0])!==expected.payCodeDefinitionSha256)
      throw failure('STAFFOLOGY_MAPPING_AUTHORITY_REQUIRED','Readback pay-code semantics differ from the approved definition.');
  }
  const e=observation.entry,p=e.payOptions;
  if(!p||p.basis!=='Hourly'||!decimalEqual(p.payAmount,expected.basic.rate)||!decimalEqual(p.payAmountMultiplier,expected.basic.hours))throw failure('STAFFOLOGY_FINANCIAL_MISMATCH','Provider rate, hours or basis do not match.');
  if(p.payCode!==expected.basic.code)throw failure('STAFFOLOGY_FINANCIAL_MISMATCH','Provider basic pay code does not match.');
  const actual=calculatedBasicPay(e,expected);
  if(!decimalEqual(actual,expected.expectedBasicPay))throw failure('STAFFOLOGY_FINANCIAL_MISMATCH','Calculated basic pay does not match the intended amount.');
  const lines=p.regularPayLines;
  if(!Array.isArray(lines)||lines.length!==1||lines[0].code!==expected.basic.code||!decimalEqual(lines[0].rate,expected.basic.rate)||!decimalEqual(lines[0].multiplier,expected.basic.hours)||!decimalEqual(lines[0].value,expected.expectedBasicPay))throw failure('STAFFOLOGY_FINANCIAL_MISMATCH','Provider basic pay line differs from the intended line.');
  // The retained payOptions.basicPay is preserved, NOT assumed to equal totals.
  return immutable({providerReference:e.id,run:expected.run,verification:'basic-pay-verified',fullPayrollVerified:false,financial:financialSnapshot(e)});
}
function validateReplacementBaseline(entry,expected) {
  const safety=replacementSafety(entry);
  if(!safety.safe||entry?.payOptions?.payCode!==expected.basic.code)
    throw failure('STAFFOLOGY_REPLACEMENT_UNSAFE','The baseline is not an isolated mapped hourly basic line.');
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
  if(!store||!['get','begin','assertOwned','recordEvidence','acknowledge','markUncertain','markRejected'].every(k=>typeof store[k]==='function'))throw failure('STAFFOLOGY_STORE_INVALID','An explicit durable atomic/owned store contract is required.',500);
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
    if(payload.payCodeDefinitionSha256){
      const employeePath=`/employers/${encodeURIComponent(payload.employerId)}/employees/${encodeURIComponent(payload.employeeId)}`;
      const employeeResult=await request(client,config,employeePath);
      const payCodesPath=runPath(payload)+`/paycodes?ordinal=${payload.run.ordinal}&version=${payload.run.version}`;
      const payCodesResult=await request(client,config,payCodesPath);
      return {employerId:payload.employerId,run:r.body,entry:e.body,employee:employeeResult.body,payCodes:payCodesResult.body,
        provenance:{origin:ORIGIN,runPath:runPath(payload),entryPath:runPath(payload)+'/'+payload.entryId,employeePath,payCodesPath,
          openResponseSha256:opened.responseSha256,runResponseSha256:r.responseSha256,entryResponseSha256:e.responseSha256,
          employeeResponseSha256:employeeResult.responseSha256,payCodesResponseSha256:payCodesResult.responseSha256}};
    }
    return {employerId:payload.employerId,run:r.body,entry:e.body,employee:null,payCodes:null,
      provenance:{origin:ORIGIN,runPath:runPath(payload),entryPath:runPath(payload)+'/'+payload.entryId,
        openResponseSha256:opened.responseSha256,runResponseSha256:r.responseSha256,entryResponseSha256:e.responseSha256}};
  }
  function validateObservationSafety(observation,payload) {
    if(observation?.employerId!==payload.employerId)throw failure('STAFFOLOGY_RESPONSE_IDENTITY_MISMATCH','Provider observation employer differs from the authorised target.',502);
    validateRun(observation.run,payload);validateEntryIdentity(observation.entry,payload);
    if(payload.payCodeDefinitionSha256){
      if(observation.employee?.id!==payload.employeeId||observation.employee?.employmentDetails?.payrollCode!==payload.payrollCode)
        throw failure('STAFFOLOGY_RESPONSE_IDENTITY_MISMATCH','Current employee state differs from the authorised payroll identity.',502);
      const safety=replacementSafety(observation.entry,observation.employee);
      if(!safety.safe)throw failure('STAFFOLOGY_REPLACEMENT_UNSAFE','Current provider state is unsafe for basic-pay replacement: '+safety.reason+'.');
      const payCodes=Array.isArray(observation.payCodes)?observation.payCodes:Array.isArray(observation.payCodes?.items)?observation.payCodes.items:null;
      if(!payCodes)throw failure('STAFFOLOGY_RESPONSE_INVALID','Current pay-code definition response is invalid.',502);
      const matching=payCodes.filter(row=>row?.code===payload.basic.code);
      if(matching.length!==1||sha256(matching[0])!==payload.payCodeDefinitionSha256)
        throw failure('STAFFOLOGY_MAPPING_AUTHORITY_REQUIRED','Current pay-code semantics differ from the approved definition.',409);
      return immutable({safe:true,payCode:matching[0]});
    }
    const safety=replacementSafety(observation.entry,null);
    if(!safety.safe)throw failure('STAFFOLOGY_REPLACEMENT_UNSAFE','Provider entry is unsafe for basic-pay replacement: '+safety.reason+'.');
    return immutable({safe:true,payCode:null});
  }
  function evidenceSnapshot(value) {
    const snapshot=immutable(value);return immutable({snapshot,sha256:sha256(snapshot)});
  }
  async function retainEvidence(deliveryId,token,phase,observation) {
    const evidence=immutable({phase,observedAt:new Date().toISOString(),run:financialSnapshot(observation.run),entry:financialSnapshot(observation.entry),
      ...(observation.employee?{employee:evidenceSnapshot(observation.employee)}:{}),
      ...(observation.payCodes?{payCodes:evidenceSnapshot(observation.payCodes)}:{}),
      provenance:observation.provenance});
    if(await store.recordEvidence(deliveryId,evidence,token)!==true)throw failure('STAFFOLOGY_EVIDENCE_NOT_PERSISTED','Complete private evidence was not persisted.');
    return evidence;
  }
  function persistedBaseline(row) {
    const b=row?.baseline;
    if(!b||b.phase!=='baseline'||!b.run?.snapshot||!b.entry?.snapshot||sha256(b.run.snapshot)!==b.run.sha256||sha256(b.entry.snapshot)!==b.entry.sha256)
      throw failure('STAFFOLOGY_BASELINE_NOT_PERSISTED','Original complete baseline is unavailable or inconsistent.');
    if(b.employee&&sha256(b.employee.snapshot)!==b.employee.sha256)throw failure('STAFFOLOGY_BASELINE_NOT_PERSISTED','Persisted employee evidence digest is inconsistent.');
    if(b.payCodes&&sha256(b.payCodes.snapshot)!==b.payCodes.sha256)throw failure('STAFFOLOGY_BASELINE_NOT_PERSISTED','Persisted pay-code evidence digest is inconsistent.');
    validateObservationSafety({employerId:row.payload.employerId,run:b.run.snapshot,entry:b.entry.snapshot,
      employee:b.employee?.snapshot||null,payCodes:b.payCodes?.snapshot||null},row.payload);
    return immutable(b);
  }
  async function startDispatch(row,token) {
    const {deliveryId,digest,payload}=row;let dispatchStarted=false,transportAccepted=false;
    try {
      const baseline=await observe(payload),before=await store.get(deliveryId),
        freshEvidence=await retainEvidence(deliveryId,token,before?.baseline?'pre-dispatch-recheck':'baseline',baseline),
        evidence=before?.baseline?persistedBaseline(before):freshEvidence;
      validateObservationSafety(baseline,payload);
      if(before?.baseline&&(evidence.run.sha256!==sha256(baseline.run)||evidence.entry.sha256!==sha256(baseline.entry)||
        (evidence.employee?.sha256||null)!==(baseline.employee?sha256(baseline.employee):null)||
        (evidence.payCodes?.sha256||null)!==(baseline.payCodes?sha256(baseline.payCodes):null)))
        throw failure('STAFFOLOGY_BASELINE_CHANGED','Fresh pre-dispatch provider state differs from the immutable original baseline.');
      const stored=await store.get(deliveryId);
      if(!stored||stored.digest!==digest||stored.bindingDigest!==bindingDigest||sha256(persistedBaseline(stored))!==sha256(evidence))
        throw failure('STAFFOLOGY_BASELINE_NOT_PERSISTED','Stored baseline does not match the exact pre-write observation.');
      const permit=immutable({binding:scope,deliveryId,digest,run:payload.run,entryId:payload.entryId,baselineSha256:evidence.entry.sha256,baselineRunSha256:evidence.run.sha256,expectedBasicPay:payload.expectedBasicPay,rounding:payload.rounding});
      if(typeof authorizeWrite!=='function'||await authorizeWrite(permit)!==true)throw failure('STAFFOLOGY_WRITE_NOT_AUTHORIZED','Verified payroll import authority is required.',403);
      const transport=await request(async(url,options)=>{
        let active=true,called=false,response;
        try {
          const allowed=await store.assertOwned({deliveryId,token,digest,bindingDigest,permit,
            request:immutable({method:options.method,path:new URL(url).pathname+new URL(url).search,bodySha256:bytesHash(options.body)}),
            dispatch:()=>{
              if(!active||called||options.signal.aborted)throw failure('STAFFOLOGY_OWNERSHIP_LOST','Guarded dispatch is no longer available.');
              called=true;dispatchStarted=true;response=Promise.resolve(client(url,options));void response.catch(()=>{});
            }});
          if(allowed!==true||!called)throw failure('STAFFOLOGY_OWNERSHIP_LOST','The store did not perform an authorised owned dispatch.');
          return await response;
        } finally {active=false;}
      },config,importPath(payload),{method:'POST',body:payload.importBody,authorizeWrite:async()=>{
        if(await authorizeWrite(permit)!==true)return false;await owned(deliveryId,token,digest);return true;
      }});
      const transportEvidence=immutable({
        phase:'transport',httpStatus:transport.status,requestId:transport.requestId??null,
        requestSha256:transport.requestSha256,responseSha256:transport.responseSha256
      });
      try{
        if(!Number.isInteger(transportEvidence.httpStatus)||!/^[a-f0-9]{64}$/.test(transportEvidence.requestSha256||'')||
          !/^[a-f0-9]{64}$/.test(transportEvidence.responseSha256||'')||
          await store.recordEvidence(deliveryId,transportEvidence,token)!==true)
          throw Error('TRANSPORT_EVIDENCE_WRITE_FAILED');
      }catch{
        throw failure('STAFFOLOGY_TRANSPORT_EVIDENCE_NOT_PERSISTED','Provider response was observed but its transport evidence could not be durably persisted.',503);
      }
      transportAccepted=true;
    } catch(error) {
      if(!dispatchStarted) {
        // This covers every failure after the durable claim and before the
        // atomic dispatch reservation. An expired `sending` row is likewise
        // recoverable, covering a process crash before this handler runs.
        try{await store.markUncertain(deliveryId,{code:error.code||'STAFFOLOGY_PRE_DISPATCH_FAILED',dispatchStarted:false},token);}catch(markError){if(markError.code!=='STAFFOLOGY_OWNERSHIP_LOST')throw markError;}
        throw error;
      }
      if(error.code==='STAFFOLOGY_AUTH_REJECTED'){await store.markRejected(deliveryId,{code:error.code,dispatchStarted:true,definitive:true},token);throw error;}
      const transportEvidenceLost=error.code==='STAFFOLOGY_TRANSPORT_EVIDENCE_NOT_PERSISTED';
      await store.markUncertain(deliveryId,{code:error.code||'STAFFOLOGY_OUTCOME_UNCERTAIN',dispatchStarted:true,providerResponseObserved:transportEvidenceLost},token);
      if(transportEvidenceLost)throw error;
    }
    return {transportAccepted,dispatchStarted};
  }
  async function reconcile({deliveryId,token}) {
    let row=await store.get(deliveryId);
    if(!row||row.bindingDigest!==bindingDigest||row.digest!==sha256(row.payload))throw failure('STAFFOLOGY_BINDING_MISMATCH','Reconciliation must use the persisted, exact-bound intent.');
    await owned(deliveryId,token,row.digest);
    if(row.status==='rejected')return {status:'rejected',code:'STAFFOLOGY_AUTH_REJECTED'};
    if(row.uncertainReason?.code==='STAFFOLOGY_TRANSPORT_EVIDENCE_NOT_PERSISTED')
      return {status:'unresolved',code:'STAFFOLOGY_TRANSPORT_EVIDENCE_NOT_PERSISTED',dispatchStarted:true};
    if(!row.dispatchAttempt) {
      try {await startDispatch(row,token);} catch(error) {
        const code=error.code||'STAFFOLOGY_PRE_DISPATCH_FAILED';
        const persisted=await store.get(deliveryId);
        if(persisted?.status==='rejected')return {status:'rejected',code,dispatchStarted:Boolean(persisted.dispatchAttempt)};
        return {status:code==='STAFFOLOGY_WRITE_NOT_AUTHORIZED'?'unresolved':'retryable',code,dispatchStarted:false};
      }
      row=await store.get(deliveryId);
    }
    try {
      const baseline=persistedBaseline(row);
      const intendedDispatch={deliveryId,digest:row.digest,bindingDigest,
        baselineSha256:baseline.entry.sha256,baselineRunSha256:baseline.run.sha256,
        request:{method:'POST',path:importPath(row.payload),bodySha256:bytesHash(canonical(row.payload.importBody))}};
      if(row.dispatchAttempt?.approvalId!==undefined)intendedDispatch.approvalId=row.dispatchAttempt.approvalId;
      if(!row.dispatchAttempt||canonical(row.dispatchAttempt)!==canonical(intendedDispatch))
        throw failure('STAFFOLOGY_DISPATCH_NOT_RECORDED','Recovery requires the original bound intent-to-dispatch record.');
      const observation=await observe(row.payload);
      await retainEvidence(deliveryId,token,'readback',observation);
      let verified,verificationError;
      try{validateObservationSafety(observation,row.payload);verified=validateProviderResponse(observation,row.payload);}catch(error){verificationError=error;}
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
    const {transportAccepted}=await startDispatch({deliveryId,digest,payload},token);
    const checked=await reconcile({deliveryId,token});
    return {replayed:false,deliveryId,transportAccepted,reconciliationRequired:checked.status!=='reconciled',reconciliation:checked,...(checked.receipt?{receipt:checked.receipt}:{})};
  }
  async function inspect(input) {
    assertScope(input);
    const payload=mapPayroll(input),deliveryId=businessKey(payload),deliveryDigest=sha256(payload),stored=await store.get(deliveryId);
    if(!stored||stored.deliveryId!==deliveryId||stored.digest!==deliveryDigest||stored.bindingDigest!==bindingDigest||
      !stored.dispatchAttempt||stored.status!=='acknowledged'||!stored.receipt)
      throw failure('STAFFOLOGY_DISPATCH_NOT_RECORDED','Provider readback is not evidence of a VECTOR send without the exact acknowledged delivery.');
    const transport=[...(stored.evidence||[])].reverse().find(item=>item.phase==='transport')?.value;
    if(!transport||!Number.isInteger(transport.httpStatus)||!/^[a-f0-9]{64}$/.test(transport.requestSha256||'')||!/^[a-f0-9]{64}$/.test(transport.responseSha256||''))
      throw failure('STAFFOLOGY_TRANSPORT_EVIDENCE_NOT_PERSISTED','Acknowledged delivery lacks durable transport evidence.',503);
    const observation=await observe(payload);validateObservationSafety(observation,payload);const verified=validateProviderResponse(observation,payload);
    const observedBasicPay=Number(calculatedBasicPay(observation.entry,payload)).toFixed(2);
    const receiptMatches=stored.receipt.verification===verified.verification&&stored.receipt.providerReference===verified.providerReference&&
      canonical(stored.receipt.run)===canonical(verified.run)&&stored.receipt.fullPayrollVerified===false;
    if(!receiptMatches)throw failure('STAFFOLOGY_RECEIPT_CONFLICT','Current provider readback does not match the acknowledged VECTOR receipt.');
    return immutable({verified,delivery:{deliveryId,digest:deliveryDigest,bindingDigest,status:stored.status,dispatchRecorded:true,transportEvidencePersisted:true,receiptVerified:true},comparison:{expectedBasicPay:payload.expectedBasicPay,observedBasicPay,matches:observedBasicPay===payload.expectedBasicPay},run:financialSnapshot(observation.run),entry:financialSnapshot(observation.entry),provenance:observation.provenance});
  }
  return {deliver,reconcile,inspect};
}
module.exports={StaffologyError,loadConfiguration,request,mapEmployee,acquireEmployees,discoverPayroll,replacementSafety,mapPayroll,financialSnapshot,compareFinancialSnapshots,validateProviderResponse,createDeliveryCoordinator,canonical,sha256,businessKey};
