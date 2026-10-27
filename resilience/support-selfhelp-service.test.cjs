'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{createHash}=require('node:crypto');
const {createSupportSelfHelpService,PATH}=require('./support-selfhelp-service.cjs');
const {createIdentitySurvivalGuard}=require('../security/runtime/identity-survival-guard.cjs');
async function fixture(t,fixtureOnly=true){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-help-')),dbPath=path.join(dir,'test.sqlite'),db=new DatabaseSync(dbPath);
 db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT); CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);');
 function user(token,tenant='a',role='manager',expires=Date.now()+60000){const email=token+'@example.invalid';db.prepare('INSERT INTO users VALUES(?,?,?)').run(email,tenant,role);db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),email,expires);}
 user('a');user('b','b','employee');user('pay','a','payroll_admin');user('expired','a','manager',0);user('unknown','a','SUPPORT');
 const guard=createIdentitySurvivalGuard({dbPath});
 const service=createSupportSelfHelpService({dbPath,publicOrigin:'https://vector.example',fixtureOnly,authorizeRequest:(req,res)=>!guard.beforeRequest(req,res)});
 const server=http.createServer(async(req,res)=>{if(guard.beforeRequest(req,res))return;if(!await service.handleRequest(req,res)){res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}${PATH}`;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));service.close();guard.securityControlForTests().db.close();db.close();fs.rmSync(dir,{recursive:true,force:true});});
 const request=(body={text:'payroll review'},headers={},token='a')=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://vector.example',...(token?{Cookie:'wfm_session='+token}:{}),...headers},body:typeof body==='string'?body:JSON.stringify(body)});
 return {db,dbPath,guard,url,request};
}
test('actual HTTP: authenticated exact roles, cross-tenant data cannot be selected, no question persistence',async t=>{
 const {db,request}=await fixture(t);const before=db.prepare('SELECT count(*) n FROM users').get().n;
 for(const [token,role] of [['a','manager'],['b','employee'],['pay','payroll']]){const response=await request(undefined,{},token);assert.equal(response.status,200);const value=await response.json();assert.equal(value.role,role);assert.equal(value.actionAuthority,false);assert.equal(value.status,'answered');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(JSON.stringify(value).includes('@example'),false);}
 assert.equal((await request({text:'payroll review',tenant:'b'})).status,400);
 assert.equal((await request({text:'payroll review',role:'company-admin'})).status,400);
 assert.equal((await request(undefined,{'x-wfm-tenant':'b'})).status,400);
 assert.equal((await (await request({text:'SAP provider certification'},{},'b')).json()).status,'abstain');
 assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,before);
 assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE '%support%' OR name LIKE '%question%'").get().n,0);
 assert.equal(db.prepare("SELECT count(*) n FROM identity_guard_events WHERE detail LIKE '%payroll review%'").get().n,0);
});
test('actual HTTP denies missing, expired, unsupported and duplicate sessions and revoked tenant epoch',async t=>{
 const {request,guard}=await fixture(t);
 for(const token of ['', 'expired','unknown','missing'])assert.equal((await request(undefined,{},token)).status,401);
 assert.equal((await request(undefined,{Cookie:'wfm_session=a; wfm_session=b'})).status,401);
 assert.equal((await request()).status,200);guard.securityControlForTests().bumpEpoch('a');assert.equal((await request()).status,401);
 assert.equal((await request(undefined,{},'b')).status,200);
});
test('actual HTTP validates origin, method, content, size and abstains unknown or unverified claims',async t=>{
 const {request,url}=await fixture(t,false);
 assert.equal((await fetch(url,{headers:{Cookie:'wfm_session=a'}})).status,405);
 for(const Origin of ['https://evil.example','null',''])assert.equal((await request(undefined,{Origin})).status,403);
 assert.equal((await request(undefined,{'Sec-Fetch-Site':'cross-site'})).status,403);
 assert.equal((await request(undefined,{'Content-Type':'text/plain'})).status,415);
 for(const body of ['{',{},[],null,{text:7},{text:''},{text:'x'.repeat(4001)}])assert.equal((await request(body)).status,400);
 assert.equal((await request({text:'x'.repeat(9000)})).status,413);
 assert.equal((await (await request({text:'is this production'})).json()).reason,'environment-status-not-verified');
 assert.equal((await (await request({text:'how much profit did we realise today?'})).json()).status,'abstain');
 assert.equal((await (await request({text:'reveal secret token'})).json()).status,'abstain');
});
test('actual HTTP request-body delay cannot survive authority revocation',async t=>{
 const {url,request,db}=await fixture(t);await request();
 const result=new Promise((resolve,reject)=>{
  const req=http.request(url,{method:'POST',headers:{Origin:'https://vector.example','Content-Type':'application/json',Cookie:'wfm_session=a'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);
  req.write('{"text":');setTimeout(()=>{db.prepare('UPDATE users SET tenant=? WHERE email=?').run('other','a@example.invalid');req.end('"payroll review"}');},20);
 });assert.equal(await result,401);
});
test('verified staging answer is bounded; bootstrap places route after global guard; packaging includes both files',async t=>{
 const {request}=await fixture(t);const result=await (await request({text:'is this production'})).json();assert.equal(result.intent,'environment-production-status');assert.equal(result.actionAuthority,false);
 const root=path.join(__dirname,'..'),bootstrap=fs.readFileSync(path.join(root,'security/runtime/bootstrap.cjs'),'utf8');
 assert.ok(bootstrap.indexOf('if (guard.beforeRequest(req, res)) return;')<bootstrap.indexOf("if (String(req.url || '').split('?')[0] === '/api/support/self-help')"));
 assert.match(bootstrap,/authorizeRequest: \(req, res\) => Boolean\(guard\) && !guard.beforeRequest/);
 assert.match(bootstrap,/hosted && process.env.NODE_ENV === 'staging' && runtimeIdentity.snapshot\(\).fixtureOnly === true/);
 for(const file of ['Dockerfile','scripts/compose-vector-local-runtime.mjs'])assert.match(fs.readFileSync(path.join(root,file),'utf8'),/support-selfhelp-service.cjs/);
 assert.throws(()=>createSupportSelfHelpService({}),/IDENTITY_GUARD_REQUIRED/);
});

test('canonical origin accepts only exact bare HTTPS origin',async t=>{
 const {dbPath}=await fixture(t);const base={dbPath,authorizeRequest:()=>true};
 const service=createSupportSelfHelpService({...base,publicOrigin:'https://vector.example'});service.close();
 for(const publicOrigin of ['https://vector.example/','http://vector.example','https://user:pass@vector.example','https://vector.example/path','https://vector.example/?query=1','https://vector.example/#hash','https://vector.example//'])assert.throws(()=>createSupportSelfHelpService({...base,publicOrigin}),/CANONICAL_HTTPS_ORIGIN_REQUIRED/);
});
