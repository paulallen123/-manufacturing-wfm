'use strict';
const {createHash}=require('node:crypto');
const {isProviderReceiver}=require('./integration-gateway.cjs');

function fail(message,status=400){const e=Error(message);e.status=status;throw e;}
function clean(v,max=240){return String(v??'').trim().replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').slice(0,max);}
function stable(value){
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
 return value;
}
function canonical(value){return JSON.stringify(stable(value));}
function digest(value){return createHash('sha256').update(canonical(value)).digest('hex');}
function boundedPositiveInt(v,name,{min=0,max=1_000_000}={}){const n=Number(v);if(!Number.isSafeInteger(n)||n<min||n>max)fail(`${name} is invalid.`);return n;}
function isoish(v,name){const s=clean(v,120);if(!s)fail(`${name} revision is required.`);return s;}
function numericRevision(v,name){const s=isoish(v,name),n=Number(s);if(Number.isSafeInteger(n)&&n>=0)return String(n);const ms=Date.parse(s);if(Number.isSafeInteger(ms)&&ms>=0)return String(Math.floor(ms/1000));fail(`${name} revision must be a numeric revision or parseable modified timestamp.`);}
function compactCursor(prefix,value){return `${prefix}:${createHash('sha256').update(String(value)).digest('hex').slice(0,32)}`;}
function successFactorsDate(v){
 const s=String(v??'').trim();const m=s.match(/^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/);if(m){const d=new Date(Number(m[1]));if(Number.isFinite(d.getTime()))return d.toISOString().slice(0,10);}
 if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);
 return s;
}
function successFactorsName(row){return clean([row.firstName,row.middleName,row.lastName].filter(Boolean).join(' '),160);}
function sourceInstant(v){
 const s=String(v??'').trim(),m=s.match(/^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/);let ms=m?Number(m[1]):Date.parse(s);return Number.isFinite(ms)?new Date(ms).toISOString():null;
}
function latestSourceAt(values){const ms=values.map(sourceInstant).filter(Boolean).map(Date.parse).filter(Number.isFinite);return ms.length?new Date(Math.max(...ms)).toISOString():null;}

function createTokenLease(fetchToken,{now=Date.now,skewMs=30_000}={}){
 if(typeof fetchToken!=='function')fail('Token provider is required.',500);
 if(!Number.isFinite(Number(skewMs))||Number(skewMs)<0)fail('Token refresh skew is invalid.',500);
 let current=null;
 async function refresh(){
  const issued=await fetchToken();const accessToken=String(issued?.accessToken||'');
  if(!accessToken)fail('Provider token response did not contain an access token.',502);
  const expiresIn=Number(issued?.expiresIn);if(!Number.isFinite(expiresIn)||expiresIn<=0)fail('Provider token expiry is invalid.',502);
  const ttl=expiresIn*1000;if(ttl<=Number(skewMs))fail('Provider token expiry is too short for the configured refresh safety window.',502);
  current={accessToken,expiresAt:Number(now())+ttl};return accessToken;
 }
 return {
  async get(){if(!current||Number(now())>=current.expiresAt-Number(skewMs))return refresh();return current.accessToken;},
  invalidate(){current=null;},
  metadata(){return current?{expiresAt:current.expiresAt}:null;}
 };
}

function mapNetSuiteDemandPage(page,{sourceVersion}={}){
 if(!page||typeof page!=='object'||!Array.isArray(page.items))fail('NetSuite page must contain an items array.');
 const offset=boundedPositiveInt(page.offset??0,'NetSuite offset',{max:10_000_000}),count=boundedPositiveInt(page.count??page.items.length,'NetSuite count',{max:1000});
 if(count!==page.items.length)fail('NetSuite page count does not match returned items.');
 const ids=new Set();
 const sourceAt=latestSourceAt(page.items.map(row=>row?.lastModifiedDate??row?.lastmodifieddate??row?.revision));
 const records=page.items.map((row,i)=>{
  const externalId=clean(row?.id??row?.internalId??row?.tranId,128);if(!externalId)fail(`NetSuite record ${i+1} is missing a stable ID.`);
  if(ids.has(externalId))fail(`Duplicate NetSuite stable ID ${externalId} in one page.`);ids.add(externalId);
  const revision=numericRevision(row?.lastModifiedDate??row?.lastmodifieddate??row?.revision,`NetSuite record ${externalId}`);
  const date=clean(row?.trandate??row?.date,40),department=clean(row?.department??row?.departmentId,80),product=clean(row?.item??row?.product??row?.productId,100);
  if(!date||!department||!product)fail(`NetSuite record ${externalId} is missing date, department or product.`);
  const quantity=Number(row?.quantity);if(!Number.isFinite(quantity)||quantity<0)fail(`NetSuite record ${externalId} quantity is invalid.`);
  const data={date,department,product,kind:clean(row?.kind||'order',30),quantity};
  const sales=Number(row?.foreigntotal??row?.sales_amount??row?.salesAmount);if(Number.isFinite(sales))data.sales_amount=sales;
  if(row?.status!==undefined)data.status=clean(row.status,40);
  return {externalId,revision,operation:'upsert',data};
 });
 const nextOffset=offset+count,hasMore=Boolean(page.hasMore),nextRequest=hasMore?{offset:nextOffset,limit:Math.min(1000,Number(page.limit)||1000)}:null;
 const envelope={objectType:'demand',cursor:`ns:offset:${nextOffset}`,sourceVersion:clean(sourceVersion||page.sourceVersion||'unknown',120),records};
 return {envelope,nextRequest,reconciliation:{sourceCount:records.length,offset,nextOffset,totalResults:Number.isFinite(Number(page.totalResults))?Number(page.totalResults):null,hasMore,sourceAt}};
}

function mapSuccessFactorsPeoplePage(page,{sourceVersion,requestUrl}={}){
 const root=page?.d&&Array.isArray(page.d.results)?page.d:null;if(!root)fail('SuccessFactors page must contain d.results.');
 const ids=new Set();
 const sourceAt=latestSourceAt(root.results.map(row=>row?.lastModifiedDateTime??row?.lastModifiedOn??row?.revision));
 const records=root.results.map((row,i)=>{
  const externalId=clean(row?.personIdExternal??row?.userId??row?.personId,128);if(!externalId)fail(`SuccessFactors record ${i+1} is missing a stable person identity.`);
  if(ids.has(externalId))fail(`Duplicate SuccessFactors identity ${externalId} in one page.`);ids.add(externalId);
  const user=Array.isArray(row?.userNav?.results)?row.userNav.results[0]:row?.userNav;
  const revision=isoish(row?.lastModifiedDateTime??row?.lastModifiedOn??row?.revision,`SuccessFactors record ${externalId}`),name=successFactorsName(row)||successFactorsName(user)||clean(row?.name??user?.displayName,160),email=clean(row?.email??row?.emailAddress??user?.email??user?.emailAddress,180),manager=clean(row?.managerId??row?.manager_id??user?.managerId??user?.manager?.userId,80),site=clean(row?.location??row?.site??user?.location,100),job=clean(row?.jobTitle??row?.job??user?.jobTitle??user?.title,120),startDate=successFactorsDate(row?.startDate??row?.employmentStartDate??user?.hireDate),contractType=clean(row?.employmentType??row?.contractType??row?.employeeClass??user?.employmentType??user?.employeeClass,40),weeklyHours=Number(row?.standardHours??row?.weeklyHours);
  if(!name||!email||!manager||!site||!job||!startDate||!contractType||!Number.isFinite(weeklyHours)||weeklyHours<0)fail(`SuccessFactors record ${externalId} is missing required people fields.`);
  const data={payroll_id:clean(row?.payrollId??row?.payroll_id??row?.userId??externalId,100),name,email,manager_id:manager,site,job,start_date:startDate,contract_type:contractType,weekly_hours:String(weeklyHours),language:clean(row?.language??row?.locale??user?.language??user?.locale??'en-GB',20)};
  const skills=Array.isArray(row?.skills)?row.skills.map(v=>clean(v,80)).filter(Boolean):typeof row?.skills==='string'?row.skills.split(',').map(v=>clean(v,80)).filter(Boolean):[];if(skills.length)data.skills=skills.join(',');
  return {externalId,revision,operation:'upsert',data};
 });
 const current=String(requestUrl||'initial'),next=root.__next?String(root.__next):null;
 if(next&&next.length>4096)fail('SuccessFactors next-page URL is unexpectedly large.');
 const envelope={objectType:'people',cursor:compactCursor('sf',current),sourceVersion:clean(sourceVersion||page.sourceVersion||'unknown',120),records};
 return {envelope,nextRequest:next?{url:next}:null,reconciliation:{sourceCount:records.length,requestUrl:current,nextUrl:next,sourceAt}};
}


function mapSuccessFactorsIdentityPage(page,{sourceVersion,requestUrl}={}){
 const root=page?.d&&Array.isArray(page.d.results)?page.d:null;if(!root)fail('SuccessFactors identity page must contain d.results.');
 const sourceAt=latestSourceAt(root.results.map(row=>row?.lastModifiedDateTime??row?.lastModifiedOn??row?.lastModified??row?.revision));
 const ids=new Set();const records=root.results.map((row,i)=>{
  const externalId=clean(row?.userId??row?.personIdExternal??row?.username,128);if(!externalId)fail(`SuccessFactors identity record ${i+1} is missing a stable identity.`);
  if(ids.has(externalId))fail(`Duplicate SuccessFactors identity ${externalId} in one page.`);ids.add(externalId);
  const revision=isoish(row?.lastModifiedDateTime??row?.lastModifiedOn??row?.lastModified??row?.revision,`SuccessFactors identity ${externalId}`);
  const rawStatus=clean(row?.status??row?.userStatus??'unknown',30).toLowerCase();const status=['active','t','1'].includes(rawStatus)?'active':['inactive','f','0'].includes(rawStatus)?'inactive':'unknown';
  const name=successFactorsName(row)||clean(row?.displayName??row?.username??externalId,160),email=clean(row?.email??row?.emailAddress,180),username=clean(row?.username??row?.loginMethod??externalId,160);
  return {externalId,revision,operation:'upsert',data:{name,email,username,status}};
 });
 const current=String(requestUrl||'initial'),next=root.__next?String(root.__next):null;if(next&&next.length>4096)fail('SuccessFactors identity next-page URL is unexpectedly large.');
 return {envelope:{objectType:'identity',cursor:compactCursor('sfid',current),sourceVersion:clean(sourceVersion||page.sourceVersion||'unknown',120),records},nextRequest:next?{url:next}:null,reconciliation:{sourceCount:records.length,requestUrl:current,nextUrl:next,sourceAt}};
}

function idempotencyKey(name,envelope){
 const safe=clean(name,40).replace(/[^A-Za-z0-9_.:-]/g,'-')||'adapter';return `${safe}:${digest(envelope).slice(0,32)}`;
}
function retryDelayMs({status,retryAfterMs=0,attempt=0,maxRetryAfterMs=30_000,requestFingerprint='',adapterName='provider'}={}){
 const code=Number(status),cap=boundedPositiveInt(maxRetryAfterMs,'Adapter max retry delay',{min:0,max:300_000});if(![429,503].includes(code)||cap===0)return 0;const n=boundedPositiveInt(attempt,'Provider retry attempt',{min:0,max:10}),base=code===429?1000:500,exponential=Math.min(cap,base*(2**n)),providerDelay=Math.max(0,Number(retryAfterMs)||0),jitterCap=Math.min(250,cap),jitter=jitterCap?parseInt(createHash('sha256').update(`${clean(adapterName,80)}|${clean(requestFingerprint,128)}|${code}|${n}`).digest('hex').slice(0,8),16)%(jitterCap+1):0;return Math.min(cap,Math.max(providerDelay,exponential)+jitter);
}

async function runPagedAdapter({name,tokenLease,startRequest,fetchPage,mapPage,submitBatch,onPage,assertActiveLease=()=>{},maxPages=100,maxRetries=3,maxRetryAfterMs=30_000,sleep=(ms)=>new Promise(r=>setTimeout(r,ms))}={}){
 if(!name||!tokenLease||typeof tokenLease.get!=='function'||typeof fetchPage!=='function'||typeof mapPage!=='function'||typeof submitBatch!=='function')fail('Provider adapter contract is incomplete.',500);
 maxPages=boundedPositiveInt(maxPages,'Adapter max pages',{min:1,max:1000});maxRetries=boundedPositiveInt(maxRetries,'Adapter max retries',{min:0,max:10});maxRetryAfterMs=boundedPositiveInt(maxRetryAfterMs,'Adapter max retry delay',{min:0,max:300_000});
 let request=structuredClone(startRequest||{}),pages=0,sourceRecords=0,stagedRecords=0,heldRecords=0,appliedRecords=0,retries=0;const batches=[],seenRequests=new Set();
 while(request){
  assertActiveLease();
  if(pages>=maxPages)fail('Provider adapter page limit reached before pagination completed.',409);
  const requestFingerprint=digest(request);if(seenRequests.has(requestFingerprint))fail('Provider paging loop detected; repeated request was not staged.',409);seenRequests.add(requestFingerprint);
  let response,attempt=0;
  while(true){
   assertActiveLease();const accessToken=await tokenLease.get();assertActiveLease();response=await fetchPage({request:structuredClone(request),accessToken,attempt});assertActiveLease();const status=Number(response?.status);
   if(status>=200&&status<300)break;
   if(status===401&&attempt<maxRetries){tokenLease.invalidate();attempt++;retries++;continue;}
   if((status===429||status===503)&&attempt<maxRetries){const wait=retryDelayMs({status,retryAfterMs:response?.retryAfterMs,attempt,maxRetryAfterMs,requestFingerprint,adapterName:name});attempt++;retries++;if(wait)await sleep(wait);continue;}
   fail(`Provider adapter retry limit reached or non-retryable response (${Number.isFinite(status)?status:'unknown'}).`,502);
  }
  const mapped=mapPage(response.body,structuredClone(request));if(!mapped?.envelope||!Array.isArray(mapped.envelope.records)||mapped.envelope.records.length<1)fail('Provider adapter produced an empty or invalid gateway page.',502);
  const key=idempotencyKey(name,mapped.envelope),stage=(assertActiveLease(),await submitBatch({envelope:mapped.envelope,idempotencyKey:key,providerEvidence:mapped.reconciliation}));assertActiveLease();
  const pageSource=mapped.reconciliation?.sourceCount??mapped.envelope.records.length,pageValid=Number(stage?.valid||0),pageHeld=Number(stage?.held||0),nextRequest=mapped.nextRequest?structuredClone(mapped.nextRequest):null;
  pages++;sourceRecords+=pageSource;stagedRecords+=pageValid;heldRecords+=pageHeld;appliedRecords+=Number(stage?.applied||0);batches.push({id:stage?.id||null,idempotencyKey:key,status:stage?.status||'unknown',cursor:mapped.envelope.cursor,sourceVersion:mapped.envelope.sourceVersion,replayed:Boolean(stage?.replayed),sourceCount:pageSource,valid:pageValid,held:pageHeld});
  if(typeof onPage==='function'){const tokenMeta=typeof tokenLease.metadata==='function'?tokenLease.metadata():null;await onPage({page:pages,request:structuredClone(request),nextRequest:nextRequest?structuredClone(nextRequest):null,cursor:mapped.envelope.cursor,sourceVersion:mapped.envelope.sourceVersion,sourceRecords:pageSource,stagedRecords:pageValid,heldRecords:pageHeld,retries:attempt,sourceAt:mapped.reconciliation?.sourceAt||null,ingestedAt:new Date().toISOString(),httpStatus:Number.isFinite(Number(response?.status))?Number(response.status):null,httpLatencyMs:Number.isFinite(Number(response?.elapsedMs))?Math.max(0,Math.round(Number(response.elapsedMs))):null,tokenExpiresAt:Number.isFinite(Number(tokenMeta?.expiresAt))?Number(tokenMeta.expiresAt):null,stage:{id:stage?.id||null,replayed:Boolean(stage?.replayed)}});}
  request=nextRequest;
 }
 return {adapter:name,pages,sourceRecords,stagedRecords,heldRecords,appliedRecords,retries,batches,complete:heldRecords===0};
}

async function runDurableAdapterJob({jobStore,jobId,workerId,leaseMs=60_000,retryDelayMs=1_000,...adapter}={}){
 if(!jobStore||typeof jobStore.acquire!=='function'||typeof jobStore.assertLeaseHeld!=='function')fail('Durable provider job store is required.',500);
 if(!isProviderReceiver(adapter.submitBatch,jobStore))fail('Durable provider staging requires an admitted transactional receiver.',409);
 const job=jobStore.acquire(jobId,workerId,{leaseMs});
 try{
  if(job.pagesCompleted>0&&job.nextRequest===null){
   const result={adapter:adapter.name||job.adapterName,pages:0,sourceRecords:0,stagedRecords:0,heldRecords:0,appliedRecords:0,retries:0,batches:[],complete:job.heldRecords===0,recoveredTerminalCheckpoint:true};
   const completed=jobStore.complete(jobId,workerId,{...result,leaseGeneration:job.leaseGeneration,cumulativePages:job.pagesCompleted,cumulativeSourceRecords:job.sourceRecords,cumulativeStagedRecords:job.stagedRecords,cumulativeHeldRecords:job.heldRecords});return {result,job:completed};
  }
  const result=await runPagedAdapter({...adapter,submitBatch:batch=>adapter.submitBatch(batch,{jobId,workerId,leaseGeneration:job.leaseGeneration}),assertActiveLease:()=>jobStore.assertLeaseHeld(jobId,workerId,job.leaseGeneration),startRequest:job.nextRequest,onPage:async page=>{jobStore.checkpoint(jobId,workerId,{leaseGeneration:job.leaseGeneration,nextRequest:page.nextRequest,pages:1,sourceRecords:page.sourceRecords,stagedRecords:page.stagedRecords,heldRecords:page.heldRecords,retries:page.retries,cursor:page.cursor,sourceVersion:page.sourceVersion,sourceAt:page.sourceAt,ingestedAt:page.ingestedAt,httpStatus:page.httpStatus,httpLatencyMs:page.httpLatencyMs,tokenExpiresAt:page.tokenExpiresAt,freshnessSloSeconds:adapter.freshnessSloSeconds});if(typeof adapter.onPage==='function')await adapter.onPage(page);}});
  const completed=jobStore.complete(jobId,workerId,{...result,leaseGeneration:job.leaseGeneration});return {result,job:completed};
 }catch(error){try{error.job=jobStore.fail(jobId,workerId,error,{retryDelayMs,leaseGeneration:job.leaseGeneration});}catch(leaseError){error.leaseUpdateError={status:leaseError.status||500,message:leaseError.message};}throw error;}
}

module.exports={createTokenLease,mapNetSuiteDemandPage,mapSuccessFactorsPeoplePage,mapSuccessFactorsIdentityPage,runPagedAdapter,runDurableAdapterJob,idempotencyKey,retryDelayMs,digest,canonical};
