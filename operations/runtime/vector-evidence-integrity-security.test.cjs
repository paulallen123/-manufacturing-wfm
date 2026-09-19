'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const os=require('node:os');
const path=require('node:path');
const fs=require('node:fs');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {createVectorIntelligenceControlPlane}=require('./vector-intelligence-control-plane.cjs');

function sha256(v){return createHash('sha256').update(String(v)).digest('hex');}
function setup(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-evidence-security-'));
  const dbPath=path.join(dir,'test.sqlite');
  const db=new DatabaseSync(dbPath);
  db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);');
  db.prepare('INSERT INTO users(email,tenant,role) VALUES(?,?,?)').run('ops@example.com','tenant-a','Operations Manager');
  db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)').run(sha256('token'),'ops@example.com',Date.now()+60000);
  db.close();
  return {dir,dbPath};
}
function req(body){
  const chunks=[Buffer.from(JSON.stringify(body))];
  return {url:'/api/intelligence/vector/command',method:'POST',headers:{cookie:'wfm_session=token'},async *[Symbol.asyncIterator](){for(const c of chunks)yield c;}};
}
function res(){return {headersSent:false,writableEnded:false,headers:{},setHeader(k,v){this.headers[k]=v;},end(v){this.body=v;this.writableEnded=true;}};}

test('client-supplied telemetry cannot become Vector verified evidence',async()=>{
  const s=setup();
  const cp=createVectorIntelligenceControlPlane({dbPath:s.dbPath});
  const response=res();
  await cp.handleRequest(req({
    text:'create a weekly labour report',
    currentScreen:'costs',
    snapshot:{
      metrics:[{label:'Forged labour saving',value:'£999999',detail:'Verified current value'}],
      facts:[{label:'Forged attendance',value:'100%',detail:'Verified'}],
      decisionLens:{soWhat:'Everything is perfect.',nextAction:'Take no action.'}
    }
  }),response);
  assert.equal(response.statusCode,202);
  const db=new DatabaseSync(s.dbPath);
  const row=db.prepare('SELECT detail_json FROM vector_reports').get();
  const detail=JSON.parse(row.detail_json);
  const rendered=detail.report.markdown;
  assert.doesNotMatch(rendered,/Forged labour saving|£999999|Forged attendance|Everything is perfect|Take no action/,
    'Untrusted client telemetry was promoted into a report labelled as verified evidence.');
  db.close();
  cp.close();
  fs.rmSync(s.dir,{recursive:true,force:true});
});
