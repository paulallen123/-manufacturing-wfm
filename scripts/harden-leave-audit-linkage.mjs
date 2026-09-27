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
console.log('WFM_LEAVE_AUDIT_LINKAGE=PASS');
