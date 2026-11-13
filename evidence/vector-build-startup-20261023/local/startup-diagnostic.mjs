import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {createAttendanceRuntime} from './source/verification/vector-repair-20260921/attendance-runtime-harness.mjs';
const root=path.resolve(import.meta.dirname,'source');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-startup-diagnostic-'));
const runtime=path.join(dir,'runtime');
const t=performance.now();
execFileSync(process.execPath,[path.join(root,'scripts/compose-vector-local-runtime.mjs'),runtime],{cwd:root,stdio:'pipe'});
const result={node:process.version,compositionMs:performance.now()-t,scope:'Local synthetic startup timing; not hosted build proof'};
const timingFile=path.join(dir,'timing.json');
fs.appendFileSync(path.join(runtime,'local-paths.cjs'),`\n;{const started=performance.now(),crypto=require('node:crypto'),scrypt=crypto.scryptSync,http=require('node:http'),listen=http.Server.prototype.listen;let calls=0,elapsed=0;crypto.scryptSync=function(...args){const t=performance.now();try{return scrypt.apply(this,args)}finally{calls++;elapsed+=performance.now()-t}};http.Server.prototype.listen=function(...args){fs.writeFileSync(${JSON.stringify(timingFile)},JSON.stringify({beforeListenMs:performance.now()-started,scryptCalls:calls,scryptMs:elapsed}));return listen.apply(this,args)}}\n`);
const harness=createAttendanceRuntime({runtime,database:path.join(dir,'state.sqlite')});
try{const s=performance.now();await harness.start();result.firstReadyMs=performance.now()-s;result.first=JSON.parse(fs.readFileSync(timingFile));await harness.stop();const r=performance.now();await harness.start();result.restartReadyMs=performance.now()-r;result.restart=JSON.parse(fs.readFileSync(timingFile));}
catch(error){result.error=String(error);if(fs.existsSync(timingFile))result.partial=JSON.parse(fs.readFileSync(timingFile));}
finally{await harness.stop();fs.rmSync(dir,{recursive:true,force:true});}
fs.writeFileSync(path.join(import.meta.dirname,'startup-timing.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
