'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Readable}=require('node:stream');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {createMobileSessionService}=require('./mobile-session-service.cjs');
function sha(v){return createHash('sha256').update(String(v)).digest('hex');}
function req(method,headers={}){const r=Readable.from([]);r.method=method;r.url='/api/mobile/session';r.headers=headers;return r;}
function res(){return{statusCode:200,headers:{},body:'',setHeader(k,v){this.headers[k]=v;},end(v=''){this.body+=String(v);this.writableEnded=true;},get headersSent(){return false;}};}
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vecta-mobile-session-'));
  const dbPath=path.join(dir,'db.sqlite');
  const db=new DatabaseSync(dbPath);
  db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);');
  db.prepare('INSERT INTO users VALUES(?,?,?)').run('manager@example.test','alpha','manager');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha('web-session'),'manager@example.test',Date.now()+60000);
  db.close();
  return {dir,dbPath};
}
test('fresh web login can mint a distinct revocable mobile bearer session',async()=>{
  const {dir,dbPath}=fixture();
  const service=createMobileSessionService({dbPath,ttlMs:3600000});
  const out=res();
  await service.handleRequest(req('POST',{cookie:'wfm_session=web-session'}),out);
  assert.equal(out.statusCode,201);
  const body=JSON.parse(out.body);
  assert.match(body.accessToken,/^vmb_/);
  assert.notEqual(body.accessToken,'web-session');
  const db=new DatabaseSync(dbPath);
  const hash=sha(body.accessToken);
  assert.ok(db.prepare('SELECT 1 FROM sessions WHERE token_hash=?').get(hash));
  assert.equal(db.prepare('SELECT tenant FROM mobile_device_sessions WHERE token_hash=?').get(hash).tenant,'alpha');
  db.close();
  const gone=res();
  await service.handleRequest(req('DELETE',{authorization:'Bearer '+body.accessToken}),gone);
  assert.equal(gone.statusCode,204);
  const check=new DatabaseSync(dbPath);
  assert.equal(check.prepare('SELECT 1 FROM sessions WHERE token_hash=?').get(hash),undefined);
  assert.ok(check.prepare('SELECT revoked_at FROM mobile_device_sessions WHERE token_hash=?').get(hash).revoked_at);
  check.close();
  service.close();fs.rmSync(dir,{recursive:true,force:true});
});
test('bearer token cannot mint another bearer token',async()=>{
  const {dir,dbPath}=fixture();
  const service=createMobileSessionService({dbPath});
  const out=res();
  await service.handleRequest(req('POST',{cookie:'wfm_session=web-session',authorization:'Bearer vmb_abcdefghijklmnopqrstuvwxyzABCDEFGH'}),out);
  assert.equal(out.statusCode,400);
  service.close();fs.rmSync(dir,{recursive:true,force:true});
});
