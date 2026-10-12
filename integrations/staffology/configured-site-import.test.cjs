'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Bridge = require('./canonical-runtime-bridge.cjs');

const AUTHORITY = 'STAFFOLOGY_CONFIGURED_SITE_AUTHORITY_REQUIRED';
const BINDING = 'STAFFOLOGY_CONFIGURED_SITE_BINDING_MISMATCH';
const MAPPING = 'STAFFOLOGY_EMPLOYEE_MAPPING_REQUIRED';
const DENIED = 'STAFFOLOGY_WRITE_NOT_AUTHORIZED';
const tenant = 'configured-site-tenant';
const binding = () => ({tenant, runId: 'run-001', configurationDigest: 'a'.repeat(64), scopeChangeEventId: 17});
const mapping = () => ({externalId: 'employee-001', payrollId: 'PAY001', managerId: 'manager-001', site: 'Exact configured site', job: 'Operator', contractType: 'full_time', weeklyHours: 37.5});
const acquisition = () => ({objectType: 'people', cursor: 'pageNum:0', sourceVersion: 'source-001', paginationComplete: true, atomicProviderSnapshot: false, records: [{externalId: 'employee-001', revision: 'revision-001', operation: 'upsert', data: {identity: {employeeId: 'employee-001', payrollCode: 'PAY001'}, person: {firstName: 'Test', lastName: 'Worker', email: 'worker@example.invalid'}, employment: {status: 'Current', effectiveFrom: '2026-09-15'}}}]});

function fixture(overrides = {}) {
  const f = {
    state: {staff: [], org: [{id: 'manager-001', name: 'Manager'}], workRules: {jobs: [{name: 'Operator'}], contracts: {standard: [{type: 'full_time', weeklyHours: 37.5}]}}},
    actor: {tenant, permissions: ['company.configure']},
    context: {...binding(), applied: true},
    authority: {...binding(), siteLabels: ['Exact configured site']},
    calls: {context: 0, sites: 0, stagingGuard: 0, staged: []}
  };
  const dependencies = {
    loadState: requested => { assert.equal(requested, tenant); return f.state; },
    configurationContextForTenant: request => {
      assert.deepEqual(request, {tenant}); f.calls.context++;
      return f.context === null ? null : Object.freeze({...f.context});
    },
    configuredSitesForTenant: request => {
      assert.deepEqual(request, {tenant}); f.calls.sites++;
      return f.authority === null ? null : Object.freeze({...f.authority, siteLabels: Array.isArray(f.authority.siteLabels) ? Object.freeze([...f.authority.siteLabels]) : f.authority.siteLabels});
    },
    assertStagePeople: () => { f.calls.stagingGuard++; },
    stagePeople: (actor, envelope, receipt) => {
      f.calls.staged.push({actor, envelope, receipt});
      return {id: `stage-${f.calls.staged.length}`, status: 'staged'};
    },
    ...overrides
  };
  f.runtime = Bridge.createRuntime(dependencies);
  f.preview = () => f.runtime.employeeMappingOptions(f.actor);
  f.validate = (reviewed = binding(), rows = [mapping()]) => f.runtime.assertEmployeeMappings(f.actor, rows, reviewed);
  f.stage = (reviewed = binding(), receipt = {approved: true, idempotencyKey: 'configured-site-import', mappings: [mapping()]}, source = acquisition()) => f.runtime.stageEmployeeAcquisition(f.actor, source, receipt, reviewed);
  return f;
}

function blocked(f, code) {
  assert.throws(() => f.preview(), {code});
  assert.throws(() => f.validate(), {code});
  assert.throws(() => f.stage(), {code});
  assert.equal(f.calls.staged.length, 0);
  assert.deepEqual(f.state.staff, []);
}

test('first employee can preview, validate and stage the exact configured site with staff empty', () => {
  const f = fixture(), before = structuredClone(f.state), preview = f.preview();
  assert.deepEqual(preview, {managers: [{id: 'manager-001', name: 'Manager'}], sites: ['Exact configured site'], configurationBinding: binding(), jobs: ['Operator'], contractTypes: ['full_time'], weeklyHours: ['37.5']});
  assert.equal(f.calls.context, 2); assert.equal(f.calls.sites, 1);
  assert.deepEqual(f.state, before);
  assert.equal(f.validate(preview.configurationBinding), true);
  assert.equal(f.stage(preview.configurationBinding).status, 'staged');
  assert.equal(f.calls.context, 6); assert.equal(f.calls.sites, 3);
  assert.equal(f.calls.stagingGuard, 1);
  assert.equal(f.calls.staged[0].envelope.records[0].data.site, 'Exact configured site');
  assert.deepEqual(f.state, before);
});

test('configured sites are authoritative even when staff contains other site labels', () => {
  const f = fixture(); f.state.staff.push({site: 'staff-only-site'});
  assert.deepEqual(f.preview().sites, ['Exact configured site']);
  assert.throws(() => f.validate(binding(), [{...mapping(), site: 'staff-only-site'}]), {code: MAPPING});
});

for (const key of ['configuredSitesForTenant', 'configurationContextForTenant']) {
  for (const value of [null, undefined, {}, 'request-callback']) {
    test(`explicit ${key} ${String(value)} fails closed`, () => blocked(fixture({[key]: value}), AUTHORITY));
  }
  test(`${key} callback failure cannot stage`, () => {
    const f = fixture({[key]: () => { throw Error('Authority unavailable'); }});
    assert.throws(() => f.stage(), /Authority unavailable/);
    assert.equal(f.calls.staged.length, 0);
  });
  test(`${key} asynchronous result is not synchronous authority`, () => blocked(fixture({[key]: () => Promise.resolve({...binding(), applied: true, siteLabels: ['Exact configured site']})}), AUTHORITY));
}

test('one missing constructor callback never falls back to staff-derived sites', () => {
  for (const present of ['configuredSitesForTenant', 'configurationContextForTenant']) {
    const runtime = Bridge.createRuntime({loadState: () => ({staff: [{site: 'Exact configured site'}]}), [present]: () => ({...binding(), applied: true, siteLabels: ['Exact configured site']})});
    assert.throws(() => runtime.employeeMappingOptions({tenant, permissions: ['company.configure']}), {code: AUTHORITY});
  }
});

for (const source of ['context', 'authority']) {
  test(`null ${source} fails closed`, () => { const f = fixture(); f[source] = null; blocked(f, AUTHORITY); });
  for (const field of ['tenant', 'runId', 'configurationDigest', 'scopeChangeEventId']) {
    test(`missing ${source}.${field} fails closed`, () => { const f = fixture(); delete f[source][field]; blocked(f, AUTHORITY); });
  }
  for (const event of [-1, 1.5, '17', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    test(`invalid ${source} event ${String(event)} fails closed`, () => { const f = fixture(); f[source].scopeChangeEventId = event; blocked(f, AUTHORITY); });
  }
}

for (const applied of [false, undefined, 'true', 1]) {
  test(`context applied=${String(applied)} is not applied authority`, () => { const f = fixture(); f.context.applied = applied; blocked(f, AUTHORITY); });
}

test('foreign expected tenant is rejected even when both trusted snapshots agree', () => {
  const f = fixture(); f.context.tenant = f.authority.tenant = 'foreign-tenant'; blocked(f, AUTHORITY);
});

for (const [field, value] of [['tenant', 'foreign-tenant'], ['runId', 'foreign-run'], ['configurationDigest', 'b'.repeat(64)], ['scopeChangeEventId', 18]]) {
  test(`configured-site ${field} mismatch fails closed`, () => { const f = fixture(); f.authority[field] = value; blocked(f, BINDING); });
  test(`reviewed ${field} mismatch cannot validate or stage`, () => {
    const f = fixture(), reviewed = {...binding(), [field]: value};
    assert.throws(() => f.validate(reviewed), {code: BINDING});
    assert.throws(() => f.stage(reviewed), {code: BINDING});
    assert.equal(f.calls.staged.length, 0);
  });
  test(`current ${field} change after preview rejects old binding`, () => {
    const f = fixture(), reviewed = f.preview().configurationBinding;
    f.context[field] = f.authority[field] = value;
    const code = field === 'tenant' ? AUTHORITY : BINDING;
    assert.throws(() => f.validate(reviewed), {code});
    assert.throws(() => f.stage(reviewed), {code});
    assert.equal(f.calls.staged.length, 0);
  });
}

test('same-label/same-digest newer scope event invalidates preview and permits a fresh preview', () => {
  const f = fixture(), old = f.preview();
  f.context.scopeChangeEventId++; f.authority.scopeChangeEventId++;
  assert.throws(() => f.stage(old.configurationBinding), {code: BINDING});
  const current = f.preview();
  assert.deepEqual(current.sites, old.sites);
  assert.equal(current.configurationBinding.configurationDigest, old.configurationBinding.configurationDigest);
  assert.notEqual(current.configurationBinding.scopeChangeEventId, old.configurationBinding.scopeChangeEventId);
  assert.equal(f.stage(current.configurationBinding).status, 'staged');
});

test('authority is re-read after mapping validation and immediately before staging', () => {
  const f = fixture(), reviewed = f.preview().configurationBinding;
  f.validate(reviewed); f.context.applied = false;
  assert.throws(() => f.stage(reviewed), {code: AUTHORITY});
  assert.equal(f.calls.staged.length, 0);
});

test('a configuration change in the connector guard is caught before staging', () => {
  let f;
  f = fixture({assertStagePeople: () => { f.context.scopeChangeEventId++; f.authority.scopeChangeEventId++; }});
  assert.throws(() => f.stage(), {code: BINDING});
  assert.equal(f.calls.staged.length, 0);
});

for (const labels of [undefined, null, 'Exact configured site', [], [''], [' Exact configured site'], ['Exact configured site '], ['bad\nlabel'], ['bad\u007flabel'], [123], [null], [{name: 'Exact configured site'}], ['Exact configured site', 'Exact configured site'], ['Exact configured site', ' Exact configured site'], Array(1)]) {
  test(`invalid or ambiguous site labels ${JSON.stringify(labels)} fail closed`, () => { const f = fixture(); f.authority.siteLabels = labels; blocked(f, AUTHORITY); });
}

test('exact labels retain case, internal whitespace, order and full length without site-code invention', () => {
  const f = fixture(), labels = ['Zulu  Works', 'alpha Works', 'S'.repeat(121)];
  f.authority.siteLabels = labels;
  const preview = f.preview();
  assert.deepEqual(preview.sites, labels);
  for (const site of labels) assert.equal(f.validate(preview.configurationBinding, [{...mapping(), site}]), true);
  for (const site of ['Zulu Works', 'zulu  Works', 'S'.repeat(120), 'SITE-001', {toString: () => labels[0]}]) {
    assert.throws(() => f.validate(preview.configurationBinding, [{...mapping(), site}]), {code: MAPPING});
  }
});

test('returned binding and labels are frozen copies, not retained authority references', () => {
  const f = fixture(), preview = f.preview();
  assert.equal(Object.isFrozen(preview.configurationBinding), true);
  assert.equal(Object.isFrozen(preview.sites), true);
  assert.throws(() => { preview.sites.push('caller-site'); }, TypeError);
  assert.throws(() => { preview.configurationBinding.runId = 'caller-run'; }, TypeError);
  f.authority.siteLabels[0] = 'Changed site';
  assert.deepEqual(preview.sites, ['Exact configured site']);
  assert.throws(() => f.validate(preview.configurationBinding), {code: MAPPING});
  assert.deepEqual(f.preview().sites, ['Changed site']);
});

test('request fields cannot supply missing authority or reviewed binding', () => {
  const f = fixture(), fake = {...binding(), siteLabels: ['caller-site']};
  f.actor.configurationContextForTenant = () => ({...fake, applied: true});
  f.actor.configuredSitesForTenant = () => fake;
  const receipt = {approved: true, mappings: [mapping()], configurationBinding: binding(), configuredSites: fake, configurationContext: {...fake, applied: true}};
  assert.throws(() => f.runtime.assertEmployeeMappings(f.actor, [mapping()]), {code: BINDING});
  assert.throws(() => f.runtime.stageEmployeeAcquisition(f.actor, acquisition(), receipt), {code: BINDING});
  f.authority = null;
  assert.throws(() => f.runtime.stageEmployeeAcquisition(f.actor, acquisition(), receipt, binding()), {code: AUTHORITY});
  assert.equal(f.calls.staged.length, 0);
});

for (const value of [null, {}, [], true]) {
  test(`missing or malformed reviewed comparison ${JSON.stringify(value)} fails closed`, () => {
    const f = fixture();
    assert.throws(() => f.validate(value), {code: BINDING});
    assert.throws(() => f.stage(value), {code: BINDING});
    assert.equal(f.calls.staged.length, 0);
  });
}

for (const [field, value] of [['managerId', 'unknown-manager'], ['job', 'Unknown job'], ['contractType', 'unknown-contract'], ['weeklyHours', 40], ['email', 'invalid-email'], ['email', 'other@example.invalid'], ['site', 'Unknown site']]) {
  test(`existing employee ${field} guard remains enforced`, () => {
    const f = fixture(), receipt = {approved: true, mappings: [{...mapping(), [field]: value}]};
    assert.throws(() => f.stage(binding(), receipt), {code: MAPPING});
    assert.equal(f.calls.staged.length, 0);
  });
}

test('permission and connector guards remain enforced', () => {
  const f = fixture(); f.actor.permissions = [];
  blocked(f, DENIED);
  assert.equal(f.calls.context, 0); assert.equal(f.calls.sites, 0);
  const guarded = fixture({assertStagePeople: () => { const error = Error('Connector denied'); error.code = 'STAFFOLOGY_EMPLOYEE_CONNECTOR_MISMATCH'; throw error; }});
  assert.throws(() => guarded.stage(), {code: 'STAFFOLOGY_EMPLOYEE_CONNECTOR_MISMATCH'});
  assert.equal(guarded.calls.staged.length, 0);
});

for (const mutate of [r => { r.approved = false; }, r => { r.mappings[0].payrollId = 'OTHER'; }, r => { r.mappings[0].externalId = 'foreign-employee'; }, r => { r.mappings.push({...r.mappings[0]}); }]) {
  test('provider cohort, payroll identity and review guards remain enforced', () => {
    const f = fixture(), receipt = {approved: true, mappings: [mapping()]}; mutate(receipt);
    assert.throws(() => f.stage(binding(), receipt), {code: MAPPING});
    assert.equal(f.calls.staged.length, 0);
  });
}

test('incomplete provider acquisition remains blocked', () => {
  const f = fixture(), source = acquisition(); source.paginationComplete = false;
  assert.throws(() => f.stage(binding(), undefined, source), {code: 'STAFFOLOGY_CANONICAL_INTEGRATION_BLOCKED'});
  assert.equal(f.calls.staged.length, 0);
});

test('mixed Current/Former lifecycle stages revalidate each separate effect', () => {
  let f, calls = 0;
  f = fixture({stagePeople: (_actor, envelope) => {
    calls++;
    if (calls === 1) {
      assert.throws(() => Bridge.assertPeopleApplicationRecord(envelope.records[1]), {code: 'STAFFOLOGY_EMPLOYEE_LIFECYCLE_REQUIRED'});
      f.context.scopeChangeEventId++; f.authority.scopeChangeEventId++;
    }
    return {id: `stage-${calls}`, status: 'review_required'};
  }});
  const source = acquisition(), former = structuredClone(source.records[0]);
  former.externalId = former.data.identity.employeeId = 'former-001';
  former.data.identity.payrollCode = 'PAY002'; former.data.employment.status = 'Former'; former.data.employment.effectiveTo = '2026-09-01';
  source.records.push(former);
  const receipt = {approved: true, idempotencyKey: 'mixed-lifecycle', mappings: [mapping(), {...mapping(), externalId: 'former-001', payrollId: 'PAY002'}]};
  assert.throws(() => f.stage(binding(), receipt, source), {code: BINDING});
  assert.equal(calls, 1);
});

test('legacy assembly without either callback retains its existing staff-only behavior', () => {
  const f = fixture(), runtime = Bridge.createRuntime({loadState: () => f.state});
  assert.deepEqual(runtime.employeeMappingOptions(f.actor).sites, []);
  assert.throws(() => runtime.assertEmployeeMappings(f.actor, [mapping()]), {code: MAPPING});
  f.state.staff.push({site: 'Exact configured site'});
  assert.equal(runtime.assertEmployeeMappings(f.actor, [mapping()]), true);
  assert.equal(runtime.employeeMappingOptions(f.actor).configurationBinding, undefined);
});

for (const changeDuringAcquisition of [false, true]) {
  test(`canonical acquisition with a server-held preview ${changeDuringAcquisition ? 'rejects a scope event during await' : 'stages the first employee'}`, async () => {
    const Operations = require('./canonical-operations.cjs');
    const f = fixture(), reviewed = f.preview().configurationBinding;
    const actor = {...f.actor, email: 'director@example.invalid', permissions: ['company.configure', 'payroll.export']};
    const profile = {binding: {tenant, employerId: 'employer-001'}, connector: {id: 'staffology-people', scope: 'reviewed-people'}, provider: {apiKey: 'OFFLINE-SYNTHETIC-ONLY', timeoutMs: 1000}, cohort: ['employee-001'], pageSize: 10, maxPages: 2};
    let providerCalls = 0;
    // Fixture for the parent's future receipt retrieval seam; this closure is
    // server-held. A request-supplied binding is never used as an authority.
    const runtime = {
      assertEmployeeStaging: (a, receipt) => f.runtime.assertEmployeeStaging(a, receipt),
      assertEmployeeMappings: (a, rows) => f.runtime.assertEmployeeMappings(a, rows, reviewed),
      stageEmployeeAcquisition: (a, source, receipt) => f.runtime.stageEmployeeAcquisition(a, source, receipt, reviewed)
    };
    const operations = Operations.createOperations({runtime, profile, boundaries: {approvedCoordinator() {}, assertCurrentPrincipal() {}}, client: async (url, options) => {
      assert.equal(options.method, 'GET'); providerCalls++;
      await Promise.resolve();
      if (changeDuringAcquisition && providerCalls === 1) { f.context.scopeChangeEventId++; f.authority.scopeChangeEventId++; }
      const response = new URL(url).pathname.endsWith('/employees') ? [{id: 'employee-001'}] : {id: 'employee-001', status: 'Current', personalDetails: {firstName: 'Test', lastName: 'Worker', email: 'worker@example.invalid'}, employmentDetails: {payrollCode: 'PAY001', starterDetails: {startDate: '2026-09-15'}, leaverDetails: {hasLeft: false}}};
      return new Response(JSON.stringify(response), {status: 200});
    }});
    const result = operations.acquireAndStage(actor, {reviewed: true, employeeIds: profile.cohort, mappings: [mapping()], connectorId: profile.connector.id, idempotencyKey: 'configured-acquisition'});
    if (changeDuringAcquisition) { await assert.rejects(result, {code: BINDING}); assert.equal(f.calls.staged.length, 0); }
    else { assert.equal((await result).status, 'staged'); assert.equal(f.calls.staged.length, 1); }
    assert.equal(providerCalls, 2);
    assert.deepEqual(f.state.staff, []);
  });
}

for (const [field, value] of [['tenant', 'foreign-tenant'], ['runId', 'run-002'], ['configurationDigest', 'b'.repeat(64)], ['scopeChangeEventId', 18]]) {
  test(`review boundary: site callback advancing ${field} cannot return old authority`, () => {
    for (const operation of ['preview', 'validate', 'stage']) {
      let f;
      const reads = [];
      f = fixture({
        configurationContextForTenant: request => {
          assert.deepEqual(request, {tenant}); reads.push('context');
          return Object.freeze({...f.context});
        },
        configuredSitesForTenant: request => {
          assert.deepEqual(request, {tenant}); reads.push('sites');
          const old = Object.freeze({...f.authority, siteLabels: Object.freeze([...f.authority.siteLabels])});
          f.context[field] = value;
          return old;
        }
      });
      assert.throws(() => f[operation](), {code: field === 'tenant' ? AUTHORITY : BINDING}, operation);
      assert.deepEqual(reads, ['context', 'sites', 'context']);
      assert.equal(f.calls.staged.length, 0);
      assert.deepEqual(f.state.staff, []);
    }
  });
}

for (const next of [null, {...binding(), applied: false}, {...binding(), applied: true, scopeChangeEventId: null}]) {
  test(`review boundary: post-snapshot context ${JSON.stringify(next)} fails closed`, () => {
    for (const operation of ['preview', 'validate', 'stage']) {
      let reads = 0;
      const f = fixture({configurationContextForTenant: () => ++reads === 1 ? Object.freeze({...binding(), applied: true}) : next});
      assert.throws(() => f[operation](), {code: AUTHORITY}, operation);
      assert.equal(reads, 2);
      assert.equal(f.calls.staged.length, 0);
    }
  });
}

for (const inherited of [['configuredSitesForTenant'], ['configurationContextForTenant'], ['configuredSitesForTenant', 'configurationContextForTenant']]) {
  test(`review boundary: inherited ${inherited.join(' and ')} configuration is rejected`, () => {
    const f = fixture(); f.state.staff.push({site: 'Exact configured site'});
    const callbacks = {configuredSitesForTenant: () => f.authority, configurationContextForTenant: () => f.context};
    const prototype = Object.fromEntries(inherited.map(key => [key, callbacks[key]]));
    const options = Object.assign(Object.create(prototype), {loadState: () => f.state});
    // The staff site deliberately makes the old, silently selected legacy lane usable.
    assert.throws(() => Bridge.createRuntime(options), {code: AUTHORITY});
    for (const key of Object.keys(callbacks).filter(key => !inherited.includes(key))) options[key] = callbacks[key];
    assert.throws(() => Bridge.createRuntime(options), {code: AUTHORITY});
  });
}

test('review boundary: inherited callback getters are rejected without evaluating them', () => {
  let accessed = false;
  const prototype = Object.defineProperty({}, 'configuredSitesForTenant', {get() { accessed = true; return () => null; }});
  assert.throws(() => Bridge.createRuntime(Object.assign(Object.create(prototype), {loadState: () => ({staff: []})})), {code: AUTHORITY});
  assert.equal(accessed, false);
});

test('own callback configuration remains usable when it shadows prototype callback properties', () => {
  const f = fixture();
  const options = Object.assign(Object.create({configuredSitesForTenant: () => { throw Error('Inherited callback must not run'); }}), {
    loadState: () => f.state,
    configuredSitesForTenant: () => Object.freeze({...f.authority, siteLabels: Object.freeze([...f.authority.siteLabels])}),
    configurationContextForTenant: () => Object.freeze({...f.context})
  });
  assert.deepEqual(Bridge.createRuntime(options).employeeMappingOptions(f.actor).sites, ['Exact configured site']);
});

test('review boundary: alternating mapping site getter cannot stage an unconfigured label', t => {
  const f = fixture(), row = mapping(); let siteReads = 0, failure;
  Object.defineProperty(row, 'site', {enumerable: true, get() { return ++siteReads === 1 ? 'Unconfigured site' : 'Exact configured site'; }});
  try { f.stage(binding(), {approved: true, mappings: [row]}); } catch (error) { failure = error; }
  t.diagnostic(JSON.stringify({siteReads, stagedSites: f.calls.staged.map(call => call.envelope.records[0].data.site)}));
  assert.equal(failure?.code, MAPPING);
  assert.equal(siteReads, 0);
  assert.equal(f.calls.staged.length, 0);
});

test('review boundary: receipt accessors are rejected before any envelope construction', () => {
  const f = fixture(), receipt = {approved: true}; let mappingReads = 0, acquisitionReads = 0;
  Object.defineProperty(receipt, 'mappings', {enumerable: true, get() { mappingReads++; return [mapping()]; }});
  const source = Object.defineProperty({}, 'objectType', {get() { acquisitionReads++; return 'people'; }});
  assert.throws(() => f.stage(binding(), receipt, source), {code: MAPPING});
  assert.equal(mappingReads, 0); assert.equal(acquisitionReads, 0);
  assert.equal(f.calls.staged.length, 0);
});

test('review boundary: nonplain and inherited mapping data cannot cross configured staging', () => {
  class Mapping { constructor() { Object.assign(this, mapping()); } }
  for (const row of [new Mapping(), Object.assign(Object.create({site: 'Exact configured site'}), {...mapping(), site: undefined})]) {
    if (!(row instanceof Mapping)) delete row.site;
    const f = fixture();
    assert.throws(() => f.stage(binding(), {approved: true, mappings: [row]}), {code: MAPPING});
    assert.equal(f.calls.staged.length, 0);
  }
});

for (const key of ['configuredSitesForTenant', 'configurationContextForTenant']) {
  test(`review boundary: self-deleting constructor ${key} accessor cannot erase opt-in`, () => {
    let reads = 0;
    const options = {loadState: () => ({staff: [{site: 'Exact configured site'}]})};
    Object.defineProperty(options, key, {configurable: true, enumerable: true, get() { reads++; delete options[key]; return () => null; }});
    assert.throws(() => Bridge.createRuntime(options), {code: AUTHORITY});
    assert.equal(reads, 0);
    assert.equal(Object.hasOwn(options, key), true);
  });
}

for (const operation of ['validate', 'stage']) {
  test(`review boundary: callback mutation cannot repair an initially unconfigured mapping during ${operation}`, t => {
    const row = {...mapping(), site: 'Unconfigured site'}; let f, failure;
    f = fixture({configuredSitesForTenant: () => {
      row.site = 'Exact configured site';
      return Object.freeze({...f.authority, siteLabels: Object.freeze([...f.authority.siteLabels])});
    }});
    try {
      if (operation === 'validate') f.validate(binding(), [row]);
      else f.stage(binding(), {approved: true, mappings: [row]});
    } catch (error) { failure = error; }
    t.diagnostic(JSON.stringify({operation, stagedSites: f.calls.staged.map(call => call.envelope.records[0].data.site)}));
    assert.equal(failure?.code, MAPPING);
    assert.equal(f.calls.staged.length, 0);
  });
}

test('plain JSON receipt is snapshotted before callbacks and shared unchanged with the envelope', () => {
  const row = {...mapping(), skills: ['Exact skill']}, receipt = {approved: true, mappings: [row]}; let f;
  f = fixture({configuredSitesForTenant: () => {
    row.site = 'Unconfigured site'; row.skills.push('Later mutation');
    return Object.freeze({...f.authority, siteLabels: Object.freeze([...f.authority.siteLabels])});
  }});
  assert.equal(f.stage(binding(), receipt).status, 'staged');
  const staged = f.calls.staged[0];
  assert.equal(staged.envelope.records[0].data.site, 'Exact configured site');
  assert.equal(staged.envelope.records[0].data.skills, 'Exact skill');
  assert.equal(staged.receipt.mappings[0].site, staged.envelope.records[0].data.site);
  assert.notEqual(staged.receipt, receipt);
  for (const value of [staged.receipt, staged.receipt.mappings, staged.receipt.mappings[0], staged.receipt.mappings[0].skills]) assert.equal(Object.isFrozen(value), true);
});

test('configured receipt snapshot rejects nested accessors, cyclic and sparse data before callbacks', () => {
  let accessorReads = 0;
  const skills = Object.defineProperty([], '0', {enumerable: true, get() { accessorReads++; return 'Skill'; }});
  const cyclic = {approved: true, mappings: [mapping()]}; cyclic.extra = cyclic;
  for (const receipt of [{approved: true, mappings: [{...mapping(), skills}]}, {approved: true, mappings: Array(1)}, cyclic]) {
    const f = fixture();
    assert.throws(() => f.stage(binding(), receipt), {code: MAPPING});
    assert.equal(f.calls.context, 0); assert.equal(f.calls.sites, 0);
    assert.equal(f.calls.staged.length, 0);
  }
  assert.equal(accessorReads, 0);
});

test('mixed lifecycle stages share the same immutable mapping snapshot', () => {
  const f = fixture(), source = acquisition(), former = structuredClone(source.records[0]);
  former.externalId = former.data.identity.employeeId = 'former-001'; former.data.identity.payrollCode = 'PAY002';
  former.data.employment.status = 'Former'; former.data.employment.effectiveTo = '2026-09-01'; source.records.push(former);
  const receipt = {approved: true, idempotencyKey: 'immutable-mixed', mappings: [mapping(), {...mapping(), externalId: 'former-001', payrollId: 'PAY002'}]};
  f.stage(binding(), receipt, source);
  assert.equal(f.calls.staged.length, 2);
  for (const staged of f.calls.staged) {
    assert.equal(Object.isFrozen(staged.receipt), true);
    assert.equal(Object.isFrozen(staged.receipt.mappings), true);
    assert.notEqual(staged.receipt.mappings, receipt.mappings);
  }
  assert.equal(f.calls.staged[0].receipt.mappings, f.calls.staged[1].receipt.mappings);
});
