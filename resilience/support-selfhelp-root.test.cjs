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

for(const mutation of ['delete-session','demote-role'])test('root HTTP heldout: streamed question rechecks '+mutation,async t=>{
 const {url,request,db}=await fixture(t);await request();
 const result=new Promise((resolve,reject)=>{
  const req=http.request(url,{method:'POST',headers:{Origin:'https://vector.example','Content-Type':'application/json',Cookie:'wfm_session=a'}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);
  req.write('{"text":');setTimeout(()=>{if(mutation==='delete-session')db.prepare('DELETE FROM sessions WHERE email=?').run('a@example.invalid');else db.prepare('UPDATE users SET role=? WHERE email=?').run('employee','a@example.invalid');req.end('"SAP provider certification"}');},30);
 });const resultValue=await result;assert.equal(resultValue.status,401);assert.doesNotMatch(resultValue.body,/separately authorised provider test/);
});
test('root HTTP heldout: deleted user cannot inherit another tenant and unknown role cannot fall through',async t=>{
 const {request,db}=await fixture(t);await request();db.prepare('DELETE FROM users WHERE email=?').run('a@example.invalid');assert.equal((await request()).status,401);
 for(const role of ['support','toString','__proto__','Admin','employee ']){db.prepare('UPDATE users SET role=? WHERE email=?').run(role,'unknown@example.invalid');assert.equal((await request({text:'SAP provider certification'},{},'unknown')).status,401);}
 assert.equal((await request({text:'payroll review'},{},'b')).status,200);
});
test('root HTTP heldout: chunked oversized stream fails closed without a question echo',async t=>{
 const {url}=await fixture(t);const result=await new Promise((resolve,reject)=>{
  const req=http.request(url,{method:'POST',headers:{Origin:'https://vector.example','Content-Type':'application/json',Cookie:'wfm_session=a'}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);req.write('{"text":"');req.write('private-question-'.repeat(600));req.end('"}');
 });assert.equal(result.status,413);assert.doesNotMatch(result.body,/private-question/);
});
