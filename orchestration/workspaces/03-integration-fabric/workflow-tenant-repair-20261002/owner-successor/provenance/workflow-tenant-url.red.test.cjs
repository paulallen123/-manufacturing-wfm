'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'workflow-tenant-original-source/.github/workflows/autonomous-integration-fabric.yml'),'utf8');
test('hosted new bootstrap uses the job-declared same origin as existing health/login',()=>{
 const job=source.slice(source.indexOf('\n  hosted-railway-proof:'));
 const declared=job.match(/^      (HOSTED_BASE_URL):\s*'([^']+)'/m);assert.ok(declared);
 const bootstrap=job.split('\n').find(l=>l.includes('/api/bootstrap'));assert.ok(bootstrap);
 const actual=bootstrap.match(/"\$([A-Z_]+)\/api\/bootstrap"/)?.[1];
 assert.equal(actual,declared[1],'New authenticated bootstrap must use declared hosted origin; WFM_BASE_URL is not declared in this job. No Bash execution is claimed.');
});
test('existing hosted health and login provide genuine declared-origin controls',()=>{
 const job=source.slice(source.indexOf('\n  hosted-railway-proof:'));
 assert.match(job,/"\$HOSTED_BASE_URL\/api\/health"/);assert.match(job,/"\$HOSTED_BASE_URL\/api\/login"/);assert.match(job,/set -euo pipefail/);
 assert.doesNotMatch(job,/(?:^\s*WFM_BASE_URL:|^\s*(?:export\s+)?WFM_BASE_URL=)/m);
});
