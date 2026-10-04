'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');
const sealedRoot=process.env.VECTOR_SEALED_PROOF_ROOT||path.resolve(__dirname,'../../advisory/recovery-regression/sealed-recovery-proof');
function run(mode,phase){const r=spawnSync(process.execPath,[path.join(__dirname,'degraded-recovery-child.mjs'),mode,phase],{env:{...process.env,SEALED_PROOF_ROOT:sealedRoot,TAR_OPTIONS:'--no-same-owner'},encoding:'utf8',timeout:15000});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
for(const mode of ['credential-expired','critical-freshness'])for(const phase of ['before-issue','after-issue'])test(`${mode} at ${phase} blocks stale recovery authority`,()=>{
 const v=run(mode,phase);assert.equal(v.outcome,'blocked');assert.equal(v.error.code,'WFM_PROVIDER_RECOVERY_STALE_EVIDENCE');assert.equal(v.consumedGrants,0);assert.equal(v.issuedGrants,phase==='after-issue'?1:0);assert.equal(v.state,'retry');assert.equal(v.providerNetworkCall,false);assert.equal(v.businessMutation,false);if(phase==='before-issue')assert.equal(v.evidenceDigestUnchanged,false);
});
test('unavailable provider evidence blocks before grant issuance',()=>{const v=run('evidence-unavailable','before-issue');assert.equal(v.outcome,'blocked');assert.equal(v.error.status,503);assert.equal(v.issuedGrants,0);assert.equal(v.consumedGrants,0);assert.equal(v.state,'retry');});
test('unchanged permitted health retains bounded lease-only recovery',()=>{const v=run('normal','before-issue');assert.equal(v.outcome,'lease-reacquired');assert.equal(v.issuedGrants,1);assert.equal(v.consumedGrants,1);assert.equal(v.state,'running');assert.equal(v.providerNetworkCall,false);assert.equal(v.businessMutation,false);});
