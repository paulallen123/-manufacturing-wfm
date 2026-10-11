'use strict';
const fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),db=new DatabaseSync(input.database);
db.exec('PRAGMA foreign_keys=ON');const load=n=>require(path.join(input.runtime,'lib',n+'.cjs'));
const support=load('support-operations').createStore(db),jobs=load('provider-job-store').createStore(db);
const investigations=load('provider-investigation').createStore(db,{providerJobs:jobs,support});
const PRA=load('provider-recovery-authority'),authority=load('agent-tool-authority').createAuthority({db,key:'ci-only-agent-authority-key-0123456789abcdef0123456789abcdef',toolPolicy:{[PRA.TOOL_ID]:[...PRA.ACTIONS]}});
const executor=PRA.createExecutor({db,providerJobs:jobs,investigations,authority});
if(input.mode==='inside-start-audit'){
 const prepare=db.prepare.bind(db);db.prepare=sql=>{const stmt=prepare(sql);if(sql.startsWith('INSERT INTO support_events')){const run=stmt.run.bind(stmt);stmt.run=(...args)=>{const result=run(...args);if(args[2]==='provider-recovery-started')process.kill(process.pid,'SIGKILL');return result;};}return stmt;};
}
investigations.connectBoundedExecutor({...executor,executePermit(...args){if(input.mode==='before-executor')process.kill(process.pid,'SIGKILL');const r=executor.executePermit(...args);if(input.mode==='after-executor')process.kill(process.pid,'SIGKILL');return r;}});
investigations.executeRecoveryPermit(input.actor,input.id,{permit:input.permit,workerId:'bounded-synthetic-worker'});
throw Error('Expected controlled process death');
