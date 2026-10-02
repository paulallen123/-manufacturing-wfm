'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const base=__dirname,label=process.argv[2],scope=process.argv[3]||'source',files=process.argv.slice(4);
const args=['--require',path.join(base,'network-guard.cjs'),'--test',...(files.length?files:[path.join(base,'independent.held-out.test.mjs')])];
const started=new Date().toISOString(),r=spawnSync(process.execPath,args,{cwd:path.join(base,scope),encoding:'utf8',timeout:60000,env:{...process.env,LANE04_REVIEW_SCOPE:scope}});
fs.mkdirSync(path.join(base,'evidence'),{recursive:true});
fs.writeFileSync(path.join(base,'evidence',label+'.tap'),r.stdout+r.stderr,'utf8');
const receipt={label,scope,started,completed:new Date().toISOString(),node:process.version,executable:process.execPath,args,exitCode:r.status,error:r.error?.message||null,summary:r.stdout.split('\n').filter(x=>/^# (tests|pass|fail|cancelled|skipped|todo|duration)/.test(x)),qualification:'Local actual imported source functions with exact frozen dependencies, guarded against real network. Synthetic supplied authority/status/source references are unauthenticated fixtures; no provider/tenant/runtime proof.'};
fs.writeFileSync(path.join(base,'evidence',label+'.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));process.exitCode=r.status??1;
