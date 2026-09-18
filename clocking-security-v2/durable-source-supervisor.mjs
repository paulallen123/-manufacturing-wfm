import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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
function generation(value,label='Attendance rollback generation'){
  if(!Number.isSafeInteger(value) || value<0) throw new Error(`${label} must be a non-negative safe integer.`);
  return value;
}
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
    fs.mkdirSync(path.dirname(filePath),{recursive:true});
  }

  load(){
    const anchoredGeneration=generation(this.rollbackAnchor.current(),'Attendance rollback anchor generation');
    if(!fs.existsSync(this.filePath)){
      if(anchoredGeneration!==0) throw new Error('Attendance source state is missing while rollback anchor is advanced.');
      return null;
    }
    const raw=fs.readFileSync(this.filePath);
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
    if(frameGeneration!==anchoredGeneration) throw new Error('Attendance source state rollback detected.');
    return clone(frame.state);
  }

  save(state){
    const stateCopy=clone(state);
    const current=generation(this.rollbackAnchor.current(),'Attendance rollback anchor generation');
    const next=generation(this.rollbackAnchor.advance(current),'Attendance rollback anchor advanced generation');
    if(next!==current+1) throw new Error('Attendance rollback anchor did not advance exactly once.');
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
    const dir=path.dirname(this.filePath);
    const tmp=path.join(dir,`.${path.basename(this.filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    let fd=null;
    try{
      fd=fs.openSync(tmp,'wx',0o600);
      fs.writeFileSync(fd,body);
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd=null;
      fs.renameSync(tmp,this.filePath);
      const dirFd=fs.openSync(dir,'r');
      try{ fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    }catch(e){
      if(fd!==null){ try{fs.closeSync(fd);}catch{} }
      try{ if(fs.existsSync(tmp)) fs.unlinkSync(tmp); }catch{}
      throw e;
    }
    return {bytes:body.length,integrityKeyId:this.activeKeyId,rollbackGeneration:next};
  }
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
  status(args){ return this.supervisor.status(args); }
  pendingRecovery(args){ return this.supervisor.pendingRecovery(args); }

  #mutate(method,args){
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
}
