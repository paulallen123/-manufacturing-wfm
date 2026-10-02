import {createHash} from 'node:crypto';

const SECRET_KEY=/(?:^|_)(?:password|passwd|secret|token|authorization|cookie|api[_-]?key)(?:$|_)/i;
const encoder=new TextEncoder();
function fail(message){throw new Error(message);}

function cloneInert(value,path='value',seen=new WeakSet()){
  if(value===null||['string','number','boolean'].includes(typeof value)) return value;
  if(typeof value!=='object') fail(`${path} contains executable or unsupported data`);
  if(seen.has(value)) fail(`${path} contains cyclic data`);
  seen.add(value);
  if(Array.isArray(value)){
    const output=[];let count=0;
    for(const key of Reflect.ownKeys(value)){
      if(key==='length') continue;
      if(typeof key!=='string') fail(`${path} contains symbol data`);
      if(SECRET_KEY.test(key)) fail(`${path}.${key} contains secret material`);
      if(!/^(?:0|[1-9]\d*)$/.test(key)||Number(key)>=4294967295) fail(`${path}.${key} is not an array index`);
      const descriptor=Object.getOwnPropertyDescriptor(value,key);
      if(!descriptor?.enumerable||!('value' in descriptor)) fail(`${path}[${key}] contains executable or hidden data`);
      output[key]=cloneInert(descriptor.value,`${path}[${key}]`,seen);count++;
    }
    if(count!==value.length) fail(`${path} contains sparse array data`);
    seen.delete(value);return output;
  }
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null) fail(`${path} must be plain data`);
  const output=Object.create(null);
  for(const key of Reflect.ownKeys(value)){
    if(typeof key!=='string') fail(`${path} contains symbol data`);
    if(SECRET_KEY.test(key)) fail(`${path}.${key} contains secret material`);
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor?.enumerable||!('value' in descriptor)) fail(`${path}.${key} contains executable or hidden data`);
    output[key]=cloneInert(descriptor.value,`${path}.${key}`,seen);
  }
  seen.delete(value);return output;
}

function exactKeys(value,allowed,path){
  if(!value||typeof value!=='object'||Array.isArray(value)) fail(`${path} must be an object`);
  for(const key of Object.keys(value)) if(!allowed.has(key)) fail(`${path}.${key} is not allowed`);
  for(const key of allowed) if(!Object.hasOwn(value,key)) fail(`${path}.${key} is required`);
}
function text(value,name,maxBytes){
  if(typeof value!=='string'||value.length===0||value.trim()!==value) fail(`${name} must be a non-empty string without surrounding whitespace`);
  if(encoder.encode(value).byteLength>maxBytes) fail(`${name} exceeds the text byte limit`);
  return value;
}
function integer(value,name,{minimum=0,maximum=Number.MAX_SAFE_INTEGER}={}){
  if(!Number.isSafeInteger(value)||value<minimum||value>maximum) fail(`${name} must be an integer from ${minimum} to ${maximum}`);
  return value;
}
function fingerprint(value,name,maxBytes){
  const result=text(value,name,maxBytes);
  if(!/^sha256:[a-f0-9]{64}$/.test(result)) fail(`${name} must be a canonical sha256 fingerprint`);
  return result;
}
function isoDate(value,name,maxBytes){
  const result=text(value,name,maxBytes);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(result)) fail(`${name} must be an ISO calendar date`);
  const milliseconds=Date.parse(`${result}T00:00:00.000Z`);
  if(!Number.isFinite(milliseconds)||new Date(milliseconds).toISOString().slice(0,10)!==result) fail(`${name} must be a real ISO calendar date`);
  return result;
}
function instant(value,name,maxBytes){
  const result=text(value,name,maxBytes);
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(result)) fail(`${name} must be a UTC instant`);
  const milliseconds=Date.parse(result);
  if(!Number.isFinite(milliseconds)) fail(`${name} must be a real UTC instant`);
  const parts=result.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  const date=new Date(milliseconds);
  if(date.getUTCFullYear()!==Number(parts[1])||date.getUTCMonth()+1!==Number(parts[2])||date.getUTCDate()!==Number(parts[3])||
    date.getUTCHours()!==Number(parts[4])||date.getUTCMinutes()!==Number(parts[5])||date.getUTCSeconds()!==Number(parts[6])) fail(`${name} must be a real UTC instant`);
  return {source:result,milliseconds,canonical:date.toISOString()};
}
function exactOrigin(value,maxBytes){
  const result=text(value,'apiOrigin',maxBytes);let parsed;
  try{parsed=new URL(result);}catch{fail('apiOrigin must be an exact HTTPS origin');}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash||parsed.origin!==result||result.includes('*')) fail('apiOrigin must be an exact HTTPS origin');
  return parsed.origin.toLowerCase();
}
function exactRoute(value,name,maxBytes,{template=false}={}){
  const result=text(value,name,maxBytes);
  if(!result.startsWith('/')||result.includes('*')||result.includes('?')||result.includes('#')||result.includes('%')||result.includes('\\')||
    result.includes('//')||/\s|[\u0000-\u001f\u007f]/.test(result)||/(?:^|\/)\.{1,2}(?:\/|$)/.test(result)) fail(`${name} must be an exact safe route`);
  const placeholders=[...result.matchAll(/\{[^}]*\}/g)].map(match=>match[0]);
  if(template){
    if(placeholders.length!==1||placeholders[0]!=='{employeeId}') fail(`${name} must contain exactly one {employeeId} placeholder`);
  }else if(placeholders.length) fail(`${name} cannot contain route placeholders`);
  return result;
}
function ianaZone(value,maxBytes){
  const result=text(value,'timeZone',maxBytes);
  try{new Intl.DateTimeFormat('en-US',{timeZone:result}).format(new Date(0));}catch{fail('timeZone must be a valid IANA zone');}
  return result;
}
function currency(value,maxBytes){
  const result=text(value,'currency',maxBytes);
  if(!/^[A-Z]{3}$/.test(result)) fail('currency must be an ISO 4217 alphabetic code');
  return result;
}
function uuid(value,name,maxBytes){
  const result=text(value,name,maxBytes).toLowerCase();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(result)||result==='00000000-0000-0000-0000-000000000000') fail(`${name} must be a nonzero UUID`);
  return result;
}
function canonical(value){
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function digest(value){return createHash('sha256').update(canonical(value)).digest('hex');}
function same(actual,expected,name){if(actual!==expected) fail(`${name} does not match approved authority`);}
function deepFreeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value)) deepFreeze(child);Object.freeze(value);}return value;}

export function createPayrollRunCoverageAuthority(rawPolicy){
  const policy=cloneInert(rawPolicy,'policy');
  const scopeFields=['provider','wfmTenantId','connectionId','sourceCompanyId','apiVersion','timeZone','currency','partnerAgreementRevision'];
  const fingerprintFields=['principalFingerprint','webhookCredentialFingerprint','employeeSchemaFingerprint','payStatementSchemaFingerprint','mappingFingerprint'];
  exactKeys(policy,new Set([
    ...scopeFields,'apiOrigin','employeeRoute','payStatementRouteTemplate',...fingerprintFields,
    'expectedCheckpointPredecessor','expectedCheckDate','expectedProcessId','expectedRunId',
    'expectedObservedAt','pageLimit','maxEmployees','maxPagesPerEmployee','maxStatementsPerEmployee','maxTextBytes'
  ]),'policy');
  policy.maxTextBytes=integer(policy.maxTextBytes,'maxTextBytes',{minimum:64,maximum:65536});
  for(const field of scopeFields.filter(field=>!['timeZone','currency'].includes(field))) policy[field]=text(policy[field],field,policy.maxTextBytes);
  policy.timeZone=ianaZone(policy.timeZone,policy.maxTextBytes);policy.currency=currency(policy.currency,policy.maxTextBytes);
  policy.apiOrigin=exactOrigin(policy.apiOrigin,policy.maxTextBytes);
  policy.employeeRoute=exactRoute(policy.employeeRoute,'employeeRoute',policy.maxTextBytes);
  policy.payStatementRouteTemplate=exactRoute(policy.payStatementRouteTemplate,'payStatementRouteTemplate',policy.maxTextBytes,{template:true});
  for(const field of fingerprintFields) policy[field]=fingerprint(policy[field],field,policy.maxTextBytes);
  policy.expectedCheckpointPredecessor=text(policy.expectedCheckpointPredecessor,'expectedCheckpointPredecessor',policy.maxTextBytes);
  policy.expectedCheckDate=isoDate(policy.expectedCheckDate,'expectedCheckDate',policy.maxTextBytes);
  policy.expectedProcessId=text(policy.expectedProcessId,'expectedProcessId',policy.maxTextBytes);
  policy.expectedRunId=integer(policy.expectedRunId,'expectedRunId',{minimum:0});
  policy.expectedObservedAt=instant(policy.expectedObservedAt,'expectedObservedAt',policy.maxTextBytes).canonical;
  policy.pageLimit=integer(policy.pageLimit,'pageLimit',{minimum:1,maximum:1000});
  policy.maxEmployees=integer(policy.maxEmployees,'maxEmployees',{minimum:1,maximum:250000});
  policy.maxPagesPerEmployee=integer(policy.maxPagesPerEmployee,'maxPagesPerEmployee',{minimum:1,maximum:10000});
  policy.maxStatementsPerEmployee=integer(policy.maxStatementsPerEmployee,'maxStatementsPerEmployee',{minimum:1,maximum:100000});
  deepFreeze(policy);

  const scope={
    provider:policy.provider,wfmTenantId:policy.wfmTenantId,connectionId:policy.connectionId,
    sourceCompanyId:policy.sourceCompanyId,apiOrigin:policy.apiOrigin,apiVersion:policy.apiVersion,
    employeeRoute:policy.employeeRoute,payStatementRouteTemplate:policy.payStatementRouteTemplate,
    timeZone:policy.timeZone,currency:policy.currency,partnerAgreementRevision:policy.partnerAgreementRevision,
    principalFingerprint:policy.principalFingerprint,webhookCredentialFingerprint:policy.webhookCredentialFingerprint,
    employeeSchemaFingerprint:policy.employeeSchemaFingerprint,payStatementSchemaFingerprint:policy.payStatementSchemaFingerprint,
    mappingFingerprint:policy.mappingFingerprint,expectedCheckDate:policy.expectedCheckDate,
    expectedProcessId:policy.expectedProcessId,expectedRunId:policy.expectedRunId,pageLimit:policy.pageLimit,
    maxEmployees:policy.maxEmployees,maxPagesPerEmployee:policy.maxPagesPerEmployee,
    maxStatementsPerEmployee:policy.maxStatementsPerEmployee,maxTextBytes:policy.maxTextBytes
  };
  const authorityFingerprint=`sha256:${digest(scope)}`;
  const checkpointNamespace=`payroll-run-coverage:${digest({scope,authorityFingerprint})}`;

  function parsePass(rawPass,rosterSet,webhookTime,observedTime,previousCompletedAt){
    exactKeys(rawPass,new Set(['passIndex','startedAt','completedAt','employeeReads']),`passes[${rawPass.passIndex}]`);
    const passIndex=integer(rawPass.passIndex,'passIndex',{minimum:0,maximum:1});
    const startedAt=instant(rawPass.startedAt,`passes[${passIndex}].startedAt`,policy.maxTextBytes);
    const completedAt=instant(rawPass.completedAt,`passes[${passIndex}].completedAt`,policy.maxTextBytes);
    if(startedAt.milliseconds<webhookTime) fail('payroll read pass must start after the webhook process time');
    if(completedAt.milliseconds<=startedAt.milliseconds) fail('payroll read pass completion time must follow its start time');
    if(previousCompletedAt!==null&&startedAt.milliseconds<previousCompletedAt) fail('payroll read passes must be ordered without overlap');
    if(completedAt.milliseconds>observedTime) fail('payroll read pass exceeds the observation horizon');
    if(!Array.isArray(rawPass.employeeReads)||rawPass.employeeReads.length!==rosterSet.size) fail('payroll read pass does not provide exact roster coverage');

    const covered=new Set();const statementsById=new Map();const employeeCoverage=[];
    for(let employeeIndex=0;employeeIndex<rawPass.employeeReads.length;employeeIndex++){
      const rawRead=rawPass.employeeReads[employeeIndex],path=`passes[${passIndex}].employeeReads[${employeeIndex}]`;
      exactKeys(rawRead,new Set(['employeeId','pages']),path);
      const employeeId=text(rawRead.employeeId,`${path}.employeeId`,policy.maxTextBytes);
      if(!rosterSet.has(employeeId)) fail(`${path} employee is outside the complete roster`);
      if(covered.has(employeeId)) fail(`${path} duplicates employee coverage`);
      covered.add(employeeId);
      if(!Array.isArray(rawRead.pages)||rawRead.pages.length===0||rawRead.pages.length>policy.maxPagesPerEmployee) fail(`${path}.pages exceeds the page limit or is empty`);
      let expectedOffset=0;let totalCount=null;const statementFingerprints=[];
      for(let pageIndex=0;pageIndex<rawRead.pages.length;pageIndex++){
        const rawPage=rawRead.pages[pageIndex],pagePath=`${path}.pages[${pageIndex}]`;
        exactKeys(rawPage,new Set(['offset','limit','totalCount','successful','statements']),pagePath);
        if(rawPage.successful!==true) fail(`${pagePath} provider page failed`);
        same(integer(rawPage.offset,`${pagePath}.offset`),expectedOffset,'page offset');
        same(integer(rawPage.limit,`${pagePath}.limit`,{minimum:1}),policy.pageLimit,'page limit');
        const pageTotal=integer(rawPage.totalCount,`${pagePath}.totalCount`);
        if(pageTotal>policy.maxStatementsPerEmployee) fail(`${pagePath} exceeds the statement limit`);
        if(totalCount===null) totalCount=pageTotal; else same(pageTotal,totalCount,'page total count');
        if(!Array.isArray(rawPage.statements)||rawPage.statements.length>policy.pageLimit) fail(`${pagePath}.statements exceeds the page limit`);
        if(rawPage.statements.length===0&&expectedOffset<totalCount) fail(`${pagePath} is incomplete before the declared total count`);
        for(let statementIndex=0;statementIndex<rawPage.statements.length;statementIndex++){
          const rawStatement=rawPage.statements[statementIndex],statementPath=`${pagePath}.statements[${statementIndex}]`;
          exactKeys(rawStatement,new Set(['employeeId','payStatementId','processId','checkDate','payloadDigest']),statementPath);
          same(text(rawStatement.employeeId,`${statementPath}.employeeId`,policy.maxTextBytes),employeeId,'statement employee');
          const payStatementId=uuid(rawStatement.payStatementId,`${statementPath}.payStatementId`,policy.maxTextBytes);
          same(text(rawStatement.processId,`${statementPath}.processId`,policy.maxTextBytes),policy.expectedProcessId,'statement process');
          same(isoDate(rawStatement.checkDate,`${statementPath}.checkDate`,policy.maxTextBytes),policy.expectedCheckDate,'statement check date');
          const payloadDigest=fingerprint(rawStatement.payloadDigest,`${statementPath}.payloadDigest`,policy.maxTextBytes);
          const statementKey=payStatementId;
          if(statementsById.has(statementKey)) fail(`${statementPath} is a duplicate or cross-employee statement identity`);
          const scopedStatementFingerprint=`sha256:${digest({scope,employeeId,payStatementId,payloadDigest})}`;
          statementsById.set(statementKey,{employeeId,payStatementId,payloadDigest,scopedStatementFingerprint});
          statementFingerprints.push(scopedStatementFingerprint);
        }
        expectedOffset+=rawPage.statements.length;
        if(expectedOffset>totalCount) fail(`${pagePath} exceeds the declared total count`);
        if(expectedOffset===totalCount&&pageIndex!==rawRead.pages.length-1) fail(`${pagePath} has pages after terminal coverage`);
      }
      if(expectedOffset!==totalCount) fail(`${path} page chain is incomplete for the declared total count`);
      statementFingerprints.sort();
      employeeCoverage.push({
        employeeId,scopedEmployeeFingerprint:`sha256:${digest({scope,employeeId})}`,
        statementCount:statementFingerprints.length,statementFingerprints
      });
    }
    if(covered.size!==rosterSet.size) fail('payroll read pass has incomplete employee coverage');
    employeeCoverage.sort((left,right)=>left.employeeId<right.employeeId?-1:left.employeeId>right.employeeId?1:0);
    return {passIndex,startedAt:startedAt.canonical,completedAt:completedAt.canonical,completedAtMs:completedAt.milliseconds,employeeCoverage};
  }

  function admit(rawReceipt){
    const receipt=cloneInert(rawReceipt,'receipt');
    exactKeys(receipt,new Set([
      ...scopeFields,'apiOrigin','employeeRoute','payStatementRouteTemplate',...fingerprintFields,
      'checkpointPredecessor','observedAt','webhook','roster','passes'
    ]),'receipt');
    for(const field of scopeFields.filter(field=>!['timeZone','currency'].includes(field))) same(text(receipt[field],field,policy.maxTextBytes),policy[field],field);
    same(ianaZone(receipt.timeZone,policy.maxTextBytes),policy.timeZone,'time zone');
    same(currency(receipt.currency,policy.maxTextBytes),policy.currency,'currency');
    same(exactOrigin(receipt.apiOrigin,policy.maxTextBytes),policy.apiOrigin,'api origin');
    same(exactRoute(receipt.employeeRoute,'employeeRoute',policy.maxTextBytes),policy.employeeRoute,'employee route');
    same(exactRoute(receipt.payStatementRouteTemplate,'payStatementRouteTemplate',policy.maxTextBytes,{template:true}),policy.payStatementRouteTemplate,'pay statement route');
    for(const field of fingerprintFields) same(fingerprint(receipt[field],field,policy.maxTextBytes),policy[field],field);
    same(text(receipt.checkpointPredecessor,'checkpointPredecessor',policy.maxTextBytes),policy.expectedCheckpointPredecessor,'checkpoint predecessor');
    const observedAt=instant(receipt.observedAt,'observedAt',policy.maxTextBytes);
    same(observedAt.canonical,policy.expectedObservedAt,'observation horizon');

    exactKeys(receipt.webhook,new Set(['companyId','processId','checkDate','runId','processDate','status','originAuthenticated','tlsVersion','credentialFingerprint']),'webhook');
    same(text(receipt.webhook.companyId,'webhook.companyId',policy.maxTextBytes),policy.sourceCompanyId,'webhook company');
    same(text(receipt.webhook.processId,'webhook.processId',policy.maxTextBytes),policy.expectedProcessId,'webhook process');
    same(isoDate(receipt.webhook.checkDate,'webhook.checkDate',policy.maxTextBytes),policy.expectedCheckDate,'webhook check date');
    same(integer(receipt.webhook.runId,'webhook.runId'),policy.expectedRunId,'webhook run');
    const processDate=instant(receipt.webhook.processDate,'webhook.processDate',policy.maxTextBytes);
    if(receipt.webhook.status!=='Processed') fail('webhook status must be Processed');
    if(receipt.webhook.originAuthenticated!==true) fail('webhook origin authentication must be verified');
    if(receipt.webhook.tlsVersion!=='TLSv1.2'&&receipt.webhook.tlsVersion!=='TLSv1.3') fail('webhook transport must use TLS 1.2 or TLS 1.3');
    same(fingerprint(receipt.webhook.credentialFingerprint,'webhook.credentialFingerprint',policy.maxTextBytes),policy.webhookCredentialFingerprint,'webhook credential fingerprint');
    if(processDate.milliseconds>observedAt.milliseconds) fail('webhook process time exceeds the observation horizon');

    exactKeys(receipt.roster,new Set(['complete','reconciliationFingerprint','employeeIds']),'roster');
    if(receipt.roster.complete!==true) fail('employee roster is incomplete');
    const rosterReconciliationFingerprint=fingerprint(receipt.roster.reconciliationFingerprint,'roster.reconciliationFingerprint',policy.maxTextBytes);
    if(!Array.isArray(receipt.roster.employeeIds)||receipt.roster.employeeIds.length===0||receipt.roster.employeeIds.length>policy.maxEmployees) fail('employee roster exceeds the employee limit or is empty');
    const rosterSet=new Set();
    for(let index=0;index<receipt.roster.employeeIds.length;index++){
      const employeeId=text(receipt.roster.employeeIds[index],`roster.employeeIds[${index}]`,policy.maxTextBytes);
      if(rosterSet.has(employeeId)) fail('employee roster contains a duplicate employee identity');
      rosterSet.add(employeeId);
    }

    if(!Array.isArray(receipt.passes)||receipt.passes.length!==2) fail('exactly two stable payroll read passes are required');
    const first=parsePass(receipt.passes[0],rosterSet,processDate.milliseconds,observedAt.milliseconds,null);
    if(first.passIndex!==0) fail('first payroll read pass index must be zero');
    const second=parsePass(receipt.passes[1],rosterSet,processDate.milliseconds,observedAt.milliseconds,first.completedAtMs);
    if(second.passIndex!==1) fail('second payroll read pass index must be one');
    const firstComparable=first.employeeCoverage.map(item=>({...item}));
    const secondComparable=second.employeeCoverage.map(item=>({...item}));
    if(canonical(firstComparable)!==canonical(secondComparable)) fail('payroll statement coverage changed between stable passes');

    const employeeCoverage=first.employeeCoverage.map(({employeeId,...item})=>item);
    const payStatementCount=employeeCoverage.reduce((total,item)=>total+item.statementCount,0);
    const zeroStatementEmployeeCount=employeeCoverage.filter(item=>item.statementCount===0).length;
    const decision={
      payrollRunObservationCandidate:true,stableAcrossPasses:true,checkpointAdvanceAllowed:false,
      deletionAuthority:false,writeBackAuthority:false,payrollAuthority:false,attendanceAuthority:false,
      causalAuthority:false,...scope,authorityFingerprint,checkpointNamespace,
      checkpointPredecessor:policy.expectedCheckpointPredecessor,checkDate:policy.expectedCheckDate,
      processId:policy.expectedProcessId,runId:policy.expectedRunId,observedAt:observedAt.canonical,
      webhookProcessDate:processDate.canonical,webhookTlsVersion:receipt.webhook.tlsVersion,
      rosterReconciliationFingerprint,coveredEmployeeCount:employeeCoverage.length,payStatementCount,
      zeroStatementEmployeeCount,firstPassCompletedAt:first.completedAt,secondPassCompletedAt:second.completedAt,
      employeeCoverage
    };
    decision.reconciliationFingerprint=`sha256:${digest(decision)}`;
    return deepFreeze(decision);
  }
  return Object.freeze({admit});
}
