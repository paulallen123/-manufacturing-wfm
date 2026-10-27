'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),net=require('node:net');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createFederatedAuth}=require('/workspace/scratch/cd4e2bcb0821/http-startup-diagnosis/runtime/security-runtime/federated-auth.cjs');
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fed-wire-')),dbPath=path.join(dir,'test.sqlite'),db=new DatabaseSync(dbPath);
 db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER)');
 let external=0;const auth=createFederatedAuth({dbPath,env:{},fetchImpl:async()=>{external++;throw Error('NO_EXTERNAL_CALLS_ALLOWED');}});
 const server=http.createServer(async(req,res)=>{
  if(await auth.handleRequest(req,res))return;
  res.statusCode=req.url==='/api/health'?200:404;res.end(req.url==='/api/health'?'healthy':'not found');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));auth.close();db.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {db,external:()=>external,request:(target,method='GET')=>new Promise((resolve,reject)=>{
  const sock=net.connect(server.address().port,'127.0.0.1');let data='';sock.setTimeout(2000,()=>sock.destroy(Error('raw HTTP timeout')));sock.on('error',reject);sock.on('data',b=>data+=b);sock.on('end',()=>resolve(data));
  sock.on('connect',()=>sock.end(method+' '+target+' HTTP/1.1\r\nHost: vector.test\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
 })};
}
test('raw malformed targets are 400, never reflected, and server remains healthy after each',async t=>{
 const f=await fixture(t);
 for(const target of ['//[','http://[','//[::1','http://user:secret@[']){
  const res=await f.request(target);assert.match(res,/^HTTP\/1\.1 400 /);assert.match(res,/\{"error":"Invalid request URL\."\}/);assert.doesNotMatch(res,/secret|Set-Cookie:/i);assert.match(res,/Cache-Control: no-store/i);
  assert.match(await f.request('/api/health'),/^HTTP\/1\.1 200 /);
 }
 assert.equal(f.external(),0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM federated_auth_states').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);
});
test('disabled configuration refuses both providers start and callbacks over actual HTTP',async t=>{
 const f=await fixture(t);
 for(const provider of ['google','apple'])for(const step of ['start','callback']){
  const res=await f.request('/api/auth/federated/'+provider+'/'+step,provider==='apple'&&step==='callback'?'POST':'GET');
  assert.match(res,/^HTTP\/1\.1 503 /);assert.match(res,/This sign-in provider is not configured/);assert.doesNotMatch(res,/Set-Cookie:|Location:/i);
 }
 const providers=await f.request('/api/auth/federated/providers');assert.match(providers,/^HTTP\/1\.1 200 /);assert.match(providers,/\{"providers":\[\]\}/);
 assert.match(await f.request('/api/health'),/^HTTP\/1\.1 200 /);assert.equal(f.external(),0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);
});
