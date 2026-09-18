import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {isVerifiedSignedRollbackAnchorClient} from './signed-rollback-anchor.mjs';

function stable(value){
  if(value===null || typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
}
function clone(value){ return JSON.parse(JSON.stringify(value)); }
function keyId(value){
  const id=String(value||'').trim();
  if(!/^[A-Za-z0-9._:-]{1,128}$/.test(id)) throw new Error('Valid attendance state integrity key ID required.');
  return id;
}
function keyBytes(value){
  let key;
  if(Buffer.isBuffer(value)) key=Buffer.from(value);
  else if(value instanceof Uint8Array) key=Buffer.from(value);
  else if(typeof value==='string') key=Buffer.from(value,'utf8');
  else throw new Error('Attendance state integrity key material is required.');
  if(key.length<32) throw new Error('Attendance state integrity key must be at least 32 bytes.');
  return key;
}
function keyring(value){
  const entries=value instanceof Map?[...value.entries()]:(value && typeof value==='object' && !Array.isArray(value)?Object.entries(value):[]);
  if(entries.length===0) throw new Error('Attendance state integrity keyring is required.');
  const out=new Map();
  for(const [id,material] of entries) out.set(keyId(id),keyBytes(material));
  return out;
}
function rollbackAnchor(value){
  if(!value || typeof value.current!=='function' || typeof value.advance!=='function'){
    throw new Error('Independent attendance rollback anchor is required.');
  }
  return value;
}
function releaseGradeSecurityRequired(){
  return process.env.NODE_ENV==='production' || process.env.WFM_RELEASE_GRADE_SECURITY==='1';
}
function generation(value,label='Attendance rollback generation'){
  if(!Number.isSafeInteger(value) || value<0) throw new Error(`${label} must be a non-negative safe integer.`);
  return value;
}
function commitment(value,label='Attendance rollback commitment'){
  if(value===null || value===undefined) return null;
  const v=String(value).toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(v)) throw new Error(`${label} must be a SHA-256 hex digest.`);
  return v;
}
function bodyCommitment(body){ return crypto.createHash('sha256').update(body).digest('hex'); }
function macFor(schemaVersion,rollbackGeneration,state,key){
  return crypto.createHmac('sha256',key).update(stable({schemaVersion,rollbackGeneration,state})).digest('hex');
}
function sameMac(left,right){
  if(typeof left!=='string'||typeof right!=='string'||!/^[a-f0-9]{64}$/i.test(left)||!/^[a-f0-9]{64}$/i.test(right)) return false;
  const a=Buffer.from(left,'hex'),b=Buffer.from(right,'hex');
  return a.length===b.length && crypto.timingSafeEqual(a,b);
}

export class AtomicSupervisorStateStore {
  constructor({filePath,schemaVersion=3,maxBytes=16*1024*1024,integrityKeys,activeKeyId,rollbackAnchor:anchor}={}){
    if(!filePath) throw new Error('filePath required.');
    this.filePath=filePath;
    this.schemaVersion=schemaVersion;
    this.maxBytes=maxBytes;
    this.integrityKeys=keyring(integrityKeys);
    this.activeKeyId=keyId(activeKeyId);
    if(!this.integrityKeys.has(this.activeKeyId)) throw new Error('Active attendance state integrity key is not trusted.');
    this.rollbackAnchor=rollbackAnchor(anchor);
    if(releaseGradeSecurityRequired() && (
      typeof this.rollbackAnchor.currentState!=='function' ||
      typeof this.rollbackAnchor.advanceCommitted!=='function' ||
      !isVerifiedSignedRollbackAnchorClient(this.rollbackAnchor)
    )){
      throw new Error('Release-grade attendance state requires a verified signed commitment-aware independent rollback authority.');
    }
    this.needsRecovery=false;
    fs.mkdirSync(path.dirname(filePath),{recursive:true});
  }

  #anchorState(){
    if(typeof this.rollbackAnchor.currentState==='function'){
      const state=this.rollbackAnchor.currentState();
      return {generation:generation(state?.generation,'Attendance rollback anchor generation'),commitment:commitment(state?.commitment)};
    }
    return {generation:generation(this.rollbackAnchor.current(),'Attendance rollback anchor generation'),commitment:null};
  }

  #pendingPath(next,commit){
    return path.join(path.dirname(this.filePath),`.${path.basename(this.filePath)}.pending.${next}.${commit}`);
  }

  #fsyncDir(){
    const dirFd=fs.openSync(path.dirname(this.filePath),'r');
    try{ fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  }

  #parseAuthenticatedFrame(raw){
    if(raw.length>this.maxBytes) throw new Error('Attendance source state exceeds size limit.');
    let frame;
    try{ frame=JSON.parse(raw.toString('utf8')); }catch{ throw new Error('Attendance source state is invalid JSON.'); }
    const integrity=frame?.integrity;
    const frameGeneration=generation(frame?.rollbackGeneration,'Attendance source state rollback generation');
    if(frame?.schemaVersion!==this.schemaVersion || !frame?.state || integrity?.algorithm!=='HMAC-SHA256'){
      throw new Error('Attendance source state authenticated frame is invalid.');
    }
    const trustedKeyId=keyId(integrity.keyId);
    const key=this.integrityKeys.get(trustedKeyId);
    if(!key) throw new Error('Attendance source state integrity key is not trusted.');
    const expected=macFor(frame.schemaVersion,frameGeneration,frame.state,key);
    if(!sameMac(expected,integrity.mac)) throw new Error('Attendance source state authentication failed.');
    return {frame,frameGeneration};
  }

  #publishPending(pendingPath,expectedGeneration,expectedCommitment){
    const raw=fs.readFileSync(pendingPath);
    const parsed=this.#parseAuthenticatedFrame(raw);
    if(parsed.frameGeneration!==expectedGeneration || bodyCommitment(raw)!==expectedCommitment){
      throw new Error('Attendance source pending state does not match rollback anchor commitment.');
    }
    const tmp=`${this.filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.publish`;
    let fd=null;
    try{
      fd=fs.openSync(tmp,'wx',0o600);
      fs.writeFileSync(fd,raw);
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd=null;
      fs.renameSync(tmp,this.filePath);
      this.#fsyncDir();
      fs.unlinkSync(pendingPath);
      this.#fsyncDir();
    }catch(e){
      if(fd!==null){ try{fs.closeSync(fd);}catch{} }
      try{ if(fs.existsSync(tmp)) fs.unlinkSync(tmp); }catch{}
      throw e;
    }
    return raw;
  }

  load(){
    const anchor=this.#anchorState();
    if(!fs.existsSync(this.filePath)){
      if(anchor.generation===0){ this.needsRecovery=false; return null; }
      if(anchor.commitment){
        const pending=this.#pendingPath(anchor.generation,anchor.commitment);
        if(fs.existsSync(pending)){
          const raw=fs.readFileSync(pending);
          const parsed=this.#parseAuthenticatedFrame(raw);
          if(parsed.frameGeneration!==anchor.generation || bodyCommitment(raw)!==anchor.commitment){
            throw new Error('Attendance source pending state does not match rollback anchor commitment.');
          }
          this.#publishPending(pending,anchor.generation,anchor.commitment);
          this.needsRecovery=false;
          return clone(parsed.frame.state);
        }
      }
      throw new Error('Attendance source state is missing while rollback anchor is advanced.');
    }

    const raw=fs.readFileSync(this.filePath);
    const parsed=this.#parseAuthenticatedFrame(raw);
    if(parsed.frameGeneration===anchor.generation){
      this.needsRecovery=false;
      return clone(parsed.frame.state);
    }

    if(anchor.commitment && parsed.frameGeneration===anchor.generation-1){
      const pending=this.#pendingPath(anchor.generation,anchor.commitment);
      if(fs.existsSync(pending)){
        const pendingRaw=fs.readFileSync(pending);
        const pendingParsed=this.#parseAuthenticatedFrame(pendingRaw);
        if(pendingParsed.frameGeneration!==anchor.generation || bodyCommitment(pendingRaw)!==anchor.commitment){
          throw new Error('Attendance source pending state does not match rollback anchor commitment.');
        }
        this.#publishPending(pending,anchor.generation,anchor.commitment);
        this.needsRecovery=false;
        return clone(pendingParsed.frame.state);
      }
    }

    throw new Error('Attendance source state rollback detected.');
  }

  save(state){
    if(this.needsRecovery) throw new Error('Attendance source state requires restart/recovery before another write.');
    const stateCopy=clone(state);
    const anchor=this.#anchorState();
    const current=anchor.generation;
    const next=current+1;
    const payload={
      schemaVersion:this.schemaVersion,
      rollbackGeneration:next,
      state:stateCopy,
      integrity:{
        algorithm:'HMAC-SHA256',
        keyId:this.activeKeyId,
        mac:macFor(this.schemaVersion,next,stateCopy,this.integrityKeys.get(this.activeKeyId))
      }
    };
    const body=Buffer.from(JSON.stringify(payload));
    if(body.length>this.maxBytes) throw new Error('Attendance source state exceeds size limit.');
    const commit=bodyCommitment(body);

    if(typeof this.rollbackAnchor.advanceCommitted==='function' && typeof this.rollbackAnchor.currentState==='function'){
      const pending=this.#pendingPath(next,commit);
      let fd=null;
      try{
        try{
          fd=fs.openSync(pending,'wx',0o600);
          fs.writeFileSync(fd,body);
          fs.fsyncSync(fd);
          fs.closeSync(fd); fd=null;
          this.#fsyncDir();
        }catch(e){
          if(e?.code!=='EEXIST') throw e;
          const existing=fs.readFileSync(pending);
          if(!existing.equals(body)) throw new Error('Attendance source pending commitment collision or corruption.');
        }
      }catch(e){
        if(fd!==null){ try{fs.closeSync(fd);}catch{} }
        if(e?.message!=='Attendance source pending commitment collision or corruption.'){
          try{
            if(fs.existsSync(pending) && !fs.readFileSync(pending).equals(body)) fs.unlinkSync(pending);
          }catch{}
        }
        throw e;
      }

      this.needsRecovery=true;
      try{
        const advanced=this.rollbackAnchor.advanceCommitted(current,commit);
        if(generation(advanced?.generation,'Attendance rollback anchor advanced generation')!==next || commitment(advanced?.commitment)!==commit){
          throw new Error('Attendance rollback anchor did not advance with the exact staged commitment.');
        }
      }catch(e){
        throw e;
      }

      try{
        this.#publishPending(pending,next,commit);
        this.needsRecovery=false;
      }catch(e){
        throw e;
      }
      return {bytes:body.length,integrityKeyId:this.activeKeyId,rollbackGeneration:next,commitment:commit};
    }

    const dir=path.dirname(this.filePath);
    const tmp=path.join(dir,`.${path.basename(this.filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    let fd=null;
    try{
      fd=fs.openSync(tmp,'wx',0o600);
      fs.writeFileSync(fd,body);
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd=null;
    }catch(e){
      if(fd!==null){ try{fs.closeSync(fd);}catch{} }
      try{ if(fs.existsSync(tmp)) fs.unlinkSync(tmp); }catch{}
      throw e;
    }

    this.needsRecovery=true;
    try{
      const advanced=generation(this.rollbackAnchor.advance(current),'Attendance rollback anchor advanced generation');
      if(advanced!==next) throw new Error('Attendance rollback anchor did not advance exactly once.');
    }catch(e){
      try{ if(fs.existsSync(tmp)) fs.unlinkSync(tmp); }catch{}
      throw e;
    }

    try{
      fs.renameSync(tmp,this.filePath);
      this.#fsyncDir();
      this.needsRecovery=false;
    }catch(e){
      try{ if(fs.existsSync(tmp)) fs.unlinkSync(tmp); }catch{}
      throw e;
    }
    return {bytes:body.length,integrityKeyId:this.activeKeyId,rollbackGeneration:next};
  }

  requiresRecovery(){ return this.needsRecovery; }
}

export class DurableAttendanceSourceRuntime {
  constructor({supervisor,store}={}){
    if(!supervisor?.exportState || !supervisor?.restoreState) throw new Error('AttendanceSourceSupervisor required.');
    if(!store?.load || !store?.save) throw new Error('Persistent supervisor store required.');
    this.supervisor=supervisor; this.store=store;
    const state=this.store.load();
    if(state) this.supervisor.restoreState(state);
  }

  register(args){ return this.#mutate('register',args); }
  startCertificationWindow(args){ return this.#mutate('startCertificationWindow',args); }
  heartbeat(args){ return this.#mutate('heartbeat',args); }
  auth(args){ return this.#mutate('auth',args); }
  event(args){ return this.#mutate('event',args); }
  disconnected(args){ return this.#mutate('disconnected',args); }
  reconnected(args){ return this.#mutate('reconnected',args); }
  completeRecovery(args){ return this.#mutate('completeRecovery',args); }
  status(args){ this.#assertWritableState(); return this.supervisor.status(args); }
  pendingRecovery(args){ this.#assertWritableState(); return this.supervisor.pendingRecovery(args); }

  #mutate(method,args){
    this.#assertWritableState();
    const before=this.supervisor.exportState();
    let result;
    try{
      result=this.supervisor[method](args);
      this.store.save(this.supervisor.exportState());
      return result;
    }catch(e){
      try{ this.supervisor.restoreState(before); }catch(restoreError){ e.rollbackError=restoreError; }
      throw e;
    }
  }

  #assertWritableState(){
    if(this.store.requiresRecovery?.()) throw new Error('Attendance source runtime requires restart/recovery after interrupted durable commit.');
  }
}
