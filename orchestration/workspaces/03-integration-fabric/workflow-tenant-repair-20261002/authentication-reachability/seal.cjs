'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=__dirname,source=path.resolve('work/lane03-workflow-tenant');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const originalSeal=read(path.join(source,'review-seal.json'));
for(const r of originalSeal.files){const b=fs.readFileSync(path.join(source,r.path));if(b.length!==r.bytes||hash(b)!==r.sha256)throw Error('Original capsule mutated '+r.path);}
const bootstrap=fs.readFileSync(path.join(source,'provenance/security/runtime/bootstrap.cjs'),'utf8');
const workflow=fs.readFileSync(path.join(source,'preimages/.github/workflows/autonomous-integration-fabric.yml'),'utf8');
const numbered=(s,term)=>s.split('\n').flatMap((line,i)=>line.includes(term)?[{line:i+1,text:line}]:[]);
const observations={workBaselineSha:originalSeal.workBaselineSha,provenBaseSha:null,convergenceBaseSha:null,runtimeWired:false,originalSealSha256:hash(fs.readFileSync(path.join(source,'review-seal.json'))),original41ArtifactsUnchanged:true,sourceOnly:true,hostedVariablesFetched:false,executedProviderOrAuthenticationCalls:false,observations:{hostedCondition:numbered(bootstrap,'const hosted ='),passkeyConstruction:numbered(bootstrap,'if (hosted && !passkeyAuth)'),loginInterception:numbered(bootstrap,"requestPath(req) === '/api/login'"),status410:numbered(bootstrap,'res.statusCode = 410'),localHostedFlag:numbered(workflow,'-e WFM_HOSTED_STAGING=true'),loginStatusRequirement:numbered(workflow,'test "$login_code"')},qualification:'Frozen local job hosted flag plus passkey login interception implies independent pre-existing authentication precondition blocker. Hosted environment values not inspected; conditional same source guard only. Bounded tenant repair local tests remain valid; assembled workflow admission pending.'};
fs.writeFileSync(path.join(base,'source-observations.json'),JSON.stringify(observations,null,2)+'\n');
const files=['AUTHENTICATION_REACHABILITY.md','source-observations.json','seal.cjs'].map(p=>({path:p,bytes:fs.statSync(path.join(base,p)).size,sha256:hash(fs.readFileSync(path.join(base,p)))}));
fs.writeFileSync(path.join(base,'addendum-seal.json'),JSON.stringify({originalSealSha256:observations.originalSealSha256,files,sourceEdits:0,testsExecuted:0,githubMutations:0},null,2)+'\n');
console.log(JSON.stringify({original41ArtifactsUnchanged:true,originalSealSha256:observations.originalSealSha256,addendumSealSha256:hash(fs.readFileSync(path.join(base,'addendum-seal.json')))}));
