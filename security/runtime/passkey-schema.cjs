'use strict';
function ensurePasskeySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS passkey_users(tenant TEXT NOT NULL,email TEXT NOT NULL,user_handle TEXT NOT NULL UNIQUE,PRIMARY KEY(tenant,email));
    CREATE TABLE IF NOT EXISTS passkey_credentials(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,email TEXT NOT NULL,user_handle TEXT NOT NULL,public_key BLOB NOT NULL,counter INTEGER NOT NULL,transports TEXT NOT NULL,device_type TEXT NOT NULL,backed_up INTEGER NOT NULL,created_at INTEGER NOT NULL,revoked_at INTEGER);
    CREATE TABLE IF NOT EXISTS passkey_challenges(nonce_hash TEXT PRIMARY KEY,kind TEXT NOT NULL,challenge TEXT NOT NULL,authorization TEXT,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS passkey_sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,tenant TEXT NOT NULL,role TEXT NOT NULL,credential_id TEXT NOT NULL,issued_at INTEGER NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS passkey_invitation_uses(token_hash TEXT PRIMARY KEY,used_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS passkey_rate_limits(bucket TEXT PRIMARY KEY,window_start INTEGER NOT NULL,attempts INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS passkey_events(id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT NOT NULL,tenant TEXT NOT NULL,event TEXT NOT NULL,credential_id TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TRIGGER IF NOT EXISTS no_passkey_event_update BEFORE UPDATE ON passkey_events BEGIN SELECT RAISE(ABORT,'Passkey events are append only.'); END;
    CREATE TRIGGER IF NOT EXISTS no_passkey_event_delete BEFORE DELETE ON passkey_events BEGIN SELECT RAISE(ABORT,'Passkey events are append only.'); END;
  `);
}
module.exports={ensurePasskeySchema};
