import { DatabaseSync } from 'node:sqlite';
import { types } from 'node:util';
import { AdaptiveIntelligenceEngine } from './engine.mjs';

// Narrow, synchronous replay ledger for an approved local SQLite state path.
// The caller still owns source authentication, tenant binding and volume custody.
const columns=['tenantScope','source','category','fingerprint','evidenceRef'];
function normalize(raw){
  if(!raw||typeof raw!=='object'||types.isProxy(raw)) throw new Error('OUTCOME_INERT_RECORD_REQUIRED');
  const prototype=Object.getPrototypeOf(raw);
  if(prototype!==Object.prototype&&prototype!==null) throw new Error('OUTCOME_INERT_RECORD_REQUIRED');
  const descriptors=Object.getOwnPropertyDescriptors(raw),input=Object.create(null);
  for(const key of Reflect.ownKeys(descriptors)){
    const descriptor=descriptors[key];
    if(typeof key!=='string'||!descriptor.enumerable||!Object.hasOwn(descriptor,'value')) throw new Error('OUTCOME_INERT_RECORD_REQUIRED');
    input[key]=descriptor.value;
  }
  for(const key of columns) if(typeof input[key]!=='string'||!input[key].trim()||input[key].length>512) throw new Error('OUTCOME_STABLE_'+key+'_REQUIRED');
  if(typeof input.baseline!=='number'||!Number.isFinite(input.baseline)||typeof input.result!=='number'||!Number.isFinite(input.result)) throw new Error('OUTCOME_FINITE_VALUES_REQUIRED');
  if(typeof input.verified!=='boolean') throw new Error('OUTCOME_VERIFIED_BOOLEAN_REQUIRED');
  if(input.crossTenantRawMemory===true||input.containsSecret===true||input.memoryGrantsAuthority===true) throw new Error('OUTCOME_AUTHORITY_OR_SECRET_FORBIDDEN');
  if(input.createdAt!==undefined&&(typeof input.createdAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(input.createdAt)||!Number.isFinite(Date.parse(input.createdAt)))) throw new Error('OUTCOME_CREATED_AT_INVALID');
  return {
    tenantScope:input.tenantScope.trim(),source:input.source.trim(),
    category:input.category.trim(),fingerprint:input.fingerprint.trim(),
    baseline:input.baseline===0?0:input.baseline,
    result:input.result===0?0:input.result,verified:input.verified,
    evidenceRef:input.evidenceRef.trim(),
    ...(input.createdAt===undefined?{}:{createdAt:input.createdAt})
  };
}

export class DurableOutcomeLedger {
  #db;
  #minRepeatedWins;
  constructor({path,minRepeatedWins=3}={}){
    if(typeof path!=='string'||!path.trim()||path===':memory:') throw new Error('DURABLE_PATH_REQUIRED');
    if(!Number.isInteger(minRepeatedWins)||minRepeatedWins<2||minRepeatedWins>1000) throw new Error('LEARNING_THRESHOLD_INVALID');
    this.#minRepeatedWins=minRepeatedWins;
    this.#db=new DatabaseSync(path,{timeout:5000});
    this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS outcome_replay (seq INTEGER PRIMARY KEY, tenant TEXT NOT NULL, source TEXT NOT NULL, evidence TEXT NOT NULL, input_json TEXT NOT NULL, UNIQUE(tenant,source,evidence)); CREATE TABLE IF NOT EXISTS outcome_replay_config (name TEXT PRIMARY KEY, value TEXT NOT NULL);');
    this.#db.exec('BEGIN IMMEDIATE');
    try{
      const stored=this.#db.prepare('SELECT value FROM outcome_replay_config WHERE name=?').get('minRepeatedWins');
      if(stored&&stored.value!==String(minRepeatedWins)) throw new Error('LEARNING_THRESHOLD_REPLAY_MISMATCH');
      if(!stored) this.#db.prepare('INSERT INTO outcome_replay_config (name,value) VALUES (?,?)').run('minRepeatedWins',String(minRepeatedWins));
      this.#db.exec('COMMIT');
    }catch(error){this.#db.exec('ROLLBACK');this.#db.close();throw error;}
    this.snapshot(); // fail closed if the existing ledger cannot be replayed
  }
  #replay(){
    const engine=new AdaptiveIntelligenceEngine({minRepeatedWins:this.#minRepeatedWins});
    for(const {tenant,source,evidence,input_json} of this.#db.prepare('SELECT tenant,source,evidence,input_json FROM outcome_replay ORDER BY seq').all()){
      const raw=JSON.parse(input_json), input=normalize(raw);
      if(input.tenantScope!==tenant||input.source!==source||input.evidenceRef!==evidence||!input.createdAt) throw new Error('OUTCOME_REPLAY_ROW_INVALID');
      engine.ingestOutcome(input);
    }
    return engine;
  }
  ingestOutcome(raw){
    const input=normalize(raw);
    this.#db.exec('BEGIN IMMEDIATE');
    try{
      const engine=this.#replay();
      const receipt=engine.ingestOutcome(input);
      const existing=this.#db.prepare('SELECT input_json FROM outcome_replay WHERE tenant=? AND source=? AND evidence=?').get(input.tenantScope,input.source,input.evidenceRef);
      if(!existing){
        const stored={...input,createdAt:receipt.createdAt};
        this.#db.prepare('INSERT INTO outcome_replay (tenant,source,evidence,input_json) VALUES (?,?,?,?)').run(input.tenantScope,input.source,input.evidenceRef,JSON.stringify(stored));
      }
      this.#db.exec('COMMIT');
      return receipt;
    }catch(error){
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }
  snapshot(){return this.#replay().snapshot();}
  close(){this.#db.close();}
}
