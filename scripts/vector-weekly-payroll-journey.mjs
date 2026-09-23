const SYNTHETIC_REASON='Synthetic fixture verification only: explicitly supplied fictional attendance evidence; no customer approval.';
const SAFE_ISSUE_TYPES=new Set(['missing','sync','adjustment','overtime']);

function invalid(code){throw new Error(code);}
function validId(value){return typeof value==='string'&&value.length>0;}

export function buildSyntheticWorkedResolution(issue,row){
  if(!issue||!row||!['missing','sync'].includes(issue.type)||issue.status!=='open'||!validId(issue.id)||!validId(row.date)) invalid('SYNTHETIC_WORKED_EVIDENCE_INVALID');
  return {type:'resolve-issue',team:null,issue:issue.id,issueType:issue.type,reason:SYNTHETIC_REASON,outcome:'worked',clockIn:row.date+'T06:00',clockOut:row.date+'T14:00',breakStart:row.date+'T10:00',breakEnd:row.date+'T10:30',breaksConfirmed:true};
}

function issueAction(team,issue){
  if(!SAFE_ISSUE_TYPES.has(issue?.type)) invalid('UNSUPPORTED_WEEKLY_ISSUE_TYPE');
  if(!validId(issue.id)||issue.status!=='open'||!validId(issue.row)) invalid('WEEKLY_ISSUE_INVALID');
  if(['missing','sync'].includes(issue.type)){
    const row=(team.records||[]).find(item=>item.id===issue.row);
    if(!row) invalid('WEEKLY_ISSUE_ROW_MISSING');
    return {...buildSyntheticWorkedResolution(issue,row),team:team.id};
  }
  if(issue.type==='adjustment'){
    if(!issue.proposed||typeof issue.proposed!=='object') invalid('WEEKLY_ADJUSTMENT_EVIDENCE_MISSING');
    return {type:'resolve-issue',team:team.id,issue:issue.id,issueType:'adjustment',reason:String(issue.evidence||SYNTHETIC_REASON),decision:'accept'};
  }
  return {type:'resolve-issue',team:team.id,issue:issue.id,issueType:'overtime',reason:String(issue.evidence||SYNTHETIC_REASON),decision:'approve'};
}

export function nextWeeklyAction(report){
  if(!report||!Array.isArray(report.teams)||report.teams.length===0) invalid('WEEKLY_REPORT_INVALID');
  for(const team of report.teams){
    if(!team||!validId(team.id)||!Array.isArray(team.issues)||!Array.isArray(team.categories)||!Array.isArray(team.employees)) invalid('WEEKLY_REPORT_INVALID');
    if(team.status==='signed') continue;
    if(['stale','returned'].includes(team.status)) invalid('WEEKLY_TEAM_NOT_SAFE_TO_AUTOMATE');
    const open=team.issues.find(item=>item?.status==='open');
    if(open) return issueAction(team,open);
    if(Array.isArray(team.blockers)&&team.blockers.length) invalid('WEEKLY_TEAM_BLOCKED');
    const category=team.categories.find(item=>item?.confirmed!==true);
    if(category){
      if(!validId(category.id)||Number(category.open||0)!==0) invalid('WEEKLY_CATEGORY_NOT_READY');
      return {type:'check-category',team:team.id,category:category.id};
    }
    const employee=team.employees.find(item=>item?.checked!==true);
    if(employee){
      if(!validId(employee.id)) invalid('WEEKLY_EMPLOYEE_INVALID');
      return {type:'check-employee',team:team.id,employee:employee.id};
    }
    if(team.canSign===true) return {type:'sign-team',team:team.id};
    invalid('WEEKLY_TEAM_NOT_READY_TO_SIGN');
  }
  return {type:'ready-for-payroll'};
}

export function verifyPayrollReady(report){
  const ready=!!report&&Array.isArray(report.teams)&&report.teams.length>0&&report.teams.every(team=>team?.status==='signed')&&Array.isArray(report.blockers)&&report.blockers.length===0&&report.canRelease===true&&report.reconciliation?.ok===true&&Array.isArray(report.lines)&&report.lines.length>0&&Number.isSafeInteger(report.totals?.employees)&&report.totals.employees>0;
  if(!ready) invalid('PAYROLL_NOT_READY');
  return true;
}

export function verifyReleasedPayroll(before,after,result){
  if(!result||!validId(result.id)||result.status!=='released'||!Array.isArray(before?.batches)||!Array.isArray(after?.batches)) invalid('PAYROLL_RELEASE_INVALID');
  if(before.batches.some(batch=>batch?.id===result.id)) invalid('PAYROLL_RELEASE_ID_REUSED');
  const saved=after.batches.find(batch=>batch?.id===result.id);
  if(!saved) invalid('PAYROLL_RELEASE_NOT_SAVED');
  if(saved.status!=='released'||!Number.isSafeInteger(saved.employeeCount)||saved.employeeCount<1||!Number.isSafeInteger(saved.rowCount)||saved.rowCount<1||!/^[a-f0-9]{64}$/i.test(String(saved.checksum||''))) invalid('PAYROLL_RELEASE_INVALID');
  return saved;
}

export const WEEKLY_PAYROLL_SYNTHETIC_REASON=SYNTHETIC_REASON;
