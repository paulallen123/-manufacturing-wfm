#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const publicRoot=path.resolve(process.argv[2]||'');
if(!process.argv[2])throw Error('PUBLIC_ROOT_REQUIRED');
const target=path.join(publicRoot,'payroll-control.js');
const original=fs.readFileSync(target,'utf8');
const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
const expectedInput='ec5fa3cd5cb2bc4d2e66694b6211ad3dc8c24ea279bd48b0bc0fa01260eb1200';
if(sha256(original)!==expectedInput)throw Error('ATTENDANCE_INTEGRITY_SOURCE_HASH_MISMATCH');

const linkedGuard="if(i.attendanceRequestId){assert(linked&&linked.status==='awaiting_approval'&&linked.record===r.id&&linked.issue===i.id,'Linked employee request is no longer pending.',409);\n  assert(E.allowedPeople(s,a).some(e=>e.id===r.employee),'Current reporting access is required.',403);\n  assert(i.proposedBy!==a.personId&&linked.employee!==a.personId,'Independent review is required.',403);\n  if(x.decision==='accept')assert(i.sourceFingerprint===canonical({sourceVersion:r.sourceVersion,raw:r.raw,correction:r.correction||null}),'Source attendance changed after the proposal. Refresh and reconcile.',409);\n }";
const hardenedGuard="if(i.attendanceRequestId){assert(linked&&linked.status==='awaiting_approval'&&linked.record===r.id&&linked.issue===i.id,'Linked employee request is no longer pending.',409);\n  assert(E.allowedPeople(s,a).some(e=>e.id===r.employee),'Current reporting access is required.',403);\n  assert(i.proposedBy!==a.personId&&linked.employee!==a.personId,'Independent review is required.',403);\n }\n if(i.type==='adjustment'&&x.decision==='accept')assert(i.sourceFingerprint===canonical({sourceVersion:r.sourceVersion,raw:r.raw,correction:r.correction||null}),'Source attendance changed after the proposal. Refresh and reconcile.',409);";

const overlapGuard="if(linked&&x.decision==='accept'){\n  const v=effective(proposed);assert(!p.records.some(other=>other.id!==r.id&&other.employee===r.employee&&effective(other).kind==='worked'&&effective(other).clockIn&&effective(other).clockOut&&Date.parse(effective(other).clockIn)<Date.parse(v.clockOut)&&Date.parse(v.clockIn)<Date.parse(effective(other).clockOut)),'The proposed hours overlap another attendance record. Reconcile before approval.',409);\n }";
const hardenedOverlap="if((i.type==='adjustment'&&x.decision==='accept')||(['missing','sync'].includes(i.type)&&x.outcome==='worked')){\n  const v=effective(proposed),allRecords=s.payrollControl.periods.flatMap(sourcePeriod=>sourcePeriod.records.map(other=>({sourcePeriod,other})));assert(!allRecords.some(({sourcePeriod,other})=>(sourcePeriod.id!==p.id||other.id!==r.id)&&other.employee===r.employee&&effective(other).kind==='worked'&&effective(other).clockIn&&effective(other).clockOut&&Date.parse(effective(other).clockIn)<Date.parse(v.clockOut)&&Date.parse(v.clockIn)<Date.parse(effective(other).clockOut)),'The proposed hours overlap another attendance record. Reconcile before approval.',409);\n }";

const issueCreation="const i={id:'issue-amend-'+p.issues.length,team:t.id,employee:r.employee,row:r.id,category:'adjustments',type:'adjustment',status:'open',message:'Proposed clock correction needs another manager’s review.',proposed,proposedBy:a.personId,evidence:reason(x.reason)};";
const hardenedIssue="const i={id:'issue-amend-'+p.issues.length,team:t.id,employee:r.employee,row:r.id,category:'adjustments',type:'adjustment',status:'open',message:'Proposed clock correction needs another manager’s review.',proposed,proposedBy:a.personId,evidence:reason(x.reason),sourceFingerprint:canonical({sourceVersion:r.sourceVersion,raw:r.raw,correction:r.correction||null})};";

const personalIssue="const issue={id:'issue-personal-'+p.issues.length,team:t.id,employee:person.id,row:r.id,category:'adjustments',type:'adjustment',status:'open',message:'Captured Personal clocking is ready for manager review.',proposed,proposedBy:a.personId,evidence:'Authenticated Personal session '+session.id+' linked by payroll for independent manager review.',personalSessionId:session.id};";
const hardenedPersonalIssue="const issue={id:'issue-personal-'+p.issues.length,team:t.id,employee:person.id,row:r.id,category:'adjustments',type:'adjustment',status:'open',message:'Captured Personal clocking is ready for manager review.',proposed,proposedBy:a.personId,evidence:'Authenticated Personal session '+session.id+' linked by payroll for independent manager review.',personalSessionId:session.id,sourceFingerprint:canonical({sourceVersion:r.sourceVersion,raw:r.raw,correction:r.correction||null})};";

const fixtureIssue="function issue(r,category,type,message,extra={}){p.issues.push({id:'issue-'+p.issues.length,team:r.team,employee:r.employee,row:r.id,category,type,message,status:'open',...extra});}";
const hardenedFixtureIssue="function issue(r,category,type,message,extra={}){const item={id:'issue-'+p.issues.length,team:r.team,employee:r.employee,row:r.id,category,type,message,status:'open',...extra};if(type==='adjustment')item.sourceFingerprint=canonical({sourceVersion:r.sourceVersion,raw:r.raw,correction:r.correction||null});p.issues.push(item);}";

const resolutionRecordGuard="assert(r,'Source record is missing.',409);\n assert(!i.pendingAttendanceRequest,'This missing event has a linked proposal. Open Attendance corrections for independent review.',409);";
const hardenedResolutionRecordGuard="assert(r,'Source record is missing.',409);assert(E.allowedPeople(s,a).some(e=>e.id===r.employee),'Current reporting access is required.',403);\n assert(!i.pendingAttendanceRequest,'This missing event has a linked proposal. Open Attendance corrections for independent review.',409);";

const amendmentRecordGuard="assert(r,'Record not found.',404);assert(r.employee!==a.personId,'Cannot adjust your own record.',403);reason(x.reason);";
const hardenedAmendmentRecordGuard="assert(r,'Record not found.',404);assert(E.allowedPeople(s,a).some(e=>e.id===r.employee),'Current reporting access is required.',403);assert(r.employee!==a.personId,'Cannot adjust your own record.',403);reason(x.reason);";

const personalPeriodGuard="const t=group(p,person.manager);assert(t.employees.includes(person.id),'The employee is outside the frozen payroll roster.',409);assert(!session.durationReview,'An unusually long session needs manual attendance investigation before it can be linked.',409);";
const hardenedPersonalPeriodGuard="const t=group(p,person.manager);assert(t.employees.includes(person.id),'The employee is outside the frozen payroll roster.',409);locked(s,p,t);assert(!session.durationReview,'An unusually long session needs manual attendance investigation before it can be linked.',409);";

const declineValidation="const proposed={...r,correction:{...(r.correction||{}),...changes}};if(!(linked&&x.decision==='decline'))assert(!fieldsValid(proposed).length,fieldsValid(proposed).join(' '));";
const hardenedDeclineValidation="const proposed={...r,correction:{...(r.correction||{}),...changes}},declinedAdjustment=i.type==='adjustment'&&x.decision==='decline';if(!declinedAdjustment)assert(!fieldsValid(proposed).length,fieldsValid(proposed).join(' '));";

const declineMutation="if(!(linked&&x.decision==='decline')){r.correction=proposed.correction;r.reviewedBy=a.personId;r.evidenceNote=note;}i.status='resolved';";
const hardenedDeclineMutation="if(!declinedAdjustment){r.correction=proposed.correction;r.reviewedBy=a.personId;r.evidenceNote=note;}i.status='resolved';";

for(const [label,needle] of [['linked guard',linkedGuard],['overlap guard',overlapGuard],['issue creation',issueCreation],['personal-session issue',personalIssue],['fixture issue helper',fixtureIssue],['resolution current-scope guard',resolutionRecordGuard],['amendment current-scope guard',amendmentRecordGuard],['personal-session period lock',personalPeriodGuard],['decline validation',declineValidation],['decline mutation',declineMutation]]){
  const count=original.split(needle).length-1;
  if(count!==1)throw Error('ATTENDANCE_INTEGRITY_PATTERN_MISMATCH:'+label+':'+count);
}
let hardened=original
  .replace(linkedGuard,hardenedGuard)
  .replace(overlapGuard,hardenedOverlap)
  .replace(issueCreation,hardenedIssue)
  .replace(personalIssue,hardenedPersonalIssue)
  .replace(fixtureIssue,hardenedFixtureIssue)
  .replace(resolutionRecordGuard,hardenedResolutionRecordGuard)
  .replace(amendmentRecordGuard,hardenedAmendmentRecordGuard)
  .replace(personalPeriodGuard,hardenedPersonalPeriodGuard)
  .replace(declineValidation,hardenedDeclineValidation)
  .replace(declineMutation,hardenedDeclineMutation);
if(hardened===original)throw Error('ATTENDANCE_INTEGRITY_NO_CHANGE');
fs.writeFileSync(target,hardened);
console.log(JSON.stringify({
  status:'PASS',
  transform:'attendance-integrity-v4',
  inputSha256:expectedInput,
  outputSha256:sha256(hardened)
}));
