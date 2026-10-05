'use strict';
const {createHash,randomBytes,randomUUID}=require('node:crypto');
const Staffology=require('./staffology-adapter.cjs');

function fail(message,code='STAFFOLOGY_STORE_INVALID',status=409){const error=Error(message);error.code=code;error.status=status;throw error;}
function canonical(value){return Staffology.canonical(value);}
function digest(value){return createHash('sha256').update(canonical(value)).digest('hex');}
function text(value,label,max=256){if(typeof value!=='string'||!value||value!==value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))fail(`${label} is invalid.`);return value;}
const BINDING_FIELDS=['tenant','implementationRunId','candidateSha','deploymentId','configurationId','employerId'];
function exactKeys(value,fields,label){if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==fields.length||Object.keys(value).some(key=>!fields.includes(key)))fail(`${label} fields are invalid.`,label==='Binding'?'STAFFOLOGY_STORE_INVALID':'STAFFOLOGY_PERMIT_INVALID');}
function exactBinding(value){exactKeys(value,BINDING_FIELDS,'Binding');const result={};for(const key of BINDING_FIELDS)result[key]=text(value[key],`Binding ${key}`,160);if(!/^[a-f0-9]{40}$/.test(result.candidateSha))fail('Full source commit identity is required.','STAFFOLOGY_BINDING_INVALID');return Object.freeze(result);}
const PERMIT_FIELDS=['binding','deliveryId','digest','run','entryId','baselineSha256','baselineRunSha256','expectedBasicPay','rounding'];
const RUN_FIELDS=['taxYear','payPeriod','periodNumber','ordinal','version'];
function exactPermit(value){
 exactKeys(value,PERMIT_FIELDS,'Permit');const binding=exactBinding(value.binding);exactKeys(value.run,RUN_FIELDS,'Permit');
 const deliveryId=text(value.deliveryId,'Permit delivery',160),entryId=text(value.entryId,'Permit entry',160);
 for(const [field,hash] of [['digest',value.digest],['baselineSha256',value.baselineSha256],['baselineRunSha256',value.baselineRunSha256]])if(typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))fail(`Permit ${field} is invalid.`,'STAFFOLOGY_PERMIT_INVALID');
 if(typeof value.run.taxYear!=='string'||!/^Year\d{4}$/.test(value.run.taxYear)||typeof value.run.payPeriod!=='string'||!value.run.payPeriod||!Number.isSafeInteger(value.run.periodNumber)||!Number.isSafeInteger(value.run.ordinal)||!Number.isSafeInteger(value.run.version))fail('Permit run is invalid.','STAFFOLOGY_PERMIT_INVALID');
 if(typeof value.expectedBasicPay!=='string'||!/^\d{1,9}\.\d{2}$/.test(value.expectedBasicPay)||!['exact-cent','half-up'].includes(value.rounding))fail('Permit financial authority is invalid.','STAFFOLOGY_PERMIT_INVALID');
 return Object.freeze({binding,deliveryId,digest:value.digest,run:Object.freeze({...value.run}),entryId,baselineSha256:value.baselineSha256,baselineRunSha256:value.baselineRunSha256,expectedBasicPay:value.expectedBasicPay,rounding:value.rounding});
}

function createAuthority(db,{now=Date.now,resolvePrincipal}={}){
 db.exec(`CREATE TABLE IF NOT EXISTS outbound_staffology_approvals(
  id TEXT PRIMARY KEY,tenant TEXT NOT NULL,permit_digest TEXT NOT NULL UNIQUE,binding_digest TEXT NOT NULL,
  expires_at INTEGER NOT NULL,revoked_at INTEGER,consumed_at INTEGER,approved_by TEXT NOT NULL,approved_person_id TEXT,created_at INTEGER NOT NULL);`);
 if(!db.prepare("PRAGMA table_info(outbound_staffology_approvals)").all().some(row=>row.name==='approved_person_id'))db.exec('ALTER TABLE outbound_staffology_approvals ADD COLUMN approved_person_id TEXT');
 function issue(actor,permit,{ttlMs=300000}={}){
  if(!(actor?.permissions||[]).includes('payroll.export')||!(actor?.permissions||[]).includes('company.configure'))fail('Independent payroll release and company configuration permissions are required.','STAFFOLOGY_WRITE_NOT_AUTHORIZED',403);
  const approved=exactPermit(permit),binding=approved.binding,permitDigest=digest(approved),bindingDigest=digest(binding),created=Number(now()),expires=created+Math.max(1000,Math.min(900000,Number(ttlMs)));
  if(actor?.tenant!==binding.tenant)fail('Approval actor belongs to another tenant.','STAFFOLOGY_WRITE_NOT_AUTHORIZED',403);
  const approver=text(actor.email,'Approver account',254),personId=text(actor.personId,'Approver person',160),id=randomUUID();db.exec('BEGIN IMMEDIATE');try{const prior=db.prepare('SELECT * FROM outbound_staffology_approvals WHERE permit_digest=?').get(permitDigest);if(prior&&prior.revoked_at===null&&prior.consumed_at===null&&Number(prior.expires_at)>created&&prior.tenant===binding.tenant&&prior.binding_digest===bindingDigest&&prior.approved_by===approver&&prior.approved_person_id===personId){db.exec('COMMIT');return {id:prior.id,permitDigest,bindingDigest,expiresAt:Number(prior.expires_at),reused:true};}if(prior&&prior.consumed_at===null&&prior.revoked_at===null&&Number(prior.expires_at)>created)db.prepare('UPDATE outbound_staffology_approvals SET revoked_at=? WHERE id=? AND consumed_at IS NULL AND revoked_at IS NULL').run(created,prior.id);if(prior)db.prepare('DELETE FROM outbound_staffology_approvals WHERE id=? AND (revoked_at IS NOT NULL OR consumed_at IS NOT NULL OR expires_at<=?)').run(prior.id,created);db.prepare('INSERT INTO outbound_staffology_approvals(id,tenant,permit_digest,binding_digest,expires_at,approved_by,approved_person_id,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,binding.tenant,permitDigest,bindingDigest,expires,approver,personId,created);db.exec('COMMIT');return {id,permitDigest,bindingDigest,expiresAt:expires,reused:false};}catch(error){db.exec('ROLLBACK');throw error;}
 }
 function validated(permit){try{return exactPermit(permit);}catch(error){if(['STAFFOLOGY_PERMIT_INVALID','STAFFOLOGY_BINDING_INVALID','STAFFOLOGY_STORE_INVALID'].includes(error.code))return null;throw error;}}
 function row(permit){return db.prepare('SELECT * FROM outbound_staffology_approvals WHERE permit_digest=?').get(digest(permit));}
 function current(actor){if(!actor||typeof resolvePrincipal!=='function')return false;const live=resolvePrincipal({tenant:actor.tenant,email:actor.email});return Boolean(live&&live.tenant===actor.tenant&&live.email===actor.email&&live.personId===actor.personId&&(live.permissions||[]).includes('payroll.export')&&(live.permissions||[]).includes('company.configure'));}
 function check(permit){const approved=validated(permit);if(!approved)return false;const approval=row(approved),binding=approved.binding,at=Number(now());if(!approval||typeof resolvePrincipal!=='function')return false;const actor=resolvePrincipal({tenant:approval.tenant,email:approval.approved_by});return Boolean(actor&&actor.tenant===binding.tenant&&actor.email===approval.approved_by&&typeof approval.approved_person_id==='string'&&approval.approved_person_id.length>0&&actor.personId===approval.approved_person_id&&(actor.permissions||[]).includes('payroll.export')&&(actor.permissions||[]).includes('company.configure')&&approval.tenant===binding.tenant&&approval.binding_digest===digest(binding)&&approval.revoked_at===null&&approval.consumed_at===null&&Number(approval.expires_at)>at);}
 function consume(permit){const approved=validated(permit),approval=approved&&row(approved),at=Number(now());if(!approved||!check(approved))fail('Current exact Staffology approval is unavailable.','STAFFOLOGY_WRITE_NOT_AUTHORIZED',403);const changed=db.prepare('UPDATE outbound_staffology_approvals SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>?').run(at,approval.id,at);if(changed.changes!==1)fail('Staffology approval was already consumed.','STAFFOLOGY_WRITE_NOT_AUTHORIZED',403);return approval.id;}
 function revoke(actor,id){if(!(actor?.permissions||[]).includes('payroll.export'))fail('Payroll release permission is required.','STAFFOLOGY_WRITE_NOT_AUTHORIZED',403);const tenant=text(actor?.tenant,'Approval tenant',160),changed=db.prepare('UPDATE outbound_staffology_approvals SET revoked_at=? WHERE id=? AND tenant=? AND consumed_at IS NULL AND revoked_at IS NULL').run(Number(now()),text(id,'Approval id',80),tenant);return changed.changes===1;}
 return {issue,check,consume,revoke,current};
}

function createStore(db,{authority,binding,workerId='staffology-worker',now=Date.now,leaseMs=60000}={}){
 const trustedBinding=exactBinding(binding),bindingDigest=digest(trustedBinding),worker=text(workerId,'Worker identity',120);
 if(!authority||typeof authority.check!=='function'||typeof authority.consume!=='function')fail('Verified Staffology authority is required.','STAFFOLOGY_WRITE_NOT_AUTHORIZED',503);
 db.exec(`CREATE TABLE IF NOT EXISTS outbound_staffology_deliveries(
  delivery_id TEXT PRIMARY KEY,digest TEXT NOT NULL,binding_digest TEXT NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL,
  owner_token TEXT NOT NULL,owner_worker TEXT NOT NULL,fence INTEGER NOT NULL,lease_expires_at INTEGER NOT NULL,
  dispatch_json TEXT,receipt_json TEXT,uncertain_json TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS outbound_staffology_private_evidence(
  id INTEGER PRIMARY KEY AUTOINCREMENT,delivery_id TEXT NOT NULL REFERENCES outbound_staffology_deliveries(delivery_id),
  phase TEXT NOT NULL,evidence_json TEXT NOT NULL,evidence_digest TEXT NOT NULL,created_at INTEGER NOT NULL,
  UNIQUE(delivery_id,phase,evidence_digest));
 CREATE TABLE IF NOT EXISTS outbound_staffology_batch_receipts(
  batch_id TEXT NOT NULL,batch_checksum TEXT NOT NULL,binding_digest TEXT NOT NULL,manifest_digest TEXT NOT NULL,
  receipt_json TEXT NOT NULL,receipt_digest TEXT NOT NULL,created_at INTEGER NOT NULL,
  PRIMARY KEY(batch_id,batch_checksum,binding_digest));`);
 const raw=id=>db.prepare('SELECT * FROM outbound_staffology_deliveries WHERE delivery_id=?').get(String(id||''));
 const owned=(id,token,row=raw(id))=>{if(!row||row.owner_token!==token||row.owner_worker!==worker||row.binding_digest!==bindingDigest)fail('Staffology delivery ownership changed.','STAFFOLOGY_OWNERSHIP_LOST');if(Number(row.lease_expires_at)<=Number(now()))fail('Staffology delivery lease expired.','STAFFOLOGY_OWNERSHIP_LOST');return row;};
 function view(row){if(!row)return null;const evidence=db.prepare('SELECT phase,evidence_json FROM outbound_staffology_private_evidence WHERE delivery_id=? ORDER BY id').all(row.delivery_id).map(item=>({phase:item.phase,value:JSON.parse(item.evidence_json)}));const baseline=evidence.find(item=>item.phase==='baseline')?.value||null;return {deliveryId:row.delivery_id,digest:row.digest,bindingDigest:row.binding_digest,payload:JSON.parse(row.payload_json),status:row.status,receipt:row.receipt_json?JSON.parse(row.receipt_json):null,dispatchAttempt:row.dispatch_json?JSON.parse(row.dispatch_json):null,uncertainReason:row.uncertain_json?JSON.parse(row.uncertain_json):null,baseline,evidence};}
 function get(id){const row=raw(id);return row?.binding_digest===bindingDigest?view(row):null;}
 function begin(input){if(input.bindingDigest!==bindingDigest)fail('Staffology delivery binding changed.','STAFFOLOGY_OWNERSHIP_LOST');const at=Number(now()),token=randomBytes(32).toString('hex');db.exec('BEGIN IMMEDIATE');try{const prior=raw(input.deliveryId);if(prior){if(prior.binding_digest!==bindingDigest||prior.digest!==input.digest)fail('Staffology delivery identity belongs to another binding or intent.','STAFFOLOGY_OWNERSHIP_LOST');db.exec('COMMIT');return {acquired:false};}db.prepare('INSERT INTO outbound_staffology_deliveries(delivery_id,digest,binding_digest,payload_json,status,owner_token,owner_worker,fence,lease_expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(input.deliveryId,input.digest,bindingDigest,canonical(input.payload),'sending',token,worker,1,at+leaseMs,at,at);db.exec('COMMIT');return {acquired:true,token};}catch(error){db.exec('ROLLBACK');throw error;}}
 function recover(id,expectedDigest){const at=Number(now()),token=randomBytes(32).toString('hex');db.exec('BEGIN IMMEDIATE');try{const row=raw(id),recoverable=row&&(row.status==='uncertain'||(row.status==='sending'&&row.dispatch_json===null));if(!recoverable||row.digest!==expectedDigest||row.binding_digest!==bindingDigest||Number(row.lease_expires_at)>at)fail('Only an expired exact uncertain or provably undispatched Staffology delivery can be recovered.','STAFFOLOGY_RECOVERY_HELD');const changed=db.prepare("UPDATE outbound_staffology_deliveries SET owner_token=?,owner_worker=?,fence=fence+1,status='uncertain',lease_expires_at=?,updated_at=? WHERE delivery_id=? AND lease_expires_at<=? AND (status='uncertain' OR (status='sending' AND dispatch_json IS NULL))").run(token,worker,at+leaseMs,at,row.delivery_id,at);if(changed.changes!==1)fail('Staffology recovery ownership changed.','STAFFOLOGY_RECOVERY_HELD');db.exec('COMMIT');return {token,fence:Number(row.fence)+1};}catch(error){db.exec('ROLLBACK');throw error;}}
 function recordEvidence(id,evidence,token){const row=owned(id,token),phase=text(evidence?.phase,'Evidence phase',40),encoded=canonical(evidence),evidenceDigest=digest(evidence),at=Number(now());if(phase==='baseline'){const prior=db.prepare("SELECT evidence_digest FROM outbound_staffology_private_evidence WHERE delivery_id=? AND phase='baseline'").get(row.delivery_id);if(prior){if(prior.evidence_digest!==evidenceDigest)fail('Original Staffology baseline is immutable.','STAFFOLOGY_EVIDENCE_CONFLICT');return true;}}db.prepare('INSERT OR IGNORE INTO outbound_staffology_private_evidence(delivery_id,phase,evidence_json,evidence_digest,created_at) VALUES(?,?,?,?,?)').run(row.delivery_id,phase,encoded,evidenceDigest,at);const saved=db.prepare('SELECT evidence_json,evidence_digest FROM outbound_staffology_private_evidence WHERE delivery_id=? AND phase=? AND evidence_digest=?').get(row.delivery_id,phase,evidenceDigest);if(!saved||saved.evidence_digest!==evidenceDigest||saved.evidence_json!==encoded)fail('Staffology private evidence could not be read back after persistence.','STAFFOLOGY_EVIDENCE_NOT_PERSISTED',503);return true;}
 function assertOwned(input){const row=owned(input.deliveryId,input.token);if(row.digest!==input.digest||input.bindingDigest!==bindingDigest)fail('Staffology delivery binding changed.','STAFFOLOGY_OWNERSHIP_LOST');if(!input.dispatch)return true;if(row.dispatch_json)fail('Staffology dispatch was already reserved.','STAFFOLOGY_OWNERSHIP_LOST');const permit=exactPermit(input.permit),payload=JSON.parse(row.payload_json);if(digest(permit.binding)!==bindingDigest||permit.deliveryId!==row.delivery_id||permit.digest!==row.digest||permit.entryId!==payload.entryId||canonical(permit.run)!==canonical(payload.run)||permit.expectedBasicPay!==payload.expectedBasicPay||permit.rounding!==payload.rounding)fail('Staffology approval does not identify this exact delivery intent.','STAFFOLOGY_WRITE_NOT_AUTHORIZED',403);const expectedPath=`/employers/${encodeURIComponent(trustedBinding.employerId)}/payrun/${encodeURIComponent(payload.run.payPeriod)}/importpay?ordinal=${payload.run.ordinal}&linesOnly=false&append=false&updateExisting=false&validateOnly=false`;if(input.request?.method!=='POST'||input.request?.path!==expectedPath||input.request?.bodySha256!==digest(payload.importBody))fail('Staffology dispatch request differs from the approved employer and payload.','STAFFOLOGY_WRITE_NOT_AUTHORIZED',403);if(!authority.check(permit))fail('Current exact Staffology approval is unavailable.','STAFFOLOGY_WRITE_NOT_AUTHORIZED',403);const at=Number(now());db.exec('BEGIN IMMEDIATE');try{owned(input.deliveryId,input.token);const approvalId=authority.consume(permit),marker={deliveryId:row.delivery_id,digest:row.digest,bindingDigest,baselineSha256:permit.baselineSha256,baselineRunSha256:permit.baselineRunSha256,approvalId,request:input.request};const changed=db.prepare("UPDATE outbound_staffology_deliveries SET dispatch_json=?,status='uncertain',updated_at=? WHERE delivery_id=? AND dispatch_json IS NULL").run(canonical(marker),at,row.delivery_id);if(changed.changes!==1)fail('Staffology dispatch could not be reserved.','STAFFOLOGY_OWNERSHIP_LOST');db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}input.dispatch();return true;}
 function acknowledge(id,receipt,token){const row=owned(id,token),encoded=canonical(receipt);if(!row.dispatch_json)fail('A reserved dispatch is required before acknowledgement.');if(row.status==='acknowledged'){if(row.receipt_json!==encoded)fail('Acknowledged Staffology receipt is immutable.','STAFFOLOGY_RECEIPT_CONFLICT');return true;}const changed=db.prepare("UPDATE outbound_staffology_deliveries SET status='acknowledged',receipt_json=?,updated_at=? WHERE delivery_id=? AND status='uncertain'").run(encoded,Number(now()),row.delivery_id);if(changed.changes!==1)fail('Only an uncertain Staffology delivery can be acknowledged.','STAFFOLOGY_RECEIPT_CONFLICT');return true;}
 function markUncertain(id,reason,token){const row=owned(id,token);if(['acknowledged','rejected'].includes(row.status))fail('Final Staffology delivery cannot become uncertain.','STAFFOLOGY_RECEIPT_CONFLICT');db.prepare("UPDATE outbound_staffology_deliveries SET status='uncertain',uncertain_json=?,updated_at=? WHERE delivery_id=?").run(canonical(reason),Number(now()),row.delivery_id);return true;}
 function markRejected(id,reason,token){const row=owned(id,token);if(row.status==='acknowledged')fail('Acknowledged Staffology delivery cannot be rejected.','STAFFOLOGY_RECEIPT_CONFLICT');db.prepare("UPDATE outbound_staffology_deliveries SET status='rejected',uncertain_json=?,updated_at=? WHERE delivery_id=? AND status='uncertain'").run(canonical(reason),Number(now()),row.delivery_id);return true;}
 return {get,begin,recover,assertOwned,recordEvidence,acknowledge,markUncertain,markRejected};
}

function createBoundaries({db,now=Date.now,resolvePrincipal}={}){
 if(!db)fail('Canonical database is required.','STAFFOLOGY_STORE_INVALID',503);
 const authority=createAuthority(db,{now,resolvePrincipal});
 function bindingDigestFor(binding){return digest(exactBinding(binding));}
 function assertDeploymentSafe(binding){
  const current=bindingDigestFor(binding);
  const rows=db.prepare("SELECT delivery_id,binding_digest,status FROM outbound_staffology_deliveries WHERE status IN ('sending','uncertain')").all();
  const foreign=rows.filter(row=>row.binding_digest!==current);
  if(foreign.length)fail('A prior Staffology deployment has an unresolved sending/uncertain delivery and must reconcile it before replacement.','STAFFOLOGY_DEPLOYMENT_UNCERTAIN_SENDS',503);
  return {bindingDigest:current,unresolvedCurrent:rows.length};
 }
 function aggregateBatch(binding,manifest){
  const current=bindingDigestFor(binding);
  if(!manifest||typeof manifest!=='object'||!Array.isArray(manifest.lines)||!manifest.batchId||!manifest.batchChecksum||!manifest.manifestDigest)
    fail('A complete immutable Staffology batch manifest is required.','STAFFOLOGY_BATCH_COMPONENT_UNSUPPORTED');
  if(manifest.lines.length!==Number(manifest.expectedLineCount)||manifest.lines.length<1)
    fail('Staffology batch manifest line count is inconsistent.','STAFFOLOGY_BATCH_COMPONENT_UNSUPPORTED');
  let acknowledgedLineCount=0,acknowledgedGrossPence=0,heldLineCount=0;
  const results=[];
  for(const line of manifest.lines){
    if(line.status!=='mapped'){
      heldLineCount++;results.push({lineDigest:line.lineDigest,status:'held',reason:line.reason||'UNSUPPORTED'});continue;
    }
    const row=db.prepare('SELECT * FROM outbound_staffology_deliveries WHERE delivery_id=?').get(line.deliveryId);
    const receipt=row?.receipt_json?JSON.parse(row.receipt_json):null;
    const dispatch=row?.dispatch_json?JSON.parse(row.dispatch_json):null;
    const transport=db.prepare("SELECT evidence_json FROM outbound_staffology_private_evidence WHERE delivery_id=? AND phase='transport' ORDER BY id DESC LIMIT 1").get(line.deliveryId);
    const transportEvidence=transport?JSON.parse(transport.evidence_json):null;
    const ok=Boolean(row&&row.binding_digest===current&&row.digest===line.digest&&row.status==='acknowledged'&&dispatch&&receipt&&
      transportEvidence&&Number.isInteger(transportEvidence.httpStatus)&&/^[a-f0-9]{64}$/.test(transportEvidence.requestSha256||'')&&/^[a-f0-9]{64}$/.test(transportEvidence.responseSha256||''));
    if(ok){acknowledgedLineCount++;acknowledgedGrossPence+=Number(line.grossPence);results.push({lineDigest:line.lineDigest,status:'acknowledged',deliveryId:line.deliveryId});}
    else results.push({lineDigest:line.lineDigest,status:'unacknowledged',deliveryId:line.deliveryId});
  }
  const fullPayrollVerified=heldLineCount===0&&acknowledgedLineCount===Number(manifest.expectedLineCount)&&
    acknowledgedGrossPence===Number(manifest.expectedGrossPence)&&manifest.batchChecksum===text(manifest.batchChecksum,'Batch checksum',64);
  const receipt={schemaVersion:1,batchId:manifest.batchId,batchChecksum:manifest.batchChecksum,bindingDigest:current,
    manifestDigest:manifest.manifestDigest,expectedLineCount:Number(manifest.expectedLineCount),acknowledgedLineCount,heldLineCount,
    expectedGrossPence:Number(manifest.expectedGrossPence),acknowledgedGrossPence,allIdentitiesAccountedFor:results.length===Number(manifest.expectedLineCount),
    fullPayrollVerified,lines:results};
  if(!fullPayrollVerified)return receipt;
  const encoded=canonical(receipt),receiptDigest=digest(receipt),at=Number(now());
  const prior=db.prepare('SELECT receipt_json,receipt_digest,manifest_digest FROM outbound_staffology_batch_receipts WHERE batch_id=? AND batch_checksum=? AND binding_digest=?').get(manifest.batchId,manifest.batchChecksum,current);
  if(prior){
    if(prior.manifest_digest!==manifest.manifestDigest||prior.receipt_json!==encoded||prior.receipt_digest!==receiptDigest)
      fail('Staffology batch receipt is immutable for this exact batch and binding.','STAFFOLOGY_RECEIPT_CONFLICT');
    return receipt;
  }
  db.prepare('INSERT INTO outbound_staffology_batch_receipts(batch_id,batch_checksum,binding_digest,manifest_digest,receipt_json,receipt_digest,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(manifest.batchId,manifest.batchChecksum,current,manifest.manifestDigest,encoded,receiptDigest,at);
  const saved=db.prepare('SELECT receipt_json,receipt_digest FROM outbound_staffology_batch_receipts WHERE batch_id=? AND batch_checksum=? AND binding_digest=?').get(manifest.batchId,manifest.batchChecksum,current);
  if(!saved||saved.receipt_json!==encoded||saved.receipt_digest!==receiptDigest)fail('Staffology batch receipt could not be read back after persistence.','STAFFOLOGY_EVIDENCE_NOT_PERSISTED',503);
  return receipt;
 }
 return {
  authority,bindingDigestFor,assertDeploymentSafe,aggregateBatch,
  assertCurrentPrincipal(actor){if(!authority.current(actor))fail('Current exact Staffology principal authority is unavailable.','STAFFOLOGY_WRITE_NOT_AUTHORIZED',403);return true;},
  coordinator(options={}){const binding=exactBinding(options.binding),store=createStore(db,{authority,binding,workerId:options.workerId,now,leaseMs:Math.max(60000,(Number(options.config?.timeoutMs)||10000)*8)});return Staffology.createDeliveryCoordinator({...options,store,binding,authorizeWrite:permit=>authority.check(permit)});},
  approvedCoordinator(actor,options={}){if(!actor||typeof actor!=='object')fail('Authenticated approval actor is required.','STAFFOLOGY_WRITE_NOT_AUTHORIZED',403);const binding=exactBinding(options.binding),store=createStore(db,{authority,binding,workerId:options.workerId,now,leaseMs:Math.max(60000,(Number(options.config?.timeoutMs)||10000)*8)});let approvalId=null;const coordinator=Staffology.createDeliveryCoordinator({...options,store,binding,authorizeWrite:permit=>{if(!approvalId)approvalId=authority.issue(actor,permit,{ttlMs:options.approvalTtlMs}).id;return authority.check(permit);}});return {deliver:async input=>({...await coordinator.deliver(input),approvalId}),inspect:input=>coordinator.inspect(input),recover:async({deliveryId,digest})=>{const exactDelivery=text(deliveryId,'Delivery identity',160),stored=store.get(exactDelivery);if(!stored)fail('Exact Staffology delivery is unavailable.','STAFFOLOGY_RECOVERY_HELD');if(digest!==undefined&&text(digest,'Delivery digest',64)!==stored.digest)fail('Recovery digest differs from the stored intent.','STAFFOLOGY_RECOVERY_HELD');const hadDispatch=Boolean(stored.dispatchAttempt),claim=store.recover(exactDelivery,stored.digest),result=await coordinator.reconcile({deliveryId:exactDelivery,token:claim.token}),refreshed=store.get(exactDelivery),hasDispatch=Boolean(refreshed?.dispatchAttempt),mode=hasDispatch?(hadDispatch?'read-only-reconciliation':'recovery-dispatch'):'held-no-dispatch';return {...result,approvalId:refreshed?.dispatchAttempt?.approvalId||null,mode};}};},
  createStore:options=>createStore(db,{...options,authority,now}),
  status(){return {productionDatabase:true,durableOneShotAuthority:true,activationAvailable:false};}
 };
}

module.exports={createAuthority,createStore,createBoundaries,digest,exactBinding,exactPermit};
