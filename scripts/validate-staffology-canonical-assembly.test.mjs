import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';

const root=fileURLToPath(new URL('../',import.meta.url));
const temporary=mkdtempSync(join(tmpdir(),'staffology-status-contract-'));
const current='staffology:{...staffologyIntegration.status(),operation:{...staffologyOperations.status(a),configurationError:staffologyConfigurationError}}';
let server, assertion;

before(()=>{
 const extracted=spawnSync('tar',['--no-same-owner','-xzf',join(root,'artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz'),'-C',temporary],{encoding:'utf8',timeout:120000});
 assert.equal(extracted.status,0,`Extraction failed: ${extracted.stderr}`);
 const result=spawnSync(process.execPath,[join(root,'scripts/compose-vector-local-runtime.mjs'),temporary],{cwd:root,encoding:'utf8',timeout:120000});
 assert.equal(result.status,0,`Composition failed: ${result.stderr}`);
 server=readFileSync(join(temporary,'server.cjs'),'utf8');
 assert.equal(server.split(current).length,2,'expected one actor-scoped Staffology report');
 const validator=readFileSync(join(root,'scripts/validate-staffology-canonical-assembly.mjs'),'utf8');
 const lines=validator.split('\n').filter(line=>line.includes('assert.match(server,')&&line.includes('Staffology status is missing from the existing integration report'));
 assert.equal(lines.length,1,'expected the actual validator status assertion');
 assertion=lines[0];
});
after(()=>rmSync(temporary,{recursive:true,force:true}));

function accepts(source){
 try{runInNewContext(assertion,{assert,server:source},{timeout:1000});return true;}
 catch(error){if(error.code==='ERR_ASSERTION')return false;throw error;}
}

test('actual assembly validator accepts the current composed actor-scoped report',()=>{
 assert.equal(accepts(server),true,'current composed status must pass the validator');
});

for(const [name,replacement] of [
 ['obsolete flat operation','staffology:{...staffologyIntegration.status(),operation:staffologyOperations.status()}'],
 ['missing actor',current.replace('status(a)','status()')],
 ['different actor',current.replace('status(a)','status(other)')],
 ['null actor',current.replace('status(a)','status(null)')],
 ['missing configuration error',current.replace(',configurationError:staffologyConfigurationError','')],
 ['different configuration binding',current.replace(':staffologyConfigurationError',':otherConfigurationError')],
 ['missing integration status',current.replace('...staffologyIntegration.status(),','')]
])test(`actual assembly validator refuses ${name}`,()=>{
 assert.equal(accepts(server.replace(current,replacement)),false,`${name} must not satisfy the status contract`);
});
