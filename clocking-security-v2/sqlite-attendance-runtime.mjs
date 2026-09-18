import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

function clone(value){ return JSON.parse(JSON.stringify(value)); }
function stable(value){
  if(value===null || typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
}
function digest(value){ return crypto.createHash('sha256').update(stable(value)).digest('hex'); }
function eventKey(event){ return `${event?.tenant??''}:${event?.sourceId??''}:${event?.eventId??''}`; }
function failure(message,status=500){ return Object.assign(new Error(message),{status}); }
function mapSnapshot(map){ return [...map.entries()].map(([k,v])=>[k,clone(v)]); }
function mapRestore(rows,name){
  if(!Array.isArray(rows)) throw new Error(`Invalid persisted ${name}.`);
  return new Map(rows.map(row=>{
    if(!Array.isArray(row)||row.length!==2) throw new Error(`Invalid persisted ${name} row.`);
    return [String(row[0]),clone(row[1])];
  }));
}

export function snapshotAttendanceEngine(engine){
  if(!engine?.ingest || !(engine.sources instanceof Map) || !(engine.people instanceof Map) || !(engine.events instanceof Map) || !(engine.employeeEvents instanceof Map) || !(engine.sessions instanceof Map) || !(engine.decisions instanceof Map) || !Array.isArray(engine.audit)){
    throw new Error('Compatible AutomaticAttendanceEvidenceEngine required.');
  }
  return {
    schemaVersion:1,
    config:{
      corroborationWindowMs:engine.corroborationWindowMs,
      maxFutureMs:engine.maxFutureMs,
      maxOfflineAgeMs:engine.maxOfflineAgeMs,
      minDistinctDomains:engine.minDistinctDomains
    },
    sources:mapSnapshot(engine.sources),
    people:mapSnapshot(engine.people),
    events:mapSnapshot(engine.events),
    employeeEvents:mapSnapshot(engine.employeeEvents),
    sessions:mapSnapshot(engine.sessions),
    decisions:mapSnapshot(engine.decisions),
    audit:clone(engine.audit)
  };
}

export function restoreAttendanceEngine(engine,state){
  if(!state || state.schemaVersion!==1 || !state.config) throw new Error('Unsupported persisted attendance-engine state.');
  const expected={
    corroborationWindowMs:engine.corroborationWindowMs,
    maxFutureMs:engine.maxFutureMs,
    maxOfflineAgeMs:engine.maxOfflineAgeMs,
    minDistinctDomains:engine.minDistinctDomains
  };
  if(stable(expected)!==stable(state.config)) throw new Error('Attendance-engine configuration changed; explicit migration required.');
  const sources=mapRestore(state.sources,'sources');
  const people=mapRestore(state.people,'people');
  const events=mapRestore(state.events,'events');
  const employeeEvents=mapRestore(state.employeeEvents,'employee events');
  const sessions=mapRestore(state.sessions,'sessions');
  const decisions=mapRestore(state.decisions,'decisions');
  if(!Array.isArray(state.audit)) throw new Error('Invalid persisted attendance audit.');
  engine.sources=sources;
  engine.people=people;
  engine.events=events;
  engine.employeeEvents=employeeEvents;
  engine.sessions=sessions;
  engine.decisions=decisions;
  engine.audit=clone(state.audit);
  return true;
}

/**
 * SQLiteAttendanceRuntime
 *
 * Development/reference durability runtime for proving cross-process exactly-once
 * attendance semantics. Every ingest is serialized with BEGIN IMMEDIATE, reloads
 * the latest canonical engine snapshot, applies one event, and atomically commits
 * the evidence outcome and resulting engine state. It is intentionally isolated
 * from the production release path; production storage must provide equivalent
 * transaction/uniqueness guarantees before promotion.
 */
export class SQLiteAttendanceRuntime {
  constructor({filePath,engine,logicVersion='invisible-attendance-v1',timeoutMs=5000}={}){
    if(!filePath) throw new Error('filePath required.');
    if(!engine?.ingest) throw new Error('Attendance engine required.');
    fs.mkdirSync(path.dirname(filePath),{recursive:true});
    this.filePath=filePath;
    this.engine=engine;
    this.logicVersion=logicVersion;
    this.db=new DatabaseSync(filePath,{timeout:timeoutMs});
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS attendance_state(
        id INTEGER PRIMARY KEY CHECK(id=1),
        logic_version TEXT NOT NULL,
        state_digest TEXT NOT NULL,
        state_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attendance_events(
        event_key TEXT PRIMARY KEY,
        event_digest TEXT NOT NULL,
        event_json TEXT NOT NULL,
        outcome_json TEXT NOT NULL
      );
    `);
    this.#bootstrap();
  }

  ingest(event){
    const key=eventKey(event);
    const eventDigest=digest(event);
    let canonicalBefore=null;
    this.db.exec('BEGIN IMMEDIATE');
    try{
      canonicalBefore=this.#readCanonicalState();
      restoreAttendanceEngine(this.engine,canonicalBefore);

      const prior=this.db.prepare('SELECT event_digest,outcome_json FROM attendance_events WHERE event_key=?').get(key);
      if(prior){
        if(prior.event_digest!==eventDigest) throw failure('Persisted attendance event ID reused for different content.',409);
        const outcome=this.#parseOutcome(prior.outcome_json);
        this.db.exec('COMMIT');
        if(outcome.ok) return {...clone(outcome.receipt),replayed:true,durableReplay:true};
        throw this.#durableError(outcome.error,true);
      }

      const beforeEvent=snapshotAttendanceEngine(this.engine);
      let outcome;
      try{
        const receipt=this.engine.ingest(event);
        outcome={ok:true,receipt:clone(receipt),error:null};
      }catch(e){
        restoreAttendanceEngine(this.engine,beforeEvent);
        outcome={ok:false,receipt:null,error:{message:String(e?.message||'Attendance evidence rejected.'),status:Number(e?.status)||400}};
      }

      const afterEvent=snapshotAttendanceEngine(this.engine);
      const stateJson=JSON.stringify(afterEvent);
      const outcomeJson=JSON.stringify(outcome);
      this.db.prepare('INSERT INTO attendance_events(event_key,event_digest,event_json,outcome_json) VALUES(?,?,?,?)')
        .run(key,eventDigest,JSON.stringify(event),outcomeJson);
      this.db.prepare('UPDATE attendance_state SET state_digest=?,state_json=? WHERE id=1')
        .run(digest(afterEvent),stateJson);
      this.db.exec('COMMIT');

      if(outcome.ok) return clone(outcome.receipt);
      throw this.#durableError(outcome.error,false);
    }catch(e){
      if(this.db.isTransaction){ try{ this.db.exec('ROLLBACK'); }catch{} }
      if(canonicalBefore){ try{ restoreAttendanceEngine(this.engine,canonicalBefore); }catch(restoreError){ e.rollbackError=restoreError; } }
      throw e;
    }
  }

  storedEventCount(){
    const row=this.db.prepare('SELECT COUNT(*) AS n FROM attendance_events').get();
    return Number(row.n);
  }

  close(){ if(this.db?.isOpen) this.db.close(); }

  #bootstrap(){
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const row=this.db.prepare('SELECT logic_version,state_digest,state_json FROM attendance_state WHERE id=1').get();
      if(row){
        if(row.logic_version!==this.logicVersion) throw failure('Attendance store logic version mismatch.',409);
        const state=this.#parseState(row.state_json,row.state_digest);
        restoreAttendanceEngine(this.engine,state);
      }else{
        const state=snapshotAttendanceEngine(this.engine);
        this.db.prepare('INSERT INTO attendance_state(id,logic_version,state_digest,state_json) VALUES(1,?,?,?)')
          .run(this.logicVersion,digest(state),JSON.stringify(state));
      }
      this.db.exec('COMMIT');
    }catch(e){
      if(this.db.isTransaction){ try{ this.db.exec('ROLLBACK'); }catch{} }
      throw e;
    }
  }

  #readCanonicalState(){
    const row=this.db.prepare('SELECT logic_version,state_digest,state_json FROM attendance_state WHERE id=1').get();
    if(!row) throw failure('Attendance store canonical state is missing.',500);
    if(row.logic_version!==this.logicVersion) throw failure('Attendance store logic version mismatch.',409);
    return this.#parseState(row.state_json,row.state_digest);
  }

  #parseState(raw,expectedDigest){
    let state; try{ state=JSON.parse(raw); }catch{ throw failure('Attendance store state is invalid JSON.',500); }
    if(digest(state)!==expectedDigest) throw failure('Attendance store state checksum mismatch.',500);
    return state;
  }

  #parseOutcome(raw){
    let outcome; try{ outcome=JSON.parse(raw); }catch{ throw failure('Attendance store outcome is invalid JSON.',500); }
    if(!outcome || typeof outcome.ok!=='boolean') throw failure('Attendance store outcome is invalid.',500);
    return outcome;
  }

  #durableError(details,replayed){
    const e=failure(details?.message||'Attendance evidence rejected.',details?.status||400);
    e.replayed=replayed;
    e.durableReplay=replayed;
    return e;
  }
}
