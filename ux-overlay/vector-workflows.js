/* Vector-owned workflow presentation. API contracts retained from the verified
 * 0.6.76 runtime (artifact SHA256 3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d).
 * No retired presentation is loaded; the server remains the permission/pay authority. */
(function () {
  'use strict';
  const RF = globalThis.RF = { period: '2026-09-07', team: '', report: null, company: null, recoveryActuals: [], financeAttribution: [], epoch: 0 };
  const state = { busy: false, receipt: null, owner: '', epoch: 0 };
  const LF = { bootstrap: null, personal: null, busy: false, receipt: null, owner: '', epoch: 0 };
  const actor = () => payrollActor();
  const ownerKey = () => [actor()?.tenant, actor()?.email, actor()?.personId].join(':');
  const permitted = permission => !!actor() && PR.has(actor(), permission);
  const reviewer = () => ['manager', 'director', 'supervisor'].includes(actor()?.role);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const hours = minutes => (Number(minutes || 0) / 60).toLocaleString('en-GB', { maximumFractionDigits: 2 }) + ' h';
  const selected = () => RF.report?.teams.find(team => team.id === RF.team) || RF.report?.teams[0];
  const control = (label, action, id = '', disabled = false) => `<button type="button" class="btn small" data-vector-workflow="${escape(action)}" data-id="${escape(id)}"${disabled ? ' disabled' : ''}>${escape(label)}</button>`;
  const checked = (name, label) => `<label class="vw-check"><input type="checkbox" name="${name}" required>${escape(label)}</label>`;
  const reason = () => '<label>Evidence and reason<textarea name="reason" minlength="12" maxlength="500" required placeholder="Reference verified evidence. Do not include medical details."></textarea></label>';
  const payload = extra => {
    const team = selected();
    if (!team) throw Error('Select a source-confirmed review team.');
    return { period: RF.period, team: team.id, revision: team.revision, ...extra };
  };
  const record = id => {
    const row = selected()?.records.find(item => item.id === id);
    if (!row) throw Error('The source record is unavailable. Refresh the review.');
    return row;
  };
  function clearOwner() {
    const owner = ownerKey();
    if (owner === state.owner) return;
    state.owner = owner; RF.report = null; RF.company = null; RF.team = ''; state.receipt = null;
  }
  async function refresh() {
    if (OFFLINE) throw Error('Connect to the authenticated Vector service to review or change payroll records.');
    clearOwner();
    const epoch = ++RF.epoch, period = RF.period, owner = state.owner;
    const [report, company] = await Promise.all([
      reviewer() ? request('/api/weekly-review?period=' + encodeURIComponent(period)) : null,
      permitted('payroll.view') ? request('/api/payroll-run?period=' + encodeURIComponent(period)) : null
    ]);
    if (epoch !== RF.epoch || period !== RF.period || owner !== state.owner || owner !== ownerKey() || !F.ready) return false;
    RF.report = report; RF.company = company;
    if (!report?.teams.some(team => team.id === RF.team)) RF.team = report?.teams[0]?.id || '';
    return true;
  }
  function resultObserved(name, input, result) {
    const team = RF.report?.teams.find(item => item.id === input.team) || RF.company?.teams.find(item => item.id === input.team);
    if (name === 'review-check') return input.category ? team?.categories.some(item => item.id === input.category && item.confirmed) : team?.employees.some(item => item.id === input.employee && item.checked);
    if (name === 'review-sign') return team?.status === 'signed' && team.signature?.by === actor()?.personId;
    if (name === 'review-return') return team?.status === 'returned' && team.returnedReason === input.reason;
    if (name === 'review-resolve') return team?.issues.some(item => item.id === input.issue && item.status === 'resolved');
    if (name === 'review-amend') return team?.issues.some(item => item.row === input.record && item.type === 'adjustment' && item.status === 'open' && item.proposedBy === actor()?.personId);
    if (name === 'payroll-remind') return RF.company?.reminders.some(item => item.id === result.id && item.team === input.team && item.message === input.reason);
    if (['payroll-release', 'payroll-sent', 'payroll-void'].includes(name)) return RF.company?.batches.some(item => item.id === result.id && item.status === result.status);
    if (['payroll-adjustment-propose', 'payroll-adjustment-approve'].includes(name)) return RF.company?.adjustments.some(item => item.id === result.id && item.status === result.status);
    if (name === 'payroll-adjustment-export') return RF.company?.adjustmentBatches.some(item => item.id === result.id && item.status === result.status);
    if (name === 'payroll-link-personal') return RF.company?.discrepancies.some(item => item.sessionId === input.sessionId && item.code === 'PERSONAL_SESSION_PENDING_REVIEW');
    return false;
  }
  async function mutate(name, input) {
    if (state.busy) throw Error('An action is already being saved. Wait for its result.');
    if (OFFLINE) throw Error('An authenticated connection is required.');
    state.busy = true; state.receipt = null;
    const owner = ownerKey(), period = RF.period;
    const submit = document.querySelector('#modalform button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const response = await command(name, input);
      if (response?.ok !== true || !Number.isInteger(response.version)) throw Error('The service did not confirm a saved result. Refresh before trying again.');
      if (!F.ready || owner !== ownerKey() || period !== RF.period) throw Error('The account or review period changed. Reopen the source before checking this action.');
      const refreshed = await refresh();
      if (!refreshed || owner !== ownerKey() || !resultObserved(name, input, response.result || {})) throw Error('The service accepted the action, but its saved result is not yet confirmed in the source. Refresh and verify before retrying.');
      state.receipt = { action: name, id: response.result?.id || input.team || input.period, version: response.version, status: response.result?.status || 'saved' };
      toast('Saved and read back from the service · version ' + response.version + '.');
      return response;
    } finally {
      state.busy = false;
      if (submit) submit.disabled = false;
    }
  }
  function receipt() {
    const saved = state.receipt;
    return saved ? `<p class="vw-receipt" role="status">Saved result: ${escape(saved.action)} · ${escape(saved.id)} · ${escape(saved.status)} · version ${saved.version}. Read back from the authenticated service.</p>` : '';
  }
  function clearLeaveOwner() {
    const owner = ownerKey();
    if (owner === LF.owner) return;
    LF.owner = owner; LF.bootstrap = null; LF.personal = null; LF.receipt = null;
  }
  function leaveRequests() {
    return Array.isArray(LF.bootstrap?.state?.requests) ? LF.bootstrap.state.requests : [];
  }
  async function leaveRefresh() {
    if (OFFLINE) throw Error('Connect to the authenticated Vector service to review or request leave.');
    clearLeaveOwner();
    const owner = LF.owner, epoch = ++LF.epoch;
    const employee = actor()?.role === 'employee';
    const [bootstrap, personal] = await Promise.all([
      request('/api/bootstrap'),
      employee ? request('/api/personal') : null
    ]);
    if (epoch !== LF.epoch || owner !== LF.owner || owner !== ownerKey() || !F.ready) return false;
    LF.bootstrap = bootstrap; LF.personal = personal;
    return true;
  }
  async function leaveRequest(input) {
    if (LF.busy) throw Error('A leave action is already being saved. Wait for its result.');
    if (actor()?.role !== 'employee') throw Error('Only the employee can submit this leave request.');
    if (!LF.bootstrap && !(await leaveRefresh())) throw Error('Current leave evidence could not be loaded.');
    const owner = ownerKey(), date = String(input?.date || ''), hoursRequested = Number(input?.hours);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(hoursRequested) || hoursRequested < 0.5 || hoursRequested > 12) throw Error('Choose a valid date and 0.5–12 scheduled hours.');
    const beforeLeave = LF.personal?.leave, requestedMinutes = Math.round(hoursRequested * 60);
    if (!Number.isFinite(Number(beforeLeave?.availableMinutes)) || !Number.isFinite(Number(beforeLeave?.pendingMinutes))) throw Error('Current leave balance evidence is unavailable. Refresh before requesting leave.');
    LF.receipt = null;
    LF.busy = true;
    try {
      const response = await request('/api/personal/work', 'POST', {
        command: 'leave-request', payload: { date, hours: hoursRequested }, version: LF.bootstrap.state.version
      });
      if (response?.ok !== true || !response.result?.id || response.result.status !== 'pending') throw Error('The service did not confirm a saved leave request.');
      if (!(await leaveRefresh()) || owner !== ownerKey()) throw Error('The account changed before the leave request could be read back.');
      const saved = leaveRequests().find(item => item.id === response.result.id);
      const afterLeave = LF.personal?.leave;
      const requestMatches = saved?.status === 'pending' && saved.employee === actor()?.personId && saved.date === date && Number(saved.hours) === hoursRequested;
      const reservationMatches = Number(afterLeave?.availableMinutes) === Number(beforeLeave.availableMinutes) - requestedMinutes && Number(afterLeave?.pendingMinutes) === Number(beforeLeave.pendingMinutes) + requestedMinutes;
      if (!requestMatches || !reservationMatches) throw Error('The leave request was accepted but its saved balance and request details were not confirmed.');
      LF.receipt = { action: 'leave-request', id: saved.id, status: saved.status, version: response.version };
      toast('Leave request saved and read back from the service.');
      return response.result;
    } finally { LF.busy = false; }
  }
  async function leaveDecision(input) {
    if (LF.busy) throw Error('A leave action is already being saved. Wait for its result.');
    if (!reviewer()) throw Error('A manager role is required to decide this leave request.');
    if (!LF.bootstrap && !(await leaveRefresh())) throw Error('Current leave evidence could not be loaded.');
    const id = String(input?.id || ''), decision = String(input?.decision || '');
    if (!id || !['approved', 'declined'].includes(decision) || input?.reviewed !== true) throw Error('Review the request and choose an approved or declined decision.');
    const owner = ownerKey();
    LF.busy = true;
    try {
      const response = await request('/api/command', 'POST', {
        command: 'leave-decision',
        payload: { id, decision, reviewed: true, ...(input.reason ? { reason: String(input.reason) } : {}) },
        version: LF.bootstrap.state.version
      });
      if (response?.ok !== true || response.result?.id !== id) throw Error('The service did not confirm a saved leave decision.');
      if (!(await leaveRefresh()) || owner !== ownerKey()) throw Error('The account changed before the leave decision could be read back.');
      const saved = leaveRequests().find(item => item.id === id);
      if (saved?.status !== decision) throw Error('The leave decision was accepted but its saved result was not confirmed.');
      LF.receipt = { action: 'leave-decision', id, status: decision, version: response.version };
      toast('Leave decision saved and read back from the service.');
      return response.result;
    } finally { LF.busy = false; }
  }
  function leaveReceipt() {
    const saved = LF.receipt;
    return saved ? `<p class="vw-receipt" role="status">Saved and read back from the service · ${escape(saved.action)} · ${escape(saved.id)} · ${escape(saved.status)} · version ${escape(saved.version)}.</p>` : '';
  }
  function leavePage() {
    const employee = actor()?.role === 'employee';
    const requests = leaveRequests().filter(item => employee ? item.employee === actor()?.personId : item.status === 'pending');
    if (employee) {
      const leave = LF.personal?.leave;
      const nextDate = LF.personal?.shifts?.find(shift => shift?.start)?.start?.slice(0, 10) || '';
      return `<section class="vw-panel" data-vector-leave-route="employee"><h1>Absence &amp; Leave</h1><p>Request scheduled leave and track the saved manager decision.</p>${leaveReceipt()}<div class="personal-grid"><div><b>${escape((Number(leave?.availableMinutes || 0) / 60).toFixed(1))} hours</b><small>Available after pending requests</small></div><div><b>${escape((Number(leave?.pendingMinutes || 0) / 60).toFixed(1))} hours</b><small>Awaiting a manager decision</small></div></div>${control('Request leave', 'leave-request', nextDate, !nextDate || LF.busy)}<h2>My requests</h2>${requests.map(item => `<div class="vw-row" data-vector-leave-id="${escape(item.id)}"><span><b>${escape(item.kind || 'Annual leave')}</b><br>${escape(item.date || item.start)} · ${escape(item.hours)} hours</span><strong data-vector-leave-status>${escape(item.status)}</strong></div>`).join('') || '<p>No leave requests are recorded.</p>'}</section>`;
    }
    return `<section class="vw-panel" data-vector-leave-route="manager"><h1>Absence &amp; Leave</h1><p>Only source-saved requests in the authenticated scope can be decided.</p>${leaveReceipt()}<h2>Requests awaiting a decision</h2>${requests.map(item => `<div class="vw-row" data-vector-leave-id="${escape(item.id)}"><span><b>${escape(item.employeeName || item.employee)}</b><br>${escape(item.date || item.start)} · ${escape(item.hours)} hours<br><small>${escape(item.id)}</small></span><div>${control('Approve', 'leave-approve', item.id, LF.busy)}${control('Decline', 'leave-decline', item.id, LF.busy)}</div></div>`).join('') || '<p>No pending requests are visible in this reporting scope.</p>'}</section>`;
  }
  function evidence(rows) {
    return `<div class="vw-scroll"><table class="table"><thead><tr><th>Employee / date</th><th>Original clocking</th><th>Reviewed outcome</th><th>Worked / absence</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escape(selected()?.employees.find(person => person.id === row.employee)?.name || row.employee)}<br>${escape(row.date)}<br><small>${escape(row.id)}</small></td><td>${escape(row.raw.clockIn || 'Missing')}<br>${escape(row.raw.clockOut || 'Missing')}</td><td>${escape(row.effective.kind)}<br>${escape(row.effective.clockIn || '')}<br>${escape(row.effective.clockOut || '')}${row.correction ? '<br>Correction recorded; original retained' : ''}</td><td>${row.workedMinutes == null ? 'Unverified' : hours(row.workedMinutes)} / ${hours(row.effective.absenceMinutes)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function times(initial = {}) {
    if ((initial.breaks || []).length > 1 || (initial.breaks || []).some(item => item.paid)) throw Error('This record contains multiple or paid breaks. Use Attendance corrections with the full source break evidence; this compact editor will not replace them.');
    const local = value => value ? WFMCost.localDay(value) + 'T' + fmt(value) : '';
    return `<fieldset id="vw-work-fields"><legend>Verified worked time · Europe/London</legend><div class="formrow"><label>Clock-in<input type="datetime-local" name="clockIn" value="${escape(local(initial.clockIn))}" required></label><label>Clock-out<input type="datetime-local" name="clockOut" value="${escape(local(initial.clockOut))}" required></label></div><div class="formrow"><label>Unpaid break start<input type="datetime-local" name="breakStart" value="${escape(local(initial.breaks?.[0]?.start))}"></label><label>Unpaid break end<input type="datetime-local" name="breakEnd" value="${escape(local(initial.breaks?.[0]?.end))}"></label></div>${checked('breaksConfirmed', 'I verified actual unpaid breaks, including no unpaid break when blank.')}</fieldset>`;
  }
  function timeInput(form) {
    return Object.fromEntries(['clockIn', 'clockOut', 'breakStart', 'breakEnd'].map(key => [key, String(form.get(key) || '')]).concat([['breaksConfirmed', form.has('breaksConfirmed')]]));
  }
  function workflowModal(title, html, submit) {
    const owner = ownerKey(), period = RF.period;
    modal(title, html, async form => {
      if (!F.ready || owner !== ownerKey() || period !== RF.period) throw Error('The account or review period changed. Reopen this action from current source evidence.');
      return submit(form);
    });
  }
  function amend(id) {
    const row = record(id), basis = payload({ record: id });
    workflowModal('Propose a clock correction', evidence([row]) + times(row.effective) + reason() + '<p>A different authorised manager must approve. Original punches and payable time remain unchanged until approval.</p>' + modalActions('Submit for independent review'), form => mutate('review-amend', { ...basis, ...timeInput(form), reason: String(form.get('reason')) }));
  }
  function resolve(id) {
    const team = selected(), issue = team?.issues.find(item => item.id === id);
    if (!issue || issue.status !== 'open') throw Error('This exception is no longer open. Refresh the review.');
    const row = record(issue.row), basis = payload({ issue: id });
    let fields = '';
    if (['missing', 'sync'].includes(issue.type)) fields = '<label>Verified outcome<select name="outcome" id="vw-outcome"><option value="worked">Worked — verified clocking</option><option value="sickness">Confirmed sickness</option><option value="holiday">Approved holiday</option><option value="unpaid">Confirmed unpaid absence</option><option value="off_rota">Not due to work — verified rota</option></select></label>' + times(row.raw) + '<fieldset id="vw-absence-fields" hidden disabled><label>Verified absence hours<input type="number" name="absenceHours" min="0.0167" max="24" step="any" required></label></fieldset>';
    if (issue.type === 'adjustment') fields = `<details open><summary>Proposed correction and its evidence</summary><pre>${escape(JSON.stringify(issue.proposed, null, 2))}</pre><p>${escape(issue.evidence || '')}</p></details><label>Decision<select name="decision"><option value="accept">Accept supported correction</option><option value="decline">Decline; preserve original evidence</option></select></label>`;
    if (issue.type === 'overtime') fields = '<input type="hidden" name="decision" value="approve"><p>Confirm worked overtime and premiums. Actual work must not be deleted to avoid pay.</p>';
    workflowModal('Review source exception', `<p>${escape(issue.message)}</p>${evidence([row])}${fields}${reason()}${checked('checked', 'I checked source evidence; this is not an assumption copied from the rota.')}<p>Server checks enforce independent approval and reset affected weekly confirmations.</p>${modalActions('Record verified outcome')}`, form => mutate('review-resolve', { ...basis, ...timeInput(form), checked: form.has('checked'), reason: String(form.get('reason')), decision: form.get('decision'), outcome: form.get('outcome'), absenceMinutes: Math.round(Number(form.get('absenceHours')) * 60) }));
  }
  function check(kind, id) {
    const team = selected(), basis = payload({ [kind]: id });
    const category = kind === 'category' ? team.categories.find(item => item.id === id) : null;
    const rows = kind === 'employee' ? team.records.filter(row => row.employee === id) : team.records.filter(row => id === 'clocking' || (id === 'holiday' && row.effective.kind === 'holiday') || (id === 'sickness' && row.effective.kind === 'sickness') || (id === 'adjustments' && row.correction) || (id === 'overtime' && row.effective.kind === 'worked'));
    workflowModal(kind === 'employee' ? 'Verify employee totals' : 'Verify ' + category.name, `<p>${escape(category?.description || 'Review every daily outcome, including days with zero hours.')} · ${rows.length} records</p>${evidence(rows)}${checked('checked', 'I verified every relevant record and checked for missing or incorrectly classified entries.')}${modalActions('Save verification')}`, form => mutate('review-check', { ...basis, checked: form.has('checked') }));
  }
  function weeklyPage() {
    const team = selected();
    if (!team) return '<section class="vw-panel"><h1>Weekly sign-off</h1><p>No review team is available to your authenticated account.</p></section>';
    const locked = ['signed', 'stale'].includes(team.status), open = team.issues.filter(issue => issue.status === 'open');
    return `<section class="vw-panel"><h1>Weekly sign-off</h1><p>Resolve evidence, verify each employee and section, then sign the exact reviewed version.</p>${receipt()}<div class="vw-toolbar"><label>Review week<select id="vw-period">${RF.report.periods.map(period => `<option value="${escape(period.id)}"${period.id === RF.period ? ' selected' : ''}>${escape(period.start)} – ${escape(period.end)}</option>`).join('')}</select></label><label>Team<select id="vw-team">${RF.report.teams.map(item => `<option value="${escape(item.id)}"${item.id === team.id ? ' selected' : ''}>${escape(item.name)}</option>`).join('')}</select></label>${control('Time Review', 'time')}${permitted('payroll.view') ? control('Payroll preparation', 'payroll') : ''}</div><p><strong>${escape(team.status)} · revision ${team.revision}</strong> · ${team.checkedEmployees}/${team.employees.length} employees checked · ${hours(team.workedMinutes)} worked${team.signature ? ' · signed by ' + escape(team.signature.by) + ' at ' + escape(team.signature.at) : ''}</p>${team.returnedReason ? '<p>' + escape(team.returnedReason) + '</p>' : ''}<h2>Exceptions (${open.length})</h2>${open.map(issue => `<div class="vw-row"><span><b>${escape(team.employees.find(person => person.id === issue.employee)?.name || issue.employee)}</b><br>${escape(issue.message)}</span>${control('Review evidence', 'issue', issue.id, locked)}</div>`).join('') || '<p>No unresolved source exceptions.</p>'}${team.blockers.map(item => `<p class="vw-warning">${escape(item.message)}</p>`).join('')}<details open><summary>Review sections</summary>${team.categories.map(category => `<div class="vw-row"><span>${escape(category.name)} · ${category.confirmed ? 'confirmed' : category.open + ' open checks'}</span>${control('Inspect and verify', 'category', category.id, locked || !!category.open)}</div>`).join('')}</details><details><summary>Employee totals · ${team.checkedEmployees}/${team.employees.length} verified</summary>${team.employees.map(person => `<div class="vw-row"><span><b>${escape(person.name)}</b> · ${hours(person.workedMinutes)} worked · ${hours(person.holidayMinutes)} holiday · ${person.checked ? 'verified' : 'needs verification'}</span>${control('Inspect and verify', 'employee', person.id, locked || !!team.blockers.length)}</div>`).join('')}</details><div class="vw-toolbar">${control('Sign and lock week', 'sign', '', !team.canSign)}${control('Return for correction', 'return', team.id, !locked)}</div><p>All required confirmations remain mandatory. A signed version cannot be silently changed.</p></section>`;
  }
  function payrollPage() {
    const report = RF.company;
    if (!report) return '<section class="vw-panel"><h1>Payroll preparation</h1><p>Explicit payroll viewing permission is required.</p></section>';
    const exportAllowed = permitted('payroll.export');
    return `<section class="vw-panel"><h1>Payroll preparation</h1><p>Approved time, controlled export and recorded hand-off. Provider acceptance is a separate result.</p>${receipt()}<div class="vw-toolbar"><label>Payroll week<select id="vw-period">${report.periods.map(period => `<option value="${escape(period.id)}"${period.id === RF.period ? ' selected' : ''}>${escape(period.start)} – ${escape(period.end)}</option>`).join('')}</select></label>${reviewer() ? control('Weekly sign-off', 'weekly') : ''}</div><p><b>${report.teams.filter(team => team.status === 'signed').length}/${report.teams.length} teams signed</b> · ${report.totals.employees} expected employees · ${hours(report.totals.workedMinutes)} worked</p><h2>Release checks</h2>${report.blockers.map(item => `<p class="vw-warning">${escape(item)}</p>`).join('') || '<p>Source controls reconcile for this version.</p>'}${(report.discrepancies || []).map(item => `<div class="vw-row"><span>${escape(item.title || item.code)}<br>${escape(item.explanation || item.message)}</span>${item.fixable ? control('Link for manager review', 'link', item.sessionId, !permitted('payroll.reopen')) : escape(item.fixLabel || 'Review source evidence')}</div>`).join('')}<details><summary>Team approvals</summary>${report.teams.map(team => `<div class="vw-row"><span>${escape(team.name)} · ${escape(team.status)} · ${team.checkedEmployees}/${team.employees.length} checked</span>${team.status === 'signed' || team.status === 'stale' ? control('Return', 'return', team.id, !permitted('payroll.reopen')) : control('Remind owner', 'remind', team.id, !permitted('payroll.remind'))}</div>`).join('')}</details><details><summary>Exact export rows and reconciliation</summary><p>${escape(report.schema)}</p><pre>${escape(JSON.stringify(report.reconciliation, null, 2))}</pre><div class="vw-scroll"><table class="table"><thead><tr><th>Payroll ID</th><th>Date</th><th>Code</th><th>Minutes</th><th>Gross</th></tr></thead><tbody>${report.lines.map(line => `<tr><td>${escape(line.payrollId)}</td><td>${escape(line.date)}</td><td>${escape(line.code)}</td><td>${escape(line.minutes)}</td><td>${escape(line.gross || '')}</td></tr>`).join('')}</tbody></table></div></details>${control('Review and release CSV', 'release', '', !exportAllowed || !report.canRelease)}<h2>Released files</h2>${report.batches.map(batch => `<div class="vw-row"><span><b>${escape(batch.id)}</b> · ${escape(batch.status)}<br>${batch.employeeCount} people · ${batch.rowCount} rows<br><small>${escape(batch.checksum || 'Checksum unavailable')}</small></span><div>${control('Download CSV', 'download', batch.id, !exportAllowed || batch.status === 'void')}${batch.status === 'released' ? control('Record hand-off', 'sent', batch.id, !exportAllowed) + control('Void unsubmitted file', 'void', batch.id, !permitted('payroll.reopen')) : ''}</div></div>`).join('') || '<p>No file released for this week.</p>'}<details><summary>Separate post-release corrections</summary>${adjustments(report)}</details><details><summary>Recent control activity</summary>${report.audit.slice(-15).reverse().map(item => `<p>${escape(item.type)} · ${escape(item.actor)} · ${escape(item.at)}</p>`).join('')}</details><p>${escape(report.exportNote)}</p></section>`;
  }
  function adjustments(report) {
    return (report.adjustmentCandidates || []).map(item => `<div class="vw-row"><span>${escape(item.employeeName || item.employee)} · ${escape(item.note)}</span>${control('Prepare separate adjustment', 'adjust-prepare', item.request, !permitted('payroll.reopen'))}</div>`).join('') + (report.adjustments || []).map(item => `<div class="vw-row"><span>${escape(item.id)} · ${escape(item.employeeName || item.employee)} · ${escape(item.status)} · ${escape(item.minutesDelta)} minutes · £${(Number(item.grossPenceDelta) / 100).toFixed(2)}</span>${item.status === 'pending_approval' ? control('Independent review', 'adjust-review', item.id, !permitted('payroll.reopen')) : ''}</div>`).join('') + control('Release approved adjustment CSV', 'adjust-release', '', !permitted('payroll.export') || !(report.adjustments || []).some(item => item.status === 'approved' && !item.exportBatchId)) + (report.adjustmentBatches || []).map(batch => `<p>${escape(batch.id)} · ${escape(batch.checksum)} ${control('Download adjustment CSV', 'adjust-download', batch.id, !permitted('payroll.export'))}</p>`).join('');
  }
  async function download(id, adjustment = false) {
    const res = await fetch((adjustment ? '/api/payroll-adjustment-export/' : '/api/payroll-export/') + encodeURIComponent(id), { credentials: 'same-origin' });
    if (!res.ok) { const error = await res.json(); throw Error(error.error || 'Download refused.'); }
    const blob = await res.blob(), url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = (adjustment ? RF.company.adjustmentBatches : RF.company.batches).find(batch => batch.id === id)?.filename || ('payroll-' + id + '.csv'); link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500); toast('Immutable CSV downloaded; access recorded by the service.');
  }
  async function action(name, id = '') {
    if (name === 'leave-request') {
      const date = id || LF.personal?.shifts?.find(shift => shift?.start)?.start?.slice(0, 10) || '';
      return modal('Request leave', `<label>Date<input name="date" type="date" value="${escape(date)}" required></label><label>Scheduled paid hours<input name="hours" type="number" min=".5" max="12" step=".5" value="7.5" required></label><p>The authenticated service checks entitlement and overlapping requests before saving.</p>${modalActions('Send request')}`, form => leaveRequest({ date: String(form.get('date')), hours: Number(form.get('hours')) }));
    }
    if (name === 'leave-approve' || name === 'leave-decline') {
      const decision = name === 'leave-approve' ? 'approved' : 'declined';
      return modal(decision === 'approved' ? 'Approve leave request' : 'Decline leave request', `<p>Request ${escape(id)}. The decision is saved only after server-side entitlement, overlap, role and staffing checks.</p>${decision === 'declined' ? reason() : ''}${checked('reviewed', 'I reviewed the current request and available evidence.')}${modalActions('Save decision')}`, form => leaveDecision({ id, decision, reviewed: form.has('reviewed'), reason: String(form.get('reason') || '') }));
    }
    if (name === 'weekly' || name === 'payroll' || name === 'time') { if (ui.page === 'time-review' && typeof triClean === 'function' && !triClean()) return; ui.page = ({ weekly: 'vector-weekly-signoff', payroll: 'payroll-run', time: 'time-review' })[name]; return render(); }
    if (name === 'issue') return resolve(id);
    if (name === 'category' || name === 'employee') return check(name, id);
    if (name === 'sign') { const team = selected(), basis = payload({ attestation: 'confirmed' }); if (!team.canSign) throw Error('Complete every source review before signing.'); return workflowModal('Sign and lock this week', `<p>${escape(team.name)} · ${team.employees.length} employees · ${hours(team.workedMinutes)}</p>${checked('checked', 'I verified attendance, absences, amendments, overtime and every employee total against the available evidence.')}${modalActions('Sign exact reviewed version')}`, form => mutate('review-sign', { ...basis, checked: form.has('checked') })); }
    if (name === 'return' || name === 'remind') { const period = RF.period; return workflowModal(name === 'return' ? 'Return for fresh review' : 'Create in-app reminder', reason() + '<p>' + (name === 'return' ? 'Existing confirmations will be cleared. A new review and signature are required.' : 'This records an in-app reminder; no email is sent.') + '</p>' + modalActions('Save'), form => mutate(name === 'return' ? 'review-return' : 'payroll-remind', { period, team: id, reason: String(form.get('reason')) })); }
    if (name === 'release') { const report = RF.company, period = RF.period; if (!report?.canRelease) throw Error('Payroll release remains blocked by source controls.'); return workflowModal('Review payroll release', `<p>${report.totals.employees} employees · ${report.lines.length} rows · ${hours(report.totals.workedMinutes)}</p>${checked('checked', 'I verified the complete roster, manager signatures and control totals.')}${checked('schemaReviewed', 'I verified the downstream pay-code, rate, rounding and absence mapping.')}${report.schema.includes('time-review') ? checked('timeReviewMappingReviewed', 'I verified time-review pay codes, paid absence hours and exclusions.') : ''}<p>This creates an immutable CSV. It does not upload to a provider or pay employees.</p>${modalActions('Release locked CSV')}`, form => mutate('payroll-release', { period, checked: form.has('checked'), schemaReviewed: form.has('schemaReviewed'), timeReviewMappingReviewed: form.has('timeReviewMappingReviewed') })); }
    if (name === 'download' || name === 'adjust-download') return download(id, name === 'adjust-download');
    if (name === 'sent' || name === 'void') { const period = RF.period; return workflowModal(name === 'sent' ? 'Record manual hand-off' : 'Void an unsubmitted file', reason() + checked(name === 'sent' ? 'checked' : 'notSubmitted', name === 'sent' ? 'I confirm this file was handed off. This is not provider acceptance.' : 'This file has not been sent or imported. All downloaded copies will be discarded.') + modalActions('Save record'), form => mutate('payroll-' + name, { period, batch: id, reason: String(form.get('reason')), checked: form.has('checked'), notSubmitted: form.has('notSubmitted') })); }
    if (name === 'link') { const item = RF.company.discrepancies.find(item => item.sessionId === id && item.fixable); if (!item) throw Error('The source discrepancy changed. Refresh first.'); await mutate('payroll-link-personal', { period: RF.period, sessionId: id, employee: item.employee }); return render(); }
    if (name === 'adjust-prepare') { const item = RF.company.adjustmentCandidates.find(item => item.request === id), period = RF.period; if (!item) throw Error('Adjustment source changed.'); return workflowModal('Prepare separate payroll adjustment', `<p>${escape(item.employeeName || item.employee)} · ${escape(item.note)}</p><pre>${escape(JSON.stringify({ current: item.current, requested: item.requested }, null, 2))}</pre>${checked('checked', 'I verified the requested correction and unchanged unpaid breaks against source evidence.')}${modalActions('Propose for independent review')}`, form => { if (!form.has('checked')) throw Error('Verify source evidence first.'); return mutate('payroll-adjustment-propose', { period, record: item.record, clockIn: item.requested.clockIn, clockOut: item.requested.clockOut, breaks: item.current?.breaks || [], breaksConfirmed: true, reason: item.note }); }); }
    if (name === 'adjust-review') { const item = RF.company.adjustments.find(item => item.id === id); if (!item) throw Error('Adjustment changed.'); return workflowModal('Independently review adjustment', `<p>${escape(item.id)} · ${escape(item.minutesDelta)} minutes · £${(Number(item.grossPenceDelta) / 100).toFixed(2)}</p><pre>${escape(JSON.stringify(item.proposed, null, 2))}</pre><label>Decision<select name="decision"><option value="approve">Approve</option><option value="decline">Decline</option></select></label>${reason()}${checked('checked', 'I compared original released evidence and the proposed correction. I am not the proposer.')}${modalActions('Save independent decision')}`, form => mutate('payroll-adjustment-approve', { id, revision: item.revision, decision: String(form.get('decision')), reason: String(form.get('reason')), checked: form.has('checked') })); }
    if (name === 'adjust-release') { const period = RF.period; return workflowModal('Release separate adjustment CSV', checked('checked', 'I verified the adjustment totals and mapping. The original released file remains unchanged.') + modalActions('Release adjustment CSV'), form => mutate('payroll-adjustment-export', { period, checked: form.has('checked') })); }
    throw Error('Unknown Vector workflow action.');
  }
  globalThis.payrollReport = refresh;
  globalThis.payrollPageV4 = payrollPage;
  globalThis.issueDialog = resolve;
  globalThis.amendDialog = amend;
  const previousLogin = showLogin;
  showLogin = function (...args) {
    RF.epoch++; state.epoch++; state.owner = ''; state.receipt = null;
    LF.epoch++; LF.owner = ''; LF.bootstrap = null; LF.personal = null; LF.receipt = null;
    RF.report = null; RF.company = null; RF.team = '';
    document.getElementById('modal')?.close?.();
    return previousLogin.apply(this, args);
  };
  const previousRender = render;
  render = async function (...args) {
    if (!F.ready) return previousRender.apply(this, args);
    const epoch = ++state.epoch;
    clearOwner();
    if (actor()?.role === 'payroll_admin' && ui.page === 'overview') ui.page = 'payroll-run';
    const route = ui.page;
    try {
      if (['vector-weekly-signoff', 'payroll-run', 'payroll-intelligence'].includes(route)) {
        await globalThis.payrollReport();
        if (epoch !== state.epoch || route !== ui.page) return;
        const body = route === 'vector-weekly-signoff' ? weeklyPage() : globalThis.payrollPageV4();
        document.getElementById('root').innerHTML = shell(body); return;
      }
      if (route === 'leave') {
        await leaveRefresh();
        if (epoch !== state.epoch || route !== ui.page) return;
        document.getElementById('root').innerHTML = shell(leavePage()); return;
      }
      await previousRender.apply(this, args);
      if (epoch !== state.epoch || ui.page !== 'time-review' || !reviewer()) return;
      const content = document.querySelector('.content');
      if (content && !content.querySelector('[data-vector-weekly-entry]')) content.insertAdjacentHTML('afterbegin', `<div class="vw-toolbar" data-vector-weekly-entry><span>Finish the week after resolving attendance evidence.</span>${control('Weekly sign-off', 'weekly')}${permitted('payroll.view') ? control('Payroll preparation', 'payroll') : ''}</div>`);
    } catch (error) {
      if (error.status === 401) return showLogin();
      const root = document.getElementById('root');
      if (['vector-weekly-signoff', 'payroll-run', 'payroll-intelligence'].includes(route)) root.innerHTML = shell(`<section class="vw-panel" role="alert"><h1>Source review unavailable</h1><p>${escape(error.message)}</p>${control('Retry source read', route === 'vector-weekly-signoff' ? 'weekly' : 'payroll')}</section>`);
      else toast(error.message);
    }
  };
  document.addEventListener('click', async event => {
    const target = event.target.closest('[data-vector-workflow]');
    if (!target || target.disabled) return;
    event.preventDefault(); target.disabled = true;
    try { await action(target.dataset.vectorWorkflow, target.dataset.id); } catch (error) { toast(error.message); } finally { target.disabled = false; }
  });
  document.addEventListener('change', async event => {
    if (event.target.id === 'vw-outcome') {
      const work = event.target.value === 'worked', absence = !work && event.target.value !== 'off_rota';
      for (const [id, visible] of [['vw-work-fields', work], ['vw-absence-fields', absence]]) { const group = document.getElementById(id); if (group) { group.hidden = !visible; group.disabled = !visible; } }
    }
    if (event.target.id === 'vw-team') { RF.team = event.target.value; await render(); }
    if (event.target.id === 'vw-period') { RF.period = event.target.value; RF.report = null; RF.company = null; state.receipt = null; await render(); }
  });
  globalThis.VectorWorkflow = Object.freeze({ refresh, action, mutate, weeklyPage, payrollPage, leaveRefresh, leaveRequest, leaveDecision, leavePage, leaveState: () => ({ bootstrap: LF.bootstrap, personal: LF.personal, receipt: LF.receipt, busy: LF.busy }), state: () => ({ receipt: state.receipt, busy: state.busy }), marker: 'VECTOR_AUTHENTICATED_WORKFLOWS_V1' });
}());
