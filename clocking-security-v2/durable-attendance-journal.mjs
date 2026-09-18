import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function stable(value){
  if(value===null || typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
}
function hash(value){ return crypto.createHash('sha256').update(stable(value)).digest('hex'); }
function clone(value){ return JSON.parse(JSON.stringify(value)); }
function eventKey(event){ return `${event.tenant}:${event.sourceId}:${event.eventId}`; }
function error(message,status=500){ return Object.assign(new Error(message),{status}); }

export class DurableEvidenceJournal {
  constructor({filePath,logicVersion='invisible-attendance-v1',maxFrameBytes=1024*1024}={}){
    if(!filePath) throw new Error('filePath required');
    this.filePath=filePath; this.logicVersion=logicVersion; this.maxFrameBytes=maxFrameBytes;
    fs.mkdirSync(path.dirname(filePath),{recursive:true});
    if(!fs.existsSync(filePath)) fs.closeSync(fs.openSync(filePath,'a'));
    this.events=[]; this.eventByKey=new Map(); this.outcomeByKey=new Map();
    this.#load();
  }

  appendEvent(event){
    const key=eventKey(event); const eventDigest=hash(event);
    const prior=this.eventByKey.get(key);
    if(prior){
      if(prior.eventDigest!==eventDigest) throw error('Persisted attendance event ID reused for different content.',409);
      return {persisted:false,replayed:true,key,eventDigest};
    }
    const record={type:'event',logicVersion:this.logicVersion,key,eventDigest,event:clone(event)};
    this.#append(record);
    this.events.push(record); this.eventByKey.set(key,record);
    return {persisted:true,replayed:false,key,eventDigest};
  }

  appendOutcome({key,eventDigest,ok,receipt=null,error:errValue=null}){
    const event=this.eventByKey.get(key);
    if(!event || event.eventDigest!==eventDigest) throw error('Outcome does not match a persisted attendance event.',409);
    const outcome={type:'outcome',logicVersion:this.logicVersion,key,eventDigest,ok:Boolean(ok),receipt:receipt?clone(receipt):null,error:errValue?clone(errValue):null};
    const prior=this.outcomeByKey.get(key);
    if(prior){
      if(hash(prior)!==hash(outcome)) throw error('Attendance event already has a different durable outcome.',409);
      return {persisted:false,replayed:true,outcome:clone(prior)};
    }
    this.#append(outcome); this.outcomeByKey.set(key,outcome);
    return {persisted:true,replayed:false,outcome:clone(outcome)};
  }

  getOutcome(key){ const x=this.outcomeByKey.get(key); return x?clone(x):null; }
  listEvents(){ return this.events.map(x=>clone(x)); }

  #append(payload){
    if(payload.logicVersion!==this.logicVersion) throw error('Logic version mismatch.',409);
    const body=stable(payload); const frame=JSON.stringify({payload,checksum:crypto.createHash('sha256').update(body).digest('hex')})+'\n';
    if(Buffer.byteLength(frame)>this.maxFrameBytes) throw error('Attendance journal frame is too large.',413);
    const fd=fs.openSync(this.filePath,'a');
    try{ fs.writeSync(fd,frame); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }

  #load(){
    const buf=fs.readFileSync(this.filePath);
    if(!buf.length) return;
    const lastNl=buf.lastIndexOf(0x0a);
    if(lastNl!==buf.length-1){
      fs.truncateSync(this.filePath,lastNl>=0?lastNl+1:0);
    }
    const text=fs.readFileSync(this.filePath,'utf8');
    for(const line of text.split('\n')){
      if(!line) continue;
      if(Buffer.byteLength(line)>this.maxFrameBytes) throw error('Attendance journal frame exceeds limit.',500);
      let frame; try{ frame=JSON.parse(line); }catch{ throw error('Attendance journal contains invalid JSON.',500); }
      if(!frame?.payload || typeof frame.checksum!=='string') throw error('Attendance journal frame is malformed.',500);
      const expected=crypto.createHash('sha256').update(stable(frame.payload)).digest('hex');
      if(frame.checksum!==expected) throw error('Attendance journal checksum mismatch.',500);
      const r=frame.payload;
      if(r.logicVersion!==this.logicVersion) throw error(`Attendance journal logic version ${r.logicVersion} does not match ${this.logicVersion}.`,409);
      if(r.type==='event'){
        if(hash(r.event)!==r.eventDigest || eventKey(r.event)!==r.key) throw error('Attendance journal event identity mismatch.',500);
        const prior=this.eventByKey.get(r.key);
        if(prior && prior.eventDigest!==r.eventDigest) throw error('Attendance journal contains conflicting event identities.',500);
        if(!prior){ this.events.push(r); this.eventByKey.set(r.key,r); }
      } else if(r.type==='outcome'){
        const event=this.eventByKey.get(r.key);
        if(!event || event.eventDigest!==r.eventDigest) throw error('Attendance journal contains an orphan outcome.',500);
        const prior=this.outcomeByKey.get(r.key);
        if(prior && hash(prior)!==hash(r)) throw error('Attendance journal contains conflicting outcomes.',500);
        if(!prior) this.outcomeByKey.set(r.key,r);
      } else throw error('Attendance journal record type is unsupported.',500);
    }
  }
}

export class DurableAttendanceRuntime {
  constructor({engine,journal}){
    if(!engine?.ingest || !(journal instanceof DurableEvidenceJournal)) throw new Error('engine and DurableEvidenceJournal required');
    this.engine=engine; this.journal=journal; this.#recover();
  }

  ingest(event){
    const persisted=this.journal.appendEvent(event);
    const prior=this.journal.getOutcome(persisted.key);
    if(prior){
      if(prior.ok) return {...clone(prior.receipt),replayed:true,durableReplay:true};
      throw this.#durableError(prior.error,true);
    }
    try{
      const receipt=this.engine.ingest(event);
      this.journal.appendOutcome({key:persisted.key,eventDigest:persisted.eventDigest,ok:true,receipt});
      return receipt;
    }catch(e){
      const details={message:String(e?.message||'Attendance evidence rejected.'),status:Number(e?.status)||400};
      this.journal.appendOutcome({key:persisted.key,eventDigest:persisted.eventDigest,ok:false,error:details});
      throw this.#durableError(details,false);
    }
  }

  #recover(){
    for(const record of this.journal.listEvents()){
      const prior=this.journal.getOutcome(record.key);
      if(prior && !prior.ok) continue;
      try{
        const receipt=this.engine.ingest(record.event);
        if(prior){
          if(hash(receipt)!==hash(prior.receipt)) throw error('Recovered attendance outcome differs from durable outcome. Refusing silent reinterpretation.',409);
        }else{
          this.journal.appendOutcome({key:record.key,eventDigest:record.eventDigest,ok:true,receipt});
        }
      }catch(e){
        if(prior?.ok) throw e;
        if(!prior){
          const details={message:String(e?.message||'Attendance evidence rejected during recovery.'),status:Number(e?.status)||400};
          this.journal.appendOutcome({key:record.key,eventDigest:record.eventDigest,ok:false,error:details});
        }
      }
    }
  }

  #durableError(details,replayed){
    const e=error(details?.message||'Attendance evidence rejected.',details?.status||400); e.replayed=replayed; e.durableReplay=replayed; return e;
  }
}
