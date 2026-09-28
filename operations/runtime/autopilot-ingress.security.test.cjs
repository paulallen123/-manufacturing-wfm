'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {createAutopilotExecutionEngine}=require('./autopilot-execution-engine.cjs');

async function setup(t,role='manager'){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-ingress-')),dbPath=path.join(dir,'proof.sqlite');
  const db=new DatabaseSync(dbPath),token='isolated-security-regression-token';
  db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);CREATE TABLE vector_decision_episodes(tenant TEXT,episode_id TEXT,episode_json TEXT);');
  db.prepare('INSERT INTO users VALUES(?,?,?)').run('manager@example.invalid','proof-tenant',role);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),'manager@example.invalid',Date.now()+60000);
  const engine=createAutopilotExecutionEngine({dbPath,publicOrigin:'https://vector.example.invalid'});
  const server=http.createServer(async(req,res)=>{if(!await engine.handleRequest(req,res)){res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));engine.close();db.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {db,url:'http://127.0.0.1:'+server.address().port,cookie:'wfm_session='+token};
}
for(const scenario of [
  {name:'cross-origin',origin:'https://attacker.invalid',type:'application/json',expected:403},
  {name:'missing origin',type:'application/json',expected:403},
  {name:'non-JSON simple request',origin:'https://vector.example.invalid',type:'text/plain',expected:415},
  {name:'authorised origin retains permit validation',origin:'https://vector.example.invalid',type:'application/json',expected:404}
]) test(scenario.name,async t=>{
  const {db,url,cookie}=await setup(t);
  const response=await fetch(url+'/api/operations/autopilot/execute',{method:'POST',headers:{cookie,'content-type':scenario.type,...(scenario.origin?{origin:scenario.origin}:{})},body:JSON.stringify({permitId:'nonexistent',contextRevision:'proof'})});
  assert.equal(response.status,scenario.expected);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vector_autopilot_execution_events').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vector_autopilot_permits').get().n,0);
});
test('unknown roles fail closed',async t=>{
  const {url,cookie}=await setup(t,'unknown-role');
  const response=await fetch(url+'/api/operations/autopilot/status',{headers:{cookie}});
  assert.equal(response.status,403);
});
