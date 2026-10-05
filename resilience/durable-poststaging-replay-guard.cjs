'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
}
function deny(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function safeId(value, max = 128) {
  const v = String(value || '').trim();
  return v && v.length <= max && /^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(v) ? v : null;
}
function validDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function createDurableReplayGuard({ db, witnessPath, now = Date.now } = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.exec !== 'function') {
    deny('WFM_REPLAY_GUARD_DB', 'A durable SQLite database is required.');
  }
  const main = db.prepare('PRAGMA database_list').all().find((row) => row.name === 'main');
  const mainFile = String(main?.file || '').trim();
  if (!mainFile) deny('WFM_REPLAY_GUARD_DB', 'Replay guard refuses an in-memory authority database.');

  db.exec(`CREATE TABLE IF NOT EXISTS poststaging_replay_claims(
    scope TEXT NOT NULL,
    tenant_digest TEXT NOT NULL,
    incident_id TEXT NOT NULL,
    input_digest TEXT NOT NULL,
    claim_token TEXT NOT NULL,
    receipt_json TEXT,
    receipt_digest TEXT,
    PRIMARY KEY(scope, tenant_digest, incident_id)
  );
  CREATE TABLE IF NOT EXISTS poststaging_replay_witness_binding(
    id INTEGER PRIMARY KEY CHECK(id=1),
    identity TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS poststaging_replay_events(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    tenant_digest TEXT NOT NULL,
    incident_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    detail_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS poststaging_replay_events_no_update
    BEFORE UPDATE ON poststaging_replay_events BEGIN SELECT RAISE(ABORT,'Replay events are append-only'); END;
  CREATE TRIGGER IF NOT EXISTS poststaging_replay_events_no_delete
    BEFORE DELETE ON poststaging_replay_events BEGIN SELECT RAISE(ABORT,'Replay events are append-only'); END;`);

  const resolvedWitness = path.resolve(witnessPath || mainFile + '.poststaging-witness.sqlite');
  if (resolvedWitness === path.resolve(mainFile)) deny('WFM_REPLAY_GUARD_WITNESS', 'Replay witness must be separate from the application database.');

  let witnessError = null;
  let witnessIdentity = null;
  try {
    const binding = db.prepare('SELECT identity FROM poststaging_replay_witness_binding WHERE id=1').get();
    if (binding && !fs.existsSync(resolvedWitness)) throw new Error('Previously bound replay witness is missing.');
    const witness = new DatabaseSync(resolvedWitness);
    try {
      witness.exec(`PRAGMA journal_mode=WAL;
        PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS witness_identity(
          id INTEGER PRIMARY KEY CHECK(id=1),
          identity TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS consumed_poststaging_actions(
          scope TEXT NOT NULL,
          tenant_digest TEXT NOT NULL,
          incident_id TEXT NOT NULL,
          input_digest TEXT NOT NULL,
          claim_token TEXT NOT NULL,
          receipt_json TEXT,
          receipt_digest TEXT,
          PRIMARY KEY(scope, tenant_digest, incident_id)
        );`);
      let identity = witness.prepare('SELECT identity FROM witness_identity WHERE id=1').get();
      if (!identity) {
        if (binding) throw new Error('Bound replay witness identity is missing.');
        identity = { identity: randomUUID() };
        witness.prepare('INSERT INTO witness_identity VALUES(1,?)').run(identity.identity);
      }
      if (binding && binding.identity !== identity.identity) throw new Error('Replay witness identity changed.');
      witnessIdentity = identity.identity;
      if (!binding) db.prepare('INSERT INTO poststaging_replay_witness_binding VALUES(1,?)').run(identity.identity);
    } finally {
      witness.close();
    }
  } catch (error) {
    witnessError = error;
  }

  function mainTx(work) {
    try { db.exec('BEGIN IMMEDIATE'); }
    catch { deny('WFM_REPLAY_GUARD_TRANSACTION', 'Replay guard requires a committed authority transaction.'); }
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  function witnessTx(work) {
    if (witnessError || !fs.existsSync(resolvedWitness)) {
      deny('WFM_REPLAY_GUARD_WITNESS', 'Independent replay witness is unavailable.');
    }
    const witness = new DatabaseSync(resolvedWitness);
    try {
      witness.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE');
      if (witness.prepare('SELECT identity FROM witness_identity WHERE id=1').get()?.identity !== witnessIdentity) {
        deny('WFM_REPLAY_GUARD_WITNESS', 'Independent replay witness identity changed.');
      }
      const result = work(witness);
      witness.exec('COMMIT');
      return result;
    } catch (error) {
      try { witness.exec('ROLLBACK'); } catch {}
      throw error;
    } finally {
      witness.close();
    }
  }

  function validateKey(input = {}) {
    const scope = safeId(input.scope, 80);
    const incidentId = safeId(input.incidentId, 128);
    const tenantDigest = String(input.tenantDigest || '').trim().toLowerCase();
    const inputDigest = String(input.inputDigest || '').trim().toLowerCase();
    if (!scope || !incidentId || !validDigest(tenantDigest) || !validDigest(inputDigest)) {
      deny('WFM_REPLAY_GUARD_INPUT', 'Replay guard requires bounded scope, incident and SHA-256 digests.');
    }
    return { scope, incidentId, tenantDigest, inputDigest };
  }

  function validateStored(row, key) {
    if (!row || row.scope !== key.scope || row.tenant_digest !== key.tenantDigest || row.incident_id !== key.incidentId) {
      deny('WFM_REPLAY_GUARD_INTEGRITY', 'Replay record scope mismatch.');
    }
    if (row.input_digest !== key.inputDigest) {
      deny('WFM_REPLAY_GUARD_CONFLICT', 'Incident was already claimed with different evidence or configuration.');
    }
    if (row.receipt_json === null || row.receipt_json === undefined) return null;
    if (!validDigest(row.receipt_digest) || digest(row.receipt_json) !== row.receipt_digest) {
      deny('WFM_REPLAY_GUARD_INTEGRITY', 'Retained replay receipt failed integrity validation.');
    }
    let receipt;
    try { receipt = JSON.parse(row.receipt_json); }
    catch { deny('WFM_REPLAY_GUARD_INTEGRITY', 'Retained replay receipt is not valid JSON.'); }
    return receipt;
  }

  function event(key, type, detail = {}) {
    db.prepare(`INSERT INTO poststaging_replay_events(
      scope,tenant_digest,incident_id,event_type,detail_json,created_at
    ) VALUES(?,?,?,?,?,?)`).run(
      key.scope, key.tenantDigest, key.incidentId, type, JSON.stringify(detail), Number(now())
    );
  }

  function claim(input = {}) {
    const key = validateKey(input);
    return mainTx(() => {
      const token = randomUUID();
      let witnessed = witnessTx((witness) => {
        const prior = witness.prepare(`SELECT * FROM consumed_poststaging_actions
          WHERE scope=? AND tenant_digest=? AND incident_id=?`).get(key.scope, key.tenantDigest, key.incidentId);
        if (prior) return prior;
        witness.prepare(`INSERT INTO consumed_poststaging_actions(
          scope,tenant_digest,incident_id,input_digest,claim_token
        ) VALUES(?,?,?,?,?)`).run(key.scope, key.tenantDigest, key.incidentId, key.inputDigest, token);
        return null;
      });

      let local = db.prepare(`SELECT * FROM poststaging_replay_claims
        WHERE scope=? AND tenant_digest=? AND incident_id=?`).get(key.scope, key.tenantDigest, key.incidentId);

      if (witnessed) {
        const witnessReceipt = validateStored(witnessed, key);
        if (witnessReceipt) {
          if (!local) {
            db.prepare(`INSERT INTO poststaging_replay_claims(
              scope,tenant_digest,incident_id,input_digest,claim_token,receipt_json,receipt_digest
            ) VALUES(?,?,?,?,?,?,?)`).run(
              key.scope,key.tenantDigest,key.incidentId,key.inputDigest,
              witnessed.claim_token,witnessed.receipt_json,witnessed.receipt_digest
            );
            local = db.prepare(`SELECT * FROM poststaging_replay_claims
              WHERE scope=? AND tenant_digest=? AND incident_id=?`).get(key.scope,key.tenantDigest,key.incidentId);
          } else {
            validateStored(local, key);
            if (local.claim_token !== witnessed.claim_token) deny('WFM_REPLAY_GUARD_INTEGRITY', 'Replay claim token differs from witness.');
            if (!local.receipt_json) {
              db.prepare(`UPDATE poststaging_replay_claims SET receipt_json=?,receipt_digest=?
                WHERE scope=? AND tenant_digest=? AND incident_id=? AND claim_token=? AND receipt_json IS NULL`).run(
                witnessed.receipt_json,witnessed.receipt_digest,
                key.scope,key.tenantDigest,key.incidentId,witnessed.claim_token
              );
              local = db.prepare(`SELECT * FROM poststaging_replay_claims
                WHERE scope=? AND tenant_digest=? AND incident_id=?`).get(key.scope,key.tenantDigest,key.incidentId);
            }
          }
          const receipt = validateStored(local, key);
          event(key, 'replay-returned', { receiptDigest: witnessed.receipt_digest });
          return { status: 'replay', receipt };
        }

        if (local) {
          const localReceipt = validateStored(local, key);
          if (local.claim_token !== witnessed.claim_token) deny('WFM_REPLAY_GUARD_INTEGRITY', 'Replay claim token differs from witness.');
          if (localReceipt) {
            const receiptJson = JSON.stringify(localReceipt);
            const receiptDigest = digest(receiptJson);
            witnessTx((witness) => {
              const saved = witness.prepare(`UPDATE consumed_poststaging_actions
                SET receipt_json=?,receipt_digest=?
                WHERE scope=? AND tenant_digest=? AND incident_id=? AND claim_token=? AND receipt_json IS NULL`).run(
                  receiptJson,receiptDigest,key.scope,key.tenantDigest,key.incidentId,witnessed.claim_token
                );
              if (Number(saved.changes) !== 1) deny('WFM_REPLAY_GUARD_INTEGRITY', 'Replay witness could not be reconciled.');
            });
            event(key, 'witness-reconciled', { receiptDigest });
            return { status: 'replay', receipt: localReceipt };
          }
        }
        deny('WFM_REPLAY_GUARD_RECONCILIATION_REQUIRED', 'A post-staging action was claimed but has no committed terminal receipt.');
      }

      const inserted = db.prepare(`INSERT OR IGNORE INTO poststaging_replay_claims(
        scope,tenant_digest,incident_id,input_digest,claim_token
      ) VALUES(?,?,?,?,?)`).run(key.scope,key.tenantDigest,key.incidentId,key.inputDigest,token);

      if (Number(inserted.changes) === 1) {
        event(key, 'claim-consumed', { claimTokenDigest: digest(token) });
        return { status: 'claimed', token };
      }

      local = db.prepare(`SELECT * FROM poststaging_replay_claims
        WHERE scope=? AND tenant_digest=? AND incident_id=?`).get(key.scope,key.tenantDigest,key.incidentId);
      const receipt = validateStored(local, key);
      if (!receipt) deny('WFM_REPLAY_GUARD_RECONCILIATION_REQUIRED', 'A post-staging action was claimed but has no committed terminal receipt.');
      event(key, 'replay-returned', { receiptDigest: local.receipt_digest });
      return { status: 'replay', receipt };
    });
  }

  function complete(input = {}) {
    const key = validateKey(input);
    const token = String(input.token || '');
    if (!token) deny('WFM_REPLAY_GUARD_INPUT', 'Replay claim token is required.');
    if (!input.receipt || typeof input.receipt !== 'object' || Array.isArray(input.receipt)) {
      deny('WFM_REPLAY_GUARD_INPUT', 'Terminal receipt object is required.');
    }
    const receiptJson = JSON.stringify(input.receipt);
    const receiptDigest = digest(receiptJson);

    mainTx(() => {
      const row = db.prepare(`SELECT * FROM poststaging_replay_claims
        WHERE scope=? AND tenant_digest=? AND incident_id=?`).get(key.scope,key.tenantDigest,key.incidentId);
      if (!row || row.claim_token !== token || row.input_digest !== key.inputDigest) {
        deny('WFM_REPLAY_GUARD_INTEGRITY', 'Replay completion does not own the consumed claim.');
      }
      if (row.receipt_json) {
        if (row.receipt_digest !== receiptDigest || row.receipt_json !== receiptJson) {
          deny('WFM_REPLAY_GUARD_INTEGRITY', 'A different terminal receipt is already committed.');
        }
        return;
      }
      const saved = db.prepare(`UPDATE poststaging_replay_claims SET receipt_json=?,receipt_digest=?
        WHERE scope=? AND tenant_digest=? AND incident_id=? AND claim_token=? AND receipt_json IS NULL`).run(
          receiptJson,receiptDigest,key.scope,key.tenantDigest,key.incidentId,token
        );
      if (Number(saved.changes) !== 1) deny('WFM_REPLAY_GUARD_INTEGRITY', 'Terminal replay receipt could not be committed.');
      event(key, 'terminal-committed', { receiptDigest });
    });

    witnessTx((witness) => {
      const row = witness.prepare(`SELECT * FROM consumed_poststaging_actions
        WHERE scope=? AND tenant_digest=? AND incident_id=?`).get(key.scope,key.tenantDigest,key.incidentId);
      if (!row || row.claim_token !== token || row.input_digest !== key.inputDigest) {
        deny('WFM_REPLAY_GUARD_INTEGRITY', 'Replay witness does not own the consumed claim.');
      }
      if (row.receipt_json) {
        if (row.receipt_digest !== receiptDigest || row.receipt_json !== receiptJson) {
          deny('WFM_REPLAY_GUARD_INTEGRITY', 'Replay witness retains a different terminal receipt.');
        }
        return;
      }
      const saved = witness.prepare(`UPDATE consumed_poststaging_actions SET receipt_json=?,receipt_digest=?
        WHERE scope=? AND tenant_digest=? AND incident_id=? AND claim_token=? AND receipt_json IS NULL`).run(
          receiptJson,receiptDigest,key.scope,key.tenantDigest,key.incidentId,token
        );
      if (Number(saved.changes) !== 1) deny('WFM_REPLAY_GUARD_INTEGRITY', 'Terminal replay witness receipt could not be committed.');
    });

    return { receiptDigest };
  }

  function inspect(input = {}) {
    const key = validateKey(input);
    const row = db.prepare(`SELECT * FROM poststaging_replay_claims
      WHERE scope=? AND tenant_digest=? AND incident_id=?`).get(key.scope,key.tenantDigest,key.incidentId);
    if (!row) return null;
    const receipt = validateStored(row, key);
    return {
      scope: row.scope,
      tenantDigest: row.tenant_digest,
      incidentId: row.incident_id,
      inputDigest: row.input_digest,
      completed: Boolean(receipt),
      receiptDigest: row.receipt_digest || null,
      receipt
    };
  }

  return {
    claim,
    complete,
    inspect,
    capabilities: () => ({
      durable: true,
      atomicClaim: true,
      failClosedOnPending: true,
      tenantScoped: true,
      independentWitness: true,
      modelCanGrantAuthority: false
    })
  };
}

module.exports = { createDurableReplayGuard, canonical, digest };
