'use strict';
// Isolated cross-module journey. Uses real WebAuthn cryptography and the sealed
// compiler; synthetic signing authority/empty tenant are not live customer proof.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Readable}=require('node:stream'),{DatabaseSync}=require('node:sqlite'),{createHash,createHmac}=require('node:crypto');
const {createIdentitySurvivalGuard}=require('./identity-survival-guard.cjs');
const {createPasskeyAuth}=require('./passkey-auth.cjs');
const {authenticator}=require('./test-support/authenticator.cjs');
const {createOneDayEnterpriseEngine}=require('../../implementation/runtime/one-day-enterprise-engine.cjs');
const digest=value=>createHash('sha256').update(value).digest('hex');

for(const provider of ['test-provider','docusign'])test(provider==='docusign'?'stored order nominee enrols with real passkey and resumes the permanent reviewed workspace':'new signed owner enrols, signs in and resumes the one permanent reviewed workspace',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-new-owner-')),dbPath=path.join(dir,'state.sqlite'),db=new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE tenants(id TEXT PRIMARY KEY,version INTEGER NOT NULL,state TEXT NOT NULL);
    CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL);
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);`);
  let completedEnvelope='stored-envelope';
  const origin='https://vector.test',owner='new.owner@example.invalid',secret='test-signing-key',messages=[];
  const guard=createIdentitySurvivalGuard({dbPath});
  const auth=createPasskeyAuth({dbPath,publicOrigin:origin,hosted:false,nodeEnv:'production'});
  const engine=createOneDayEnterpriseEngine({dbPath,agentsApiEnabled:false,publicOrigin:origin,notificationRetryPollMs:0,
    candidateSha:'a'.repeat(40),deploymentId:'isolated-new-owner',contractWebhookSecret:'test-webhook',internalToken:'test-internal',invitationRecoverySecret:'isolated-invitation-recovery-key',
    configurationCompiler:require('../../implementation/runtime/test-support/sealed-compiler.cjs')(t),
    verifySignedContract({rawBody,headers}){
      assert.equal(headers['x-test-signature'],createHmac('sha256',secret).update(rawBody).digest('hex'));
      assert.equal(JSON.parse(rawBody).eventId,'signed-first');
      if(provider==='docusign')return {verified:true,provider:'docusign',status:'completed',eventId:completedEnvelope+'-completed',envelopeId:completedEnvelope,signerEmail:'different.signer@example.invalid',tenant:'forged-tenant',ownerEmail:'forged.owner@example.invalid'};
      return {verified:true,ownerAuthorized:true,customerId:'customer-one',customerAuthorityRef:'test-crm-customer-one',tenant:'new-tenant',provider:'test-provider',eventId:'signed-first',contractRef:'first-contract',relationship:'initial',ownerEmail:owner,ownerAuthorityRef:'test-signed-owner',profile:{organisationName:'New Works'}};
    },
    createCanonicalTenant({db,binding}){db.prepare('INSERT INTO tenants VALUES(?,?,?)').run(binding.tenant,1,'{}');},
    provisionInitialOwner({db,tenant,email,role,costs,permissions}){db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run(email,tenant,'',role,costs,'disabled','00',JSON.stringify(permissions));},
    async sendInvitation(message){messages.push(message);return {provider:'test-delivery',messageId:'message-one'};}
  });
  t.after(()=>{engine.close();auth.close();guard.securityControlForTests().db.close();db.close();fs.rmSync(dir,{recursive:true,force:true});});
  async function request(url,body={},cookie='',headers={},method='POST'){
    const raw=JSON.stringify(body),req=Readable.from(method==='GET'?[]:[raw]);req.method=method;req.url=url;req.socket={};
    req.headers={origin,'content-type':'application/json','x-forwarded-proto':'https',cookie,...headers};
    const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(value){this.text=String(value);this.writableEnded=true;}};
    if(url.startsWith('/api/passkeys/'))await auth.handleRequest(req,res);
    else if(url.endsWith('/contract-signed')||!guard.beforeRequest(req,res))await engine.handleRequest(req,res);
    return {status:res.statusCode,body:JSON.parse(res.text||'{}'),cookies:[res.headers['set-cookie']||[]].flat().map(x=>x.split(';')[0]).filter(x=>!x.endsWith('=')).join('; ')};
  }
  const signBody={eventId:'signed-first'},signHeaders={'x-wfm-contract-webhook':'test-webhook','x-test-signature':createHmac('sha256',secret).update(JSON.stringify(signBody)).digest('hex')};
  if(provider==='docusign')engine.recordCustomerOrder({orderId:'stored-order',expectedRevision:0,orderAuthorized:true,ownerAuthorized:true,orderAuthorityRef:'synthetic-vector-order',customerId:'customer-one',customerAuthorityRef:'synthetic-vector-register',tenant:'new-tenant',provider:'docusign',envelopeId:completedEnvelope,contractRef:'first-contract',relationship:'initial',nominatedSuperUserEmail:owner,nominationAuthorityRef:'customer-nomination',profile:{organisationName:'New Works'}});
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,0);
  assert.equal((await request('/api/implementation/autonomous/contract-signed',signBody,'',signHeaders)).status,201);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);
  const user=db.prepare('SELECT * FROM users').get();assert.equal(user.email,owner);assert.equal(user.person_id,'');assert.equal(user.costs,0);
  const invitation=new URL(messages[0].startUrl).searchParams.get('implementation_invite');
  const options=await request('/api/passkeys/register/options',{invitation});assert.equal(options.status,200,JSON.stringify(options.body));
  const device=authenticator(options.body);
  const enrolled=await request('/api/passkeys/register/verify',{invitation,response:device.registration},options.cookies);assert.equal(enrolled.status,200,JSON.stringify(enrolled.body));
  db.exec('DELETE FROM sessions'); // prove subsequent access uses fresh real sign-in
  const loginOptions=await request('/api/passkeys/authenticate/options');
  const login=await request('/api/passkeys/authenticate/verify',{response:device.assertion(loginOptions.body)},loginOptions.cookies);assert.equal(login.status,200,JSON.stringify(login.body));
  const answers={organisation:{name:'New Works',countries:['UK'],sites:[{code:'ONE',name:'First Factory',timezone:'UTC'}]},workforce:{count:10,languages:['en'],shiftPatterns:1},capabilities:{modules:['core'],trainingRoles:['manager']},connections:{timing:'later',systems:[]}};
  const setup='/api/implementation/autonomous/setup';
  const setupBinding=(await request(setup,{},login.cookies,{},'GET')).body.setupBinding;
  const saved=await request(setup,{setupBinding,expectedRevision:0,answers},login.cookies);assert.equal(saved.status,200,JSON.stringify(saved.body));
  const applied=await request(setup+'/apply',{setupBinding,expectedRevision:saved.body.revision,reviewToken:saved.body.reviewToken},login.cookies);assert.equal(applied.status,200,JSON.stringify(applied.body));assert.equal(applied.body.questionnaireComplete,true);
  const completedAt=applied.body.completedAt,workspace=db.prepare('SELECT * FROM customer_workspaces').get(),namespace=db.prepare('SELECT namespace FROM tenant_environments').get().namespace;
  assert.equal((await request('/api/implementation/autonomous/contract-signed',signBody,'',signHeaders)).status,200);
  const replay=await request(setup+'/apply',{setupBinding,expectedRevision:saved.body.revision,reviewToken:saved.body.reviewToken},login.cookies);assert.equal(replay.status,200);assert.equal(replay.body.completedAt,completedAt);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM customer_workspaces').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM implementation_runs').get().n,1);assert.equal(messages.length,1);
  assert.equal(db.prepare('SELECT namespace FROM tenant_environments').get().namespace,namespace);assert.equal(replay.body.runId,workspace.initial_run_id);
  const amendment=await request(setup,{setupBinding,expectedRevision:replay.body.revision,answers:{...answers,organisation:{...answers.organisation,name:'Updated Works'},workforce:{...answers.workforce,count:12}}},login.cookies);
  assert.equal(amendment.status,200);assert.equal(amendment.body.questionnaireComplete,true);assert.equal(amendment.body.completedAt,completedAt);
  const amended=await request(setup+'/apply',{setupBinding,expectedRevision:amendment.body.revision,reviewToken:amendment.body.reviewToken},login.cookies);
  assert.equal(amended.status,200,JSON.stringify(amended.body));assert.equal(amended.body.completedAt,completedAt);
  assert.equal(JSON.parse(db.prepare('SELECT configuration_json FROM tenant_environments').get().configuration_json).companyName,'Updated Works');
  assert.equal(db.prepare('SELECT namespace FROM tenant_environments').get().namespace,namespace);
  if(provider==='docusign'){
    const receipt=db.prepare('SELECT * FROM customer_workspace_invitation_bindings').get();assert.equal(receipt.workspace_id,workspace.workspace_id);assert.equal(receipt.order_revision,1);assert.equal(receipt.nomination_revision,1);
    assert.equal(JSON.parse(db.prepare('SELECT profile_json FROM organisation_access_setup').get().profile_json).organisationName,'New Works');
    const tables=['users','implementation_runs','tenant_environments','workspace_setup_drafts','workspace_setup_events','passkey_credentials'];const snapshot=()=>tables.map(table=>db.prepare('SELECT * FROM '+table).all()),before=snapshot();
    engine.revokeCustomerNomination({orderId:'stored-order',expectedRevision:1,reasonRef:'customer-withdrawal'});
    assert.equal((await request('/api/implementation/autonomous/contract-signed',signBody,'',signHeaders)).status,403);
    completedEnvelope='revoked-renewal';
    engine.recordCustomerOrder({orderId:'stored-renewal',expectedRevision:0,orderAuthorized:true,ownerAuthorized:true,orderAuthorityRef:'synthetic-renewal',customerId:'customer-one',customerAuthorityRef:'synthetic-vector-register',tenant:'new-tenant',provider:'docusign',envelopeId:completedEnvelope,contractRef:'renewal-contract',relationship:'renewal',existingWorkspaceId:workspace.workspace_id,nominatedSuperUserEmail:owner,nominationAuthorityRef:'customer-nomination'});
    assert.equal((await request('/api/implementation/autonomous/contract-signed',signBody,'',signHeaders)).status,403);
    assert.ok([401,403].includes((await request(setup+'/apply',{setupBinding,expectedRevision:saved.body.revision,reviewToken:saved.body.reviewToken},login.cookies)).status));
    assert.equal((await request('/api/passkeys/register/options',{invitation})).status,401);assert.deepEqual(snapshot(),before);assert.equal(messages.length,1);
  }
  db.prepare('UPDATE users SET permissions=? WHERE email=?').run('[]',owner);
  assert.ok([401,403].includes((await request(setup+'/apply',{setupBinding,expectedRevision:saved.body.revision,reviewToken:saved.body.reviewToken},login.cookies)).status));
  assert.equal(db.prepare('SELECT completed_at FROM workspace_setup_drafts').get().completed_at,completedAt);
  assert.equal((await request('/api/passkeys/register/options',{invitation})).status,401);
});

for(const change of ['nomination','revocation'])test('stored order '+change+' invalidates an outstanding real passkey challenge',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-order-passkey-')),dbPath=path.join(dir,'state.sqlite'),db=new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE tenants(id TEXT PRIMARY KEY,version INTEGER NOT NULL,state TEXT NOT NULL);
    CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL);
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);`);
  const origin='https://vector.test',owner='nominated.owner@example.invalid',messages=[];
  const guard=createIdentitySurvivalGuard({dbPath}),auth=createPasskeyAuth({dbPath,publicOrigin:origin,hosted:false,nodeEnv:'test'});
  const engine=createOneDayEnterpriseEngine({dbPath,agentsApiEnabled:false,publicOrigin:origin,notificationRetryPollMs:0,contractWebhookSecret:'synthetic-hook',invitationRecoverySecret:'synthetic-recovery',
    verifySignedContract:()=>({verified:true,provider:'docusign',status:'completed',eventId:'completed',envelopeId:'envelope-1'}),
    createCanonicalTenant({db,binding}){db.prepare('INSERT INTO tenants VALUES(?,?,?)').run(binding.tenant,1,'{}');},
    provisionInitialOwner({db,tenant,email,role,costs,permissions}){db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run(email,tenant,'',role,costs,'disabled','00',JSON.stringify(permissions));},
    sendInvitation:async message=>{messages.push(message);return {provider:'synthetic-delivery'};}});
  t.after(()=>{engine.close();auth.close();guard.securityControlForTests().db.close();db.close();fs.rmSync(dir,{recursive:true,force:true});});
  const order={orderId:'order-1',expectedRevision:0,orderAuthorized:true,ownerAuthorized:true,orderAuthorityRef:'synthetic-register-order',customerId:'one',customerAuthorityRef:'synthetic-register-customer',tenant:'one',provider:'docusign',envelopeId:'envelope-1',contractRef:'contract-1',relationship:'initial',nominatedSuperUserEmail:owner,nominationAuthorityRef:'customer-nomination-1',profile:{organisationName:'Registered Works'}};
  engine.recordCustomerOrder(order);
  async function request(url,body,cookie=''){
    const req=Readable.from([JSON.stringify(body)]);req.method='POST';req.url=url;req.socket={};req.headers={origin,'content-type':'application/json','x-forwarded-proto':'https',cookie,'x-wfm-contract-webhook':'synthetic-hook'};
    const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(value){this.text=String(value);this.writableEnded=true;}};
    await (url.startsWith('/api/passkeys/')?auth:engine).handleRequest(req,res);
    return {status:res.statusCode,body:JSON.parse(res.text||'{}'),cookie:[res.headers['set-cookie']||[]].flat().map(x=>x.split(';')[0]).join('; ')};
  }
  assert.equal((await request('/api/implementation/autonomous/contract-signed',{})).status,201);
  const invitation=new URL(messages[0].startUrl).searchParams.get('implementation_invite'),options=await request('/api/passkeys/register/options',{invitation});assert.equal(options.status,200);
  const device=authenticator(options.body);
  if(change==='nomination')engine.recordCustomerOrder({...order,expectedRevision:1,envelopeId:'envelope-2',contractRef:'contract-2',nominatedSuperUserEmail:'replacement.owner@example.invalid',nominationAuthorityRef:'customer-nomination-2'});
  else engine.revokeCustomerNomination({orderId:'order-1',expectedRevision:1,reasonRef:'customer-withdrawal'});
  assert.equal((await request('/api/passkeys/register/verify',{invitation,response:device.registration},options.cookie)).status,401);
  assert.equal((await request('/api/passkeys/register/options',{invitation})).status,401);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM passkey_credentials').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);
  assert.equal(db.prepare('SELECT status FROM implementation_invitations').get().status,'REVOKED');assert.equal(db.prepare('SELECT COUNT(*) n FROM implementation_runs').get().n,1);assert.equal(messages.length,1);
});
