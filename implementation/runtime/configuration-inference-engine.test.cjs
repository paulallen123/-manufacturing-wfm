'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  inferOrganisationModel,
  buildMassEmployeeAssignments,
  inferShiftTemplates,
  inferBreakPolicy,
  inferOvertimePolicy,
  buildConfigurationProposal
} = require('./configuration-inference-engine.cjs');

function enterprisePeople(count = 5000) {
  const sites = ['Birmingham', 'Manchester', 'Leeds', 'Derby'];
  const departments = ['Production', 'Maintenance', 'Quality', 'Warehouse'];
  const jobs = ['Operator', 'Technician', 'Quality Inspector', 'Team Leader'];
  const people = [];

  for (let i = 0; i < count; i++) {
    const site = sites[i % sites.length];
    const department = departments[i % departments.length];
    const jobTitle = jobs[i % jobs.length];
    people.push({
      employeeId: 'E-' + String(i + 1).padStart(6, '0'),
      location: site,
      department,
      jobTitle,
      employmentType: i % 8 === 0 ? 'Part-time' : 'Full-time',
      managerId: null
    });
  }

  // Give each non-leader a valid local manager without requiring individual manual configuration.
  const leaders = new Map();
  for (const person of people) {
    if (/Team Leader/.test(person.jobTitle)) {
      leaders.set(person.location + '|' + person.department, person.employeeId);
    }
  }
  for (const person of people) {
    if (!/Team Leader/.test(person.jobTitle)) {
      person.managerId = leaders.get(person.location + '|' + person.department) || null;
    }
  }
  return people;
}

test('mass assignment configures thousands of employees into cohorts without per-person setup', () => {
  const people = enterprisePeople(5000);
  const result = buildMassEmployeeAssignments(people);

  assert.equal(result.assignments.length, 5000);
  assert.equal(result.coverage, 1);
  assert.equal(result.exceptions.length, 0);
  assert.equal(result.autoApply, true);
  assert.ok(result.cohorts.length < 100, 'cohort count should remain operationally manageable');
  assert.equal(result.assignments.some(item => item.role === 'manager'), true);
});

test('organisation inference refuses to hide duplicate or orphan manager data', () => {
  const people = enterprisePeople(100);
  people.push({ ...people[0] });
  people[1].managerId = 'DOES-NOT-EXIST';

  const result = inferOrganisationModel(people);
  assert.equal(result.autoApply, false);
  assert.ok(result.duplicateEmployeeIds.length >= 1);
  assert.ok(result.orphanManagers.length >= 1);
  assert.equal(result.status, 'EXCEPTION');
});

test('shift templates are inferred from repeated historical punches across sites', () => {
  const punches = [];
  for (let i = 0; i < 80; i++) {
    punches.push({
      employeeId: 'D-' + i,
      location: 'Birmingham',
      clockIn: i % 2 ? '05:58' : '06:04',
      clockOut: i % 2 ? '14:01' : '13:57'
    });
  }
  for (let i = 0; i < 60; i++) {
    punches.push({
      employeeId: 'N-' + i,
      location: 'Birmingham',
      clockIn: i % 2 ? '21:58' : '22:03',
      clockOut: i % 2 ? '06:02' : '05:57'
    });
  }

  const result = inferShiftTemplates(punches);
  assert.equal(result.status, 'PROPOSED');
  assert.equal(result.representedCoverage, 1);
  assert.ok(result.templates.some(item => item.start === '06:00' && item.end === '14:00'));
  assert.ok(result.templates.some(item => item.start === '22:00' && item.end === '06:00'));
});

test('stable break patterns can be proposed while ambiguous patterns remain customer decisions', () => {
  const timecards = [];
  for (let i = 0; i < 60; i++) {
    timecards.push({ workedHours: 8, breakMinutes: 30, regularHours: 8, overtimeHours: 0 });
  }
  for (let i = 0; i < 20; i++) {
    timecards.push({ workedHours: 10, breakMinutes: i % 2 ? 30 : 45, regularHours: 8, overtimeHours: 2 });
  }

  const result = inferBreakPolicy(timecards);
  const standard = result.rules.find(item => item.band === '6_TO_9H');
  const long = result.rules.find(item => item.band === '9H_PLUS');
  assert.equal(standard.autoApply, true);
  assert.equal(standard.requiresDecision, false);
  assert.equal(long.requiresDecision, true);
  assert.equal(long.autoApply, false);
});

test('payroll-sensitive overtime inference is never silently auto-applied even at perfect consistency', () => {
  const cards = [];
  for (let i = 0; i < 200; i++) {
    cards.push({ workedHours: 42, regularHours: 40, overtimeHours: 2, breakMinutes: 30 });
  }

  const result = inferOvertimePolicy(cards);
  assert.equal(result.thresholdHours, 40);
  assert.equal(result.confidence, 1);
  assert.equal(result.status, 'PROPOSED');
  assert.equal(result.autoApply, false);
  assert.equal(result.requiresHistoricalReplay, true);
  assert.equal(result.requiresDecision, false);
});

test('one proposal combines structure, mass onboarding, schedules and policy exceptions', () => {
  const people = enterprisePeople(1000);
  const punches = [];
  const timecards = [];

  for (let i = 0; i < 1000; i++) {
    punches.push({
      employeeId: people[i].employeeId,
      location: people[i].location,
      clockIn: i % 2 ? '06:02' : '05:59',
      clockOut: i % 2 ? '14:01' : '13:58'
    });
    timecards.push({
      workedHours: i % 10 === 0 ? 42 : 8,
      regularHours: i % 10 === 0 ? 40 : 8,
      overtimeHours: i % 10 === 0 ? 2 : 0,
      breakMinutes: 30
    });
  }

  const proposal = buildConfigurationProposal({ people, punches, timecards });
  assert.equal(proposal.metrics.people, 1000);
  assert.equal(proposal.metrics.massAssignmentCoverage, 1);
  assert.equal(proposal.metrics.shiftTemplateCoverage, 1);
  assert.equal(proposal.safety.payrollRulesAutoApplied, false);
  assert.ok(proposal.decisions.some(item => item.key === 'overtime-threshold'));
});

// PR501 regression, included in the existing image-admission suite.
const absentPopulations = [
  ['omitted', undefined],
  ['null', null],
  ['empty array', []],
  ['missing identity', [{ location: 'Synthetic site', department: 'Synthetic department' }]],
  ['blank identity', [{ employeeId: '   ', location: 'Synthetic site', department: 'Synthetic department' }]]
];

for (const [label, people] of absentPopulations) {
  test(`organisation inference reports zero people for ${label} source`, () => {
    const result = inferOrganisationModel(people);
    assert.equal(result.peopleCount, 0, label + ': a denominator guard must not invent a person');
    assert.deepEqual(result.sites, []);
  });

  test(`${label} workforce evidence cannot yield a confident automatic organisation proposal`, () => {
    const result = inferOrganisationModel(people);
    assert.equal(result.confidence, 0, label + ': no source observations means no confidence');
    assert.equal(result.autoApply, false, label + ': organisation review must remain required');
    assert.equal(result.status, 'EXCEPTION', label + ': use the existing exception contract');
  });

  test(`combined onboarding retains organisation review for ${label} source`, () => {
    const proposal = buildConfigurationProposal({ people });
    const decision = proposal.decisions.find(item => item.key === 'organisation-structure');
    assert.ok(decision, label + ': missing structure must reach the existing review queue');
    assert.equal(decision.reason, 'STRUCTURE_EXCEPTIONS');
    assert.equal(decision.detail.peopleCount, 0);
    assert.equal(decision.detail.autoApply, false);
    assert.equal(proposal.safety.payrollRulesAutoApplied, false);
  });
}

test('one evidenced synthetic employee retains existing proposed structure and source immutability', () => {
  const people = [{ employeeId: 'synthetic-1', managerId: null, location: 'Synthetic site',
    department: 'Synthetic department', jobTitle: 'Operator', employmentType: 'Full-time' }];
  const before = JSON.stringify(people);
  const result = inferOrganisationModel(people);
  assert.equal(result.peopleCount, 1);
  assert.equal(result.confidence, 1);
  assert.equal(result.autoApply, true);
  assert.equal(result.status, 'PROPOSED');
  assert.deepEqual(result.sites, [{ name: 'Synthetic site', departments: ['Synthetic department'] }]);
  const proposal = buildConfigurationProposal({ people });
  assert.equal(proposal.decisions.some(item => item.key === 'organisation-structure'), false);
  assert.equal(proposal.safety.payrollRulesAutoApplied, false);
  assert.equal(JSON.stringify(people), before);
});


for (const [label, people] of [
 ['missing structure', [{employeeId:'E1'}]],
 ['blank structure', [{employeeId:'E1',location:'  ',department:'  '}]],
 ['partial identity', [{employeeId:'E1',location:'S1',department:'D1'},{location:'S2',department:'D2'}]]
]) {
 test(`incomplete organisation evidence requires review: ${label}`, () => {
  const result=inferOrganisationModel(people);
  assert.equal(result.autoApply,false);
  assert.equal(result.status,'EXCEPTION');
  assert.ok(result.confidence<0.98);
  const proposal=buildConfigurationProposal({people});
  assert.ok(proposal.decisions.some(item=>item.key==='organisation-structure'));
 });
}

for (const field of ['employeeId','location','department']) {
 test(`object-valued ${field} requires review without coercion`,()=>{
  let coercions=0;
  const row={employeeId:'E1',location:'S1',department:'D1',[field]:{toString(){coercions++;return 'forged';}}};
  const result=buildConfigurationProposal({people:[row]});
  assert.equal(result.organisation.autoApply,false);
  assert.equal(result.workforce.autoApply,false);
  assert.ok(result.decisions.some(x=>x.key==='organisation-structure'));
  assert.equal(coercions,0);
 });
}
test('prototype, accessor, proxy and custom traversal workforce evidence is inert and requires review',()=>{
 let calls=0;
 const valid={employeeId:'E1',location:'S1',department:'D1'};
 const getter={...valid};Object.defineProperty(getter,'employeeId',{get(){calls++;return 'forged';}});
 const proxy=new Proxy(valid,{get(){calls++;throw Error('must not execute');},getOwnPropertyDescriptor(){calls++;throw Error('must not execute');}});
 const custom=[valid,{}];custom[Symbol.iterator]=function*(){calls++;yield valid;};custom.filter=()=>{calls++;return [valid,valid];};
 for(const people of [[Object.create(valid)],[getter],[proxy],custom,new Proxy([valid],{get(){calls++;throw Error('must not execute');}}),[null],Array(1)]) {
  const result=buildConfigurationProposal({people});
  assert.equal(result.organisation.autoApply,false);
  assert.equal(result.workforce.autoApply,false);
  assert.ok(result.decisions.some(x=>x.key==='organisation-structure'));
 }
 assert.equal(calls,0);
});
test('proposal people accessor is rejected without invocation',()=>{
 let calls=0;const input={get people(){calls++;return [{employeeId:'E1',location:'S1',department:'D1'}];}};
 const result=buildConfigurationProposal(input);
 assert.equal(result.organisation.autoApply,false);assert.equal(calls,0);
});
test('invalid workforce source preserves supplied row count but never partial assignments',()=>{
 const people=[{employeeId:'E1',location:'S',department:'D'},{employeeId:{},location:'S',department:'D'}];
 const structure=inferOrganisationModel(people),workforce=buildMassEmployeeAssignments(people);
 assert.equal(structure.sourceCount,2);assert.equal(structure.peopleCount,0);
 assert.equal(structure.invalidSource,true);assert.equal(structure.autoApply,false);
 assert.deepEqual(workforce.assignments,[]);assert.equal(workforce.autoApply,false);
 assert.equal(workforce.exceptions[0].reason,'INVALID_WORKFORCE_SOURCE');
});
test('frozen and null-prototype own-data people retain valid inference',()=>{
 const person=Object.assign(Object.create(null),{employeeId:'E1',location:'S',department:'D'});
 const people=Object.freeze([Object.freeze(person)]);
 const result=buildConfigurationProposal({people});
 assert.equal(result.organisation.autoApply,true);assert.equal(result.workforce.autoApply,true);
 assert.equal(result.workforce.assignments[0].employeeId,'E1');
});

test('ambient descriptor-map getters never become workforce evidence',()=>{
 let calls=0;const results=[];
 for(const key of ['people','employeeId','location','department','managerId','email','firstName','punches','timecards']) {
  const row={employeeId:'E1',location:'S',department:'D'};delete row[key];
  const descriptor={configurable:true,get(){calls++;return {value:key==='people'?[row]:'forged'};}};
  Object.defineProperty(Object.prototype,key,descriptor);
  try { results.push([key,buildConfigurationProposal(key==='people'?{}:{people:[row]})]); }
  finally { delete Object.prototype[key]; }
 }
 assert.equal(calls,0);
 for(const [key,result] of results) if(['people','employeeId','location','department'].includes(key)) assert.equal(result.organisation.autoApply,false,key);
});
for(const field of ['employeeId','managerId','location','department','wfmRole','jobTitle','employmentType','email','firstName']) {
 test(`numeric ${field} retains primitive inference behavior`,()=>{
  const row={employeeId:'42',location:'S',department:'D',[field]:42};
  const result=buildConfigurationProposal({people:[row]});
  assert.equal(result.organisation.autoApply,true);assert.equal(result.workforce.autoApply,true);
 });
}
test('unused diagnostic fields cannot invalidate valid workforce evidence',()=>{
 let calls=0;const row={employeeId:'E1',location:'S',department:'D',email:{toString(){calls++;throw Error('unused');}}};
 Object.defineProperty(row,'firstName',{get(){calls++;throw Error('unused');}});
 const result=buildConfigurationProposal({people:[row]});
 assert.equal(result.organisation.autoApply,true);assert.equal(result.workforce.autoApply,true);assert.equal(calls,0);
});
test('100001 valid people have no newly invented capacity rejection',()=>{
 const people=Array.from({length:100001},(_,i)=>({employeeId:`E${i}`,location:'S',department:'D'}));
 const result=buildConfigurationProposal({people});
 assert.equal(result.organisation.autoApply,true);assert.equal(result.workforce.autoApply,true);
 assert.equal(result.workforce.assignments.length,100001);
});
