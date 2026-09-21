'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { createTenantEnvironmentProvisioner } = require('./tenant-environment-provisioner.cjs');

test('scope submission provisions an isolated persisted tenant environment idempotently', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-tenant-env-'));
  const dbPath = path.join(root, 'wfm.sqlite');
  const provisioner = createTenantEnvironmentProvisioner({ dbPath });

  try {
    const scope = {
      companyName: 'Alpha Manufacturing',
      employeeCount: 10000,
      countries: ['United Kingdom', 'Germany'],
      sites: ['Tamworth', 'Berlin'],
      sourceSystems: ['HCM', 'Payroll'],
      features: ['Scheduling', 'Time & attendance'],
      workPatterns: ['24/7 rotating shifts'],
      clockingMethods: ['Access control'],
      payrollSystem: 'Payroll',
      hcmSystem: 'HCM',
      erpSystem: 'ERP',
      agencyLabour: true,
      priorities: 'Accurate payroll',
      notes: ''
    };

    const first = provisioner.provision({ tenant: 'alpha', runId: 'run-1', scope });
    const second = provisioner.provision({ tenant: 'alpha', runId: 'run-1', scope });
    const restored = provisioner.statusForTenant('alpha');

    assert.equal(first.state, 'READY');
    assert.equal(first.environmentId, second.environmentId);
    assert.equal(restored.environmentId, first.environmentId);
    assert.equal(restored.dashboard.route, 'overview');
    assert.deepEqual(restored.configuration.sites, ['Tamworth', 'Berlin']);
    assert.equal(restored.configuration.employeeCount, 10000);
    assert.equal(restored.isolation.tenant, 'alpha');
    assert.equal(restored.isolation.namespace, first.namespace);
    assert.match(restored.configurationDigest, /^[a-f0-9]{64}$/);
  } finally {
    provisioner.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a different tenant receives a different namespace and cannot read another environment', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-tenant-isolation-'));
  const dbPath = path.join(root, 'wfm.sqlite');
  const provisioner = createTenantEnvironmentProvisioner({ dbPath });

  try {
    const scope = { companyName: 'Factory', employeeCount: 1, countries: ['UK'], sites: ['Site'], sourceSystems: [], features: [], workPatterns: [], clockingMethods: [] };
    const alpha = provisioner.provision({ tenant: 'alpha', runId: 'run-a', scope });
    const beta = provisioner.provision({ tenant: 'beta', runId: 'run-b', scope });

    assert.notEqual(alpha.environmentId, beta.environmentId);
    assert.notEqual(alpha.namespace, beta.namespace);
    assert.equal(provisioner.statusForTenant('missing'), null);
  } finally {
    provisioner.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('simultaneous provisioners serialize idempotent creation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-tenant-race-'));
  const dbPath = path.join(root, 'wfm.sqlite');
  const modulePath = path.join(__dirname, 'tenant-environment-provisioner.cjs');
  const worker = [
    "const {createTenantEnvironmentProvisioner}=require(process.argv[1]);",
    "const p=createTenantEnvironmentProvisioner({dbPath:process.argv[2]});",
    "const scope={companyName:'Factory',employeeCount:10,countries:['UK'],sites:['Plant'],sourceSystems:[],features:[],workPatterns:[],clockingMethods:[]};",
    "p.provision({tenant:'alpha',runId:'run-1',scope});p.close();"
  ].join('');

  function runWorker() {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', worker, modulePath, dbPath], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('exit', code => code === 0 ? resolve() : reject(new Error(stderr || 'worker exited ' + code)));
    });
  }

  try {
    await Promise.all([runWorker(), runWorker()]);
    const db = new DatabaseSync(dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tenant_environments WHERE tenant=?').get('alpha').count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tenant_environment_events WHERE tenant=?').get('alpha').count, 1);
    db.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
