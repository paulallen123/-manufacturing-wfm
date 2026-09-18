import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function stable(value){
  if(value===null || typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
}
function checksum(value){ return crypto.createHash('sha256').update(stable(value)).digest('hex'); }
function clone(value){ return JSON.parse(JSON.stringify(value)); }

export class AtomicSupervisorStateStore {
  constructor({filePath,schemaVersion=1,maxBytes=16*1024*1024}={}){
    if(!filePath) throw new Error('filePath required.');
    this.filePath=filePath; this.schemaVersion=schemaVersion; this.maxBytes=maxBytes;
    fs.mkdirSync(path.dirname(filePath),{recursive:true});
  }

  load(){
    if(!fs.existsSync(this.filePath)) return null;
    const raw=fs.readFileSync(this.filePath);
    if(raw.length>this.maxBytes) throw new Error('Attendance source state exceeds size limit.');
    let frame; try{ frame=JSON.parse(raw.toString('utf8')); }catch{ throw new Error('Attendance source state is invalid JSON.'); }
    if(frame?.schemaVersion!==this.schemaVersion || !frame?.state || typeof frame.checksum!=='string') throw new Error('Attendance source state frame is invalid.');
    if(checksum(frame.state)!==frame.checksum) throw new Error('Attendance source state checksum mismatch.');
    return clone(frame.state);
  }

  save(state){
    const payload={schemaVersion:this.schemaVersion,state:clone(state),checksum:checksum(state)};
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
    return {bytes:body.length,checksum:payload.checksum};
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
