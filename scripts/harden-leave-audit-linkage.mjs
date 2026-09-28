import fs from 'node:fs';
import path from 'node:path';

const publicRoot = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('PUBLIC_ROOT_REQUIRED');

const rulesPath = path.join(publicRoot, 'work-rules.js');
let source = fs.readFileSync(rulesPath, 'utf8');
const original = "E.audit(s,a,'leave-decision',r.employee,p.decision);return {id:r.id,status:r.status};";
const hardened = "E.audit(s,a,'leave-decision',r.employee,`${r.id}; ${p.decision}`);return {id:r.id,status:r.status};";

if (source.includes(hardened)) {
  if (source.includes(original)) throw new Error('LEAVE_AUDIT_LINKAGE_AMBIGUOUS');
} else {
  if (source.split(original).length !== 2) throw new Error('LEAVE_AUDIT_LINKAGE_SOURCE_MISMATCH');
  source = source.replace(original, hardened);
  fs.writeFileSync(rulesPath, source);
}

if (!fs.readFileSync(rulesPath, 'utf8').includes(hardened)) {
  throw new Error('LEAVE_AUDIT_LINKAGE_NOT_APPLIED');
}

const serverPath = path.resolve(publicRoot, '..', 'server.cjs');
let server = fs.readFileSync(serverPath, 'utf8');
const originalLoad = "function load(tenant){return ON.decorate(OA.decorate(SP.decorate(RD.decorate(R.decorate(P.decorate(C.decorate(JSON.parse(db.prepare('SELECT state FROM tenants WHERE id=?').get(tenant).state))))))));}";
const hardenedLoad = "function leaveDecisionSeal(r){return {leaveDecisionSealVersion:1,requestId:r.id,employee:r.employee,decision:r.status,reviewedBy:r.reviewedBy,reviewedAt:r.reviewedAt,decisionReason:r.decisionReason};}function leaveDecisionSha256(e){return createHash('sha256').update(JSON.stringify({leaveDecisionSealVersion:e.leaveDecisionSealVersion,requestId:e.requestId,employee:e.employee,decision:e.decision,reviewedBy:e.reviewedBy,reviewedAt:e.reviewedAt,decisionReason:e.decisionReason})).digest('hex');}function mutationAuditDetail(command,s,result){const base={version:s.version,resultId:result?.id||null};if(command!=='leave-decision')return base;const r=s.requests.find(x=>x.id===result?.id);E.assert(r,'Leave decision state missing after mutation.',500);const evidence=leaveDecisionSeal(r);return {...base,...evidence,stateSha256:leaveDecisionSha256(evidence)};}function validateLeaveDecisionEvidence(tenant,s){const rows=db.prepare(\"SELECT detail FROM audit_events WHERE tenant=? AND action='leave-decision' ORDER BY id\").all(tenant);for(const row of rows){const detail=JSON.parse(row.detail);if(!Object.hasOwn(detail,'leaveDecisionSealVersion'))continue;E.assert(detail.leaveDecisionSealVersion===1,'Unsupported immutable leave decision evidence.',503);const r=s.requests.find(x=>x.id===detail.requestId);E.assert(r,'Immutable leave decision evidence has no matching request.',503);const actual=leaveDecisionSeal(r);for(const key of ['leaveDecisionSealVersion','requestId','employee','decision','reviewedBy','reviewedAt','decisionReason'])E.assert(actual[key]===detail[key],'Leave decision state does not match immutable evidence.',503);E.assert(leaveDecisionSha256(actual)===detail.stateSha256,'Leave decision evidence digest mismatch.',503);}}function load(tenant){const s=ON.decorate(OA.decorate(SP.decorate(RD.decorate(R.decorate(P.decorate(C.decorate(JSON.parse(db.prepare('SELECT state FROM tenants WHERE id=?').get(tenant).state))))))));validateLeaveDecisionEvidence(tenant,s);return s;}";
const originalAuditDetail = "JSON.stringify({version:s.version,resultId:result?.id||null})";
const hardenedAuditDetail = "JSON.stringify(mutationAuditDetail(input.command,s,result))";
const originalAuditIndex = "CREATE TABLE IF NOT EXISTS audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,tenant TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);";
const hardenedAuditIndex = `${originalAuditIndex}\nCREATE INDEX IF NOT EXISTS audit_events_tenant_action ON audit_events(tenant,action);`;

for (const [originalServer, hardenedServer, mismatch] of [
  [originalLoad, hardenedLoad, 'LEAVE_DECISION_LOAD_GUARD_SOURCE_MISMATCH'],
  [originalAuditDetail, hardenedAuditDetail, 'LEAVE_DECISION_AUDIT_SEAL_SOURCE_MISMATCH'],
  [originalAuditIndex, hardenedAuditIndex, 'LEAVE_DECISION_AUDIT_INDEX_SOURCE_MISMATCH'],
]) {
  if (server.includes(hardenedServer)) {
    if (server.includes(originalServer) && originalServer !== originalAuditIndex) throw new Error(`${mismatch}_AMBIGUOUS`);
  } else {
    if (server.split(originalServer).length !== 2) throw new Error(mismatch);
    server = server.replace(originalServer, hardenedServer);
  }
}
fs.writeFileSync(serverPath, server);

const verifiedServer = fs.readFileSync(serverPath, 'utf8');
for (const marker of [hardenedLoad, hardenedAuditDetail, hardenedAuditIndex]) {
  if (!verifiedServer.includes(marker)) throw new Error('LEAVE_DECISION_IMMUTABLE_EVIDENCE_NOT_APPLIED');
}
console.log('WFM_LEAVE_AUDIT_LINKAGE=PASS');
