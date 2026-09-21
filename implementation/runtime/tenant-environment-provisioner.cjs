'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function safeList(value, limit = 100) {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item).trim()).filter(Boolean).slice(0, limit);
}

function normaliseConfiguration(scope) {
  return {
    companyName: String(scope.companyName || '').trim(),
    employeeCount: Number(scope.employeeCount || 0),
    countries: safeList(scope.countries, 30),
    sites: safeList(scope.sites),
    sourceSystems: safeList(scope.sourceSystems, 60),
    features: safeList(scope.features, 60),
    workPatterns: safeList(scope.workPatterns, 40),
    clockingMethods: safeList(scope.clockingMethods, 20),
    payrollSystem: String(scope.payrollSystem || '').trim(),
    hcmSystem: String(scope.hcmSystem || '').trim(),
    erpSystem: String(scope.erpSystem || '').trim(),
    agencyLabour: Boolean(scope.agencyLabour),
    priorities: String(scope.priorities || '').slice(0, 1000),
    notes: String(scope.notes || '').slice(0, 2000)
  };
}

function createTenantEnvironmentProvisioner(options = {}) {
  if (!options.db && !options.dbPath) throw new Error('Tenant environment provisioner requires db or dbPath.');
  const ownsDb = !options.db;
  const db = options.db || new DatabaseSync(options.dbPath);
  db.exec(
    'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;' +
    'CREATE TABLE IF NOT EXISTS tenant_environments(' +
      'tenant TEXT PRIMARY KEY, environment_id TEXT NOT NULL UNIQUE, namespace TEXT NOT NULL UNIQUE,' +
      'run_id TEXT NOT NULL, state TEXT NOT NULL, configuration_json TEXT NOT NULL,' +
      'configuration_digest TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);' +
    'CREATE TABLE IF NOT EXISTS tenant_environment_events(' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, tenant TEXT NOT NULL, environment_id TEXT NOT NULL,' +
      'event TEXT NOT NULL, configuration_digest TEXT NOT NULL, created_at TEXT NOT NULL);' +
    'CREATE TRIGGER IF NOT EXISTS no_tenant_environment_event_update BEFORE UPDATE ON tenant_environment_events ' +
      "BEGIN SELECT RAISE(ABORT,'Tenant environment events are append only.'); END;" +
    'CREATE TRIGGER IF NOT EXISTS no_tenant_environment_event_delete BEFORE DELETE ON tenant_environment_events ' +
      "BEGIN SELECT RAISE(ABORT,'Tenant environment events are append only.'); END;"
  );
  const get = db.prepare('SELECT * FROM tenant_environments WHERE tenant=?');
  const insert = db.prepare('INSERT INTO tenant_environments(tenant,environment_id,namespace,run_id,state,configuration_json,configuration_digest,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
  const update = db.prepare('UPDATE tenant_environments SET run_id=?,state=?,configuration_json=?,configuration_digest=?,updated_at=? WHERE tenant=?');
  const event = db.prepare('INSERT INTO tenant_environment_events(tenant,environment_id,event,configuration_digest,created_at) VALUES(?,?,?,?,?)');

  function publicEnvironment(row) {
    if (!row) return null;
    return {
      environmentId: row.environment_id,
      namespace: row.namespace,
      runId: row.run_id,
      state: row.state,
      configuration: JSON.parse(row.configuration_json),
      configurationDigest: row.configuration_digest,
      isolation: { tenant: row.tenant, namespace: row.namespace },
      dashboard: { route: 'overview', ready: row.state === 'READY' },
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function provision({ tenant, runId, scope }) {
    tenant = String(tenant || '').trim();
    runId = String(runId || '').trim();
    if (!tenant || !runId || !scope || typeof scope !== 'object') throw new Error('tenant, runId and scope are required.');
    const configuration = normaliseConfiguration(scope);
    if (!configuration.companyName || configuration.employeeCount < 1 || !configuration.sites.length || !configuration.countries.length) {
      throw new Error('Provisioning requires a complete validated scope.');
    }
    const encoded = stableJson(configuration);
    const digest = sha256(encoded);
    const now = new Date().toISOString();
    if (ownsDb) db.exec('BEGIN IMMEDIATE;');
    try {
      const existing = get.get(tenant);
      if (existing && existing.configuration_digest === digest && existing.run_id === runId && existing.state === 'READY') {
        if (ownsDb) db.exec('COMMIT;');
        return publicEnvironment(existing);
      }
      if (existing) {
        update.run(runId, 'READY', encoded, digest, now, tenant);
        event.run(tenant, existing.environment_id, 'ENVIRONMENT_RECONFIGURED', digest, now);
      } else {
        const environmentId = randomUUID();
        const namespace = 'tenant_' + sha256(tenant + ':' + environmentId).slice(0, 24);
        insert.run(tenant, environmentId, namespace, runId, 'READY', encoded, digest, now, now);
        event.run(tenant, environmentId, 'ENVIRONMENT_PROVISIONED', digest, now);
      }
      if (ownsDb) db.exec('COMMIT;');
    } catch (error) {
      if (ownsDb) try { db.exec('ROLLBACK;'); } catch {}
      throw error;
    }
    return publicEnvironment(get.get(tenant));
  }

  return {
    provision,
    statusForTenant(tenant) { return publicEnvironment(get.get(String(tenant || '').trim())); },
    close() { if (ownsDb) try { db.close(); } catch {} }
  };
}

module.exports = { createTenantEnvironmentProvisioner };
