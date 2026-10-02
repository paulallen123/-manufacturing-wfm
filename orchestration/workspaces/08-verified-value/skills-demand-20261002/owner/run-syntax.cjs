'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),base=path.resolve('work/lane05-skills-demand');
const results=['learning/runtime/skills-demand-intelligence.cjs','learning/runtime/skills-demand-intelligence.test.cjs'].map(p=>{const r=spawnSync(process.execPath,['--check',p],{cwd:base,encoding:'utf8'});return{path:p,status:r.status,stdout:r.stdout,stderr:r.stderr};});fs.writeFileSync(base+'/evidence/syntax.json',JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
