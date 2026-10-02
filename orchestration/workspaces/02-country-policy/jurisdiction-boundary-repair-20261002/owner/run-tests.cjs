const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const label=process.argv[2]||'tests',files=fs.readdirSync(path.join(__dirname,'policy/runtime')).filter(f=>f.endsWith('.test.cjs')).map(f=>path.join(__dirname,'policy/runtime',f));
const r=spawnSync(process.execPath,['--require',path.resolve(__dirname,'../trust_review/network-guard.cjs'),'--test',...files],{encoding:'utf8'});
fs.writeFileSync(path.join(__dirname,'evidence',label+'.log'),JSON.stringify({node:process.version,args:files,exit:r.status,networkGuard:'../trust_review/network-guard.cjs'})+'\n'+r.stdout+r.stderr);process.stdout.write(r.stdout+r.stderr);process.exitCode=r.status;
