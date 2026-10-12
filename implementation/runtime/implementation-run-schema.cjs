'use strict';

// Schema only. Native readiness and the existing implementation engine share
// this original relation; no engine, adapter, run or notification is created.
const runSchemaSQL='CREATE TABLE IF NOT EXISTS implementation_runs(' +
  'id TEXT PRIMARY KEY, tenant TEXT NOT NULL, contract_ref_hash TEXT NOT NULL, state TEXT NOT NULL,' +
  'started_at_ms INTEGER NOT NULL, deadline_at_ms INTEGER NOT NULL, target_hours INTEGER NOT NULL,' +
  'created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(tenant,contract_ref_hash));';
const unavailable=()=>{throw Object.assign(Error('Setup mode binding unavailable.'),{code:'SETUP_MODE_BINDING_UNAVAILABLE',statusCode:503});};
function initializeImplementationRunSchema({db}={}){
  if(!db||typeof db.exec!=='function')throw Object.assign(Error('Setup mode binding unavailable.'),{code:'SETUP_MODE_BINDING_UNAVAILABLE',statusCode:503});
  db.exec(runSchemaSQL);
}
function assertImplementationRunSchema({db}={}){
  const normal=sql=>String(sql||'').replace(/IF NOT EXISTS /g,'').replace(/\s+/g,'').replace(/;$/,'');
  try{if(normal(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='implementation_runs'").get()?.sql)!==normal(runSchemaSQL))unavailable();}
  catch(error){if(error.code==='SETUP_MODE_BINDING_UNAVAILABLE')throw error;unavailable();}
}
module.exports={initializeImplementationRunSchema,assertImplementationRunSchema};
