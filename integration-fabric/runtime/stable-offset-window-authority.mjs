import {createHash} from 'node:crypto';

const SECRET=/(?:password|passwd|secret|token|credential|authorization|cookie|api[_-]?key|client[_-]?secret)/i;
function fail(message){throw new Error(message);}
function clone(value,path='value',seen=new WeakSet()){
 if(value===null||['string','number','boolean'].includes(typeof value)) return value;
 if(typeof value!=='object') fail(`${path} contains executable or unsupported data`);
 if(seen.has(value)) fail(`${path} contains cyclic data`);seen.add(value);
 if(Array.isArray(value)){const out=[];let count=0;for(const key of Reflect.ownKeys(value)){if(key==='length')continue;if(typeof key!=='string'||!/^(?:0|[1-9]\d*)$/.test(key))fail(`${path} contains invalid array data`);const d=Object.getOwnPropertyDescriptor(value,key);if(!d?.enumerable||!('value'in d))fail(`${path}[${key}] contains executable or hidden data`);out[key]=clone(d.value,`${path}[${key}]`,seen);count++;}if(count!==value.length)fail(`${path} contains sparse array data`);seen.delete(value);return out;}
 if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail(`${path} must be plain data`);const out=Object.create(null);for(const key of Reflect.ownKeys(value)){if(typeof key!=='string')fail(`${path} contains symbol data`);if(SECRET.test(key))fail(`${path}.${key} contains secret or credential material`);const d=Object.getOwnPropertyDescriptor(value,key);if(!d?.enumerable||!('value'in d))fail(`${path}.${key} contains executable or hidden data`);out[key]=clone(d.value,`${path}.${key}`,seen);}seen.delete(value);return out;
}
function exact(value,keys,path){for(const key of Object.keys(value))if(!keys.has(key))fail(`${path}.${key} is not allowed`);for(const key of keys)if(!Object.hasOwn(value,key))fail(`${path}.${key} is required`);}
function text(v,n){if(typeof v!=='string'||!v||v.trim()!==v||/[\u0000-\u001f\u007f]/.test(v))fail(`${n} must be a clean non-empty string`);return v;}
function fp(v,n){v=text(v,n);if(!/^sha256:[a-f0-9]{64}$/.test(v))fail(`${n} must be a canonical sha256 fingerprint`);return v;}
function integer(v,n,min=0,max=Number.MAX_SAFE_INTEGER){if(!Number.isSafeInteger(v)||v<min||v>max)fail(`${n} must be an integer from ${min} to ${max}`);return v;}
function instant(v,n){v=text(v,n);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||new Date(v).toISOString()!==v)fail(`${n} must be a canonical UTC instant`);return v;}
function origin(v){v=text(v,'oraclePodOrigin');let u;try{u=new URL(v);}catch{fail('oraclePodOrigin must be an exact HTTPS origin');}if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash||u.origin!==v)fail('oraclePodOrigin must be an exact HTTPS origin without a custom port');return v;}
function canonical(v){if(Array.isArray(v))return`[${v.map(canonical).join(',')}]`;if(v&&typeof v==='object')return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;return JSON.stringify(v);}
function hash(v){return createHash('sha256').update(canonical(v)).digest('hex');}
function same(a,b,n){if(a!==b)fail(`${n} does not match approved authority`);}
function freeze(v){if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;}

export function createStableOffsetWindowAuthority(rawPolicy){
 const p=clone(rawPolicy,'policy');
 const scope=['provider','wfmTenantId','connectionId','apiVersion','resource','method','organizationId','stableOrder'];
 const fps=['principalFingerprint','queryFingerprint','schemaFingerprint'];
 exact(p,new Set([...scope,'oraclePodOrigin',...fps,'expectedCheckpointPredecessor','windowStart','windowEnd','expectedObservedAt','pageLimit','maxPagesPerPass','maxRows']),'policy');
 for(const k of scope)p[k]=text(p[k],k);p.oraclePodOrigin=origin(p.oraclePodOrigin);for(const k of fps)p[k]=fp(p[k],k);
 if(p.provider!=='oracle-maintenance'||p.method!=='GET'||p.resource!=='maintenanceWorkOrders')fail('provider resource and method must be the exact Oracle Maintenance read route');
  if(!/^\d+\.\d+\.\d+\.\d+$/.test(p.apiVersion))fail('apiVersion must be an exact Oracle resource version');if(!/^(?:0|[1-9]\d{0,17})$/.test(p.organizationId))fail('organizationId must be a canonical Oracle precision-18 integer identity string');
 if(p.stableOrder!=='LastUpdateDate:asc,WorkOrderId:asc')fail('stable order must be LastUpdateDate:asc,WorkOrderId:asc');
 p.expectedCheckpointPredecessor=text(p.expectedCheckpointPredecessor,'expectedCheckpointPredecessor');p.windowStart=instant(p.windowStart,'windowStart');p.windowEnd=instant(p.windowEnd,'windowEnd');p.expectedObservedAt=instant(p.expectedObservedAt,'expectedObservedAt');
 if(p.windowStart>=p.windowEnd)fail('window must be non-empty');if(p.windowEnd>p.expectedObservedAt)fail('window end must not exceed the observation horizon');
 p.pageLimit=integer(p.pageLimit,'pageLimit',1,10000);p.maxPagesPerPass=integer(p.maxPagesPerPass,'maxPagesPerPass',1,10000);p.maxRows=integer(p.maxRows,'maxRows',1,1000000);freeze(p);
 const approved={...Object.fromEntries(scope.map(k=>[k,p[k]])),oraclePodOrigin:p.oraclePodOrigin,...Object.fromEntries(fps.map(k=>[k,p[k]]))};
 const namespace=`stable-offset-window:${hash(approved)}`;
 function normalizePass(rawPass,expectedIndex){
  exact(rawPass,new Set(['passIndex','pages']),`passes[${expectedIndex}]`);same(integer(rawPass.passIndex,'passIndex'),expectedIndex,'pass index');
  if(!Array.isArray(rawPass.pages)||rawPass.pages.length===0||rawPass.pages.length>p.maxPagesPerPass)fail('pass pages exceed limit or are missing');
  let expectedOffset=0,total=0,lastKey=null;const byIdentity=new Map(),rows=[];let exactReplayCount=0;
  rawPass.pages.forEach((page,i)=>{const path=`passes[${expectedIndex}].pages[${i}]`;exact(page,new Set(['offset','limit','count','hasMore','successful','rows']),path);same(integer(page.offset,`${path}.offset`),expectedOffset,'page offset');same(integer(page.limit,`${path}.limit`,1),p.pageLimit,'page limit');if(page.successful!==true)fail(`${path} failed`);if(!Array.isArray(page.rows))fail(`${path}.rows must be an array`);same(integer(page.count,`${path}.count`),page.rows.length,'page count');const last=i===rawPass.pages.length-1;if(page.hasMore!==(last?false:true))fail(`${path}.hasMore does not form one terminal chain`);if(!last&&page.count!==page.limit)fail(`${path} non-terminal count must equal limit`);expectedOffset+=page.limit;total+=page.count;if(total>p.maxRows)fail('rows exceed maxRows');
   page.rows.forEach((raw,j)=>{const rp=`${path}.rows[${j}]`;exact(raw,new Set(['workOrderId','organizationId','lastUpdateDate','payloadDigest']),rp);const workOrderId=text(raw.workOrderId,`${rp}.workOrderId`),organizationId=text(raw.organizationId,`${rp}.organizationId`),lastUpdateDate=instant(raw.lastUpdateDate,`${rp}.lastUpdateDate`),payloadDigest=fp(raw.payloadDigest,`${rp}.payloadDigest`);if(!/^(?:0|[1-9]\d{0,17})$/.test(workOrderId))fail(`${rp}.WorkOrderId must be a canonical Oracle precision-18 integer identity string`);same(organizationId,p.organizationId,'row organization');if(lastUpdateDate<p.windowStart||lastUpdateDate>=p.windowEnd)fail(`${rp} is outside the half-open window`);const orderKey=`${lastUpdateDate}\u0000${workOrderId.padStart(18,'0')}`;if(lastKey!==null&&orderKey<lastKey)fail(`${rp} violates stable order`);lastKey=orderKey;const normalized={workOrderId,organizationId,lastUpdateDate,payloadDigest};const identity=`${workOrderId}\u0000${lastUpdateDate}`;const prior=byIdentity.get(identity);if(prior){if(canonical(prior)!==canonical(normalized))fail(`${rp} conflicts at one work-order update identity`);exactReplayCount++;return;}byIdentity.set(identity,normalized);rows.push(normalized);});
  });
  return {rows,reportedRowCount:total,uniqueRowCount:rows.length,exactReplayCount};
 }
 function admit(rawReceipt){const r=clone(rawReceipt,'receipt');exact(r,new Set([...scope,'oraclePodOrigin',...fps,'checkpointPredecessor','windowStart','windowEnd','observedAt','complete','passes']),'receipt');for(const k of scope)same(text(r[k],k),p[k],k);same(origin(r.oraclePodOrigin),p.oraclePodOrigin,'origin');for(const k of fps)same(fp(r[k],k),p[k],k);same(text(r.checkpointPredecessor,'checkpointPredecessor'),p.expectedCheckpointPredecessor,'checkpoint predecessor');same(instant(r.windowStart,'windowStart'),p.windowStart,'window start');same(instant(r.windowEnd,'windowEnd'),p.windowEnd,'window end');same(instant(r.observedAt,'observedAt'),p.expectedObservedAt,'observation horizon');if(r.complete!==true)fail('receipt is incomplete');if(!Array.isArray(r.passes)||r.passes.length!==2)fail('exactly two independent passes are required');const a=normalizePass(r.passes[0],0),b=normalizePass(r.passes[1],1);if(canonical(a.rows)!==canonical(b.rows))fail('offset passes mismatch: mutable churn or missing rows detected');const decision={stableOffsetWindowCandidate:true,checkpointAdvanceAllowed:false,deletionAuthority:false,operationalDecisionAuthority:false,causalClaimAuthority:false,writeBackAuthority:false,payrollAuthority:false,attendanceAuthority:false,...approved,checkpointNamespace:namespace,checkpointPredecessor:p.expectedCheckpointPredecessor,windowStart:p.windowStart,windowEnd:p.windowEnd,observedAt:p.expectedObservedAt,passCount:2,pageCount:r.passes[0].pages.length+r.passes[1].pages.length,reportedRowCount:a.reportedRowCount,uniqueRowCount:a.uniqueRowCount,exactReplayCount:a.exactReplayCount+b.exactReplayCount,rows:a.rows};decision.reconciliationFingerprint=`sha256:${hash(decision)}`;return freeze(decision);}
 return Object.freeze({admit});
}
