'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const vm=require('node:vm');
const {Readable}=require('node:stream');
const http=require('node:http'),{spawn}=require('node:child_process'),{DatabaseSync}=require('node:sqlite');
const {randomBytes}=require('node:crypto');
const root=path.resolve(__dirname,'..'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const mode=process.env.VECTOR_NATIVE_CONTAINMENT_MODE||'runtime';
assert.ok(['build-controls','runtime'].includes(mode),'Unknown native proof phase');
const runtime=process.env.VECTOR_NATIVE_CONTAINMENT_RUNTIME;
assert.ok(runtime&&path.isAbsolute(runtime),'Native containment proof requires an explicit actual runtime; no fallback or skip');
const localPaths=process.env.VECTOR_NATIVE_CONTAINMENT_LOCAL_PATHS;
assert.ok(['0','1'].includes(localPaths),'Native proof requires explicit source resolver (1) or actual app resolver (0)');
if(localPaths==='1')assert.ok(fs.existsSync(path.join(runtime,'local-paths.cjs')),'Source proof resolver missing');
const inputHash='8354b85fedc9ad360eb8a713d45919c3be8b06b598b3338a43155ea9df7144f5';
if(mode==='build-controls'){
 const helper=()=>import(pathToFileURL(path.join(root,'scripts/patch-native-setup-containment.mjs')).href);
 async function preimage(){const m=await helper();let source=fs.readFileSync(path.join(runtime,'server.cjs'),'utf8');if(hash(source)!==inputHash){for(const hook of [...m.nativeSetupContainmentRecipe].reverse()){assert.equal(source.split(hook.after).length-1,1,'Complete patched hook required: '+hook.id);source=source.replace(hook.after,hook.before);}}assert.equal(hash(source),inputHash,'Controls must use actual exact prior composition');return source;}
 function copyWorkflowReceiptInputs(directory){const destination=path.join(directory,'operations-runtime');fs.mkdirSync(destination,{recursive:true});for(const file of ['workflow-action-evidence-bridge.cjs','workflow-action-evidence-sources.cjs'])fs.copyFileSync(path.join(runtime,'operations-runtime',file),path.join(destination,file));}
 async function predicates(){const m=await helper(),source=m.patchNativeSetupContainmentSource(await preimage()).serverSource,context={E:{assert(ok,message,status){if(!ok)throw Object.assign(Error(message),{status});}}};for(const name of ['nativeMutationNeedsAnchor','nativeStateNeedsAnchor']){const line=source.split('\n').find(line=>line.startsWith('function '+name+'('));assert.ok(line);vm.runInNewContext(line+';this.'+name+'='+name,context);}return context;}
 test('native Personal predicate anchors the actual empty-site worker and leader traversal branch',async()=>{
  const p=await predicates(),a={role:'manager',personId:'root',personnelId:null},state={staff:[{id:'root',site:''}],org:[{id:'root',parent:null}]};
  assert.equal(p.nativeStateNeedsAnchor({method:'GET'},{pathname:'/api/personal'},a,state),true);
 });
 test('native mutation predicate preserves only exact non-traversal commands and current payroll reopen',async()=>{
  const p=await predicates(),a={role:'payroll_admin',permissions:['payroll.view','payroll.reopen']};
  for(const command of ['time-source-ingest','payroll-link-personal','payroll-release','payroll-remind','payroll-void','payroll-sent','payroll-adjustment-propose','payroll-adjustment-approve','payroll-adjustment-export','review-return'])assert.equal(p.nativeMutationNeedsAnchor(a,{command}),false,command);
  for(const command of ['review-amend','review-check','review-sign','review-resolve','payroll-unknown','time-source-unknown','unknown'])assert.equal(p.nativeMutationNeedsAnchor(a,{command}),true,command);
  assert.equal(p.nativeMutationNeedsAnchor({...a,permissions:['payroll.view']},{command:'review-return'}),true);
 });
 test('native patch fences both Personal identity reads and the personal-work identity consumer',async()=>{
  const m=await helper(),source=m.patchNativeSetupContainmentSource(await preimage()).serverSource;
  assert.ok(source.includes('function nativeAssertPersonalIdentity(a,state)'));
  const personal=source.split('\n').find(line=>line.includes('const id=PV.identity(s,pa)'));assert.ok(personal.indexOf('nativeAssertPersonalIdentity(a,s)')<personal.indexOf('PV.identity(s,pa)'));
  const snapshot=source.split('\n').find(line=>line.includes('...PV.snapshot(s,pa,now)'));assert.ok(snapshot.includes('nativeAssertPersonalIdentity(a,s)'));
  const work=source.split('\n').find(line=>line.includes("url.pathname==='/api/personal/work'"));assert.ok(work.includes('nativeAssertPersonalIdentity(a,state)'));
 });
 for(const name of ['body','rawBody'])test('native '+name+' rechecks operational mode after a captured await outside the JSON parse catch',async()=>{
  const m=await helper(),source=m.patchNativeSetupContainmentSource(await preimage()).serverSource,line=source.split('\n').find(line=>line.startsWith('async function '+name+'(')),denial=Object.assign(Error('Synthetic changed mode'),{status:403,code:'SETUP_ONLY_REQUIRED'}),context={Buffer,E:{assert(ok,message,status){if(!ok)throw Object.assign(Error(message),{status});}},nativeSetupContainment:{assertCapturedRequestCurrent(){return {tenant:'alpha'};},assertOperationalTenant(){throw denial;}}};
  context.nativeAssertCurrentRequestState=(req,a)=>context.nativeSetupContainment.assertOperationalTenant(a.tenant);vm.runInNewContext(line+';this.read='+name,context);const req=Readable.from(['{}']);req.url='/api/pattern-preview';await assert.rejects(context.read(req),error=>error===denial);
 });
 test('native patch composes exact prior server and verifies a byte-identical complete no-op',async()=>{
  const m=await helper(),source=await preimage(),first=m.patchNativeSetupContainmentSource(source),again=m.patchNativeSetupContainmentSource(first.serverSource);
  assert.equal(first.inputSha256,inputHash);assert.equal(first.changed,true);assert.equal(again.changed,false);assert.equal(again.serverSource,first.serverSource);assert.equal(hash(first.serverSource),first.outputSha256);
 });
 for(const [name,change]of [
  ['unknown unpatched bytes',s=>s+'\n'],
  ['partial patched input',s=>s.replace('function load(tenant){','function load(tenant){nativeSetupContainment.assertOperationalTenant(tenant);')],
  ['duplicate prior hook',s=>s+'\nconst payrollLineage=PLL.createStore(db);'],
  ['marker-only input',s=>s+'\n/* VECTOR_NATIVE_SETUP_CONTAINMENT_V1 */']
 ])test('native patch refuses '+name,async()=>{const m=await helper(),source=await preimage();assert.throws(()=>m.patchNativeSetupContainmentSource(change(source)),/NATIVE_SETUP_CONTAINMENT/);});
 test('native patch refuses changed complete patched bytes',async()=>{const m=await helper(),patched=m.patchNativeSetupContainmentSource(await preimage());assert.throws(()=>m.patchNativeSetupContainmentSource(patched.serverSource+'\n'),/NATIVE_SETUP_CONTAINMENT/);});
 test('native patch receipt retains the exact prior Staffology stage and helper identity',async t=>{
  const m=await helper(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'native-patch-receipt-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const prior=fs.readFileSync(path.join(runtime,'STAFFOLOGY_ASSEMBLY.json'));fs.writeFileSync(path.join(dir,'STAFFOLOGY_ASSEMBLY.json'),prior);fs.writeFileSync(path.join(dir,'server.cjs'),await preimage());copyWorkflowReceiptInputs(dir);
  const receipt=m.patchNativeSetupContainmentRuntime(dir);assert.equal(receipt.inputServerSha256,inputHash);assert.equal(receipt.priorStaffologyReceiptSha256,hash(prior));assert.equal(receipt.priorStaffologyServerSha256,inputHash);assert.equal(receipt.helperSha256,hash(fs.readFileSync(path.join(root,'scripts/patch-native-setup-containment.mjs'))));assert.equal(receipt.sourceCommit,null);assert.equal(receipt.activationAvailable,false);
  const before=fs.readFileSync(path.join(dir,'NATIVE_SETUP_CONTAINMENT_ASSEMBLY.json'));m.patchNativeSetupContainmentRuntime(dir);assert.deepEqual(fs.readFileSync(path.join(dir,'NATIVE_SETUP_CONTAINMENT_ASSEMBLY.json')),before);assert.deepEqual(fs.readFileSync(path.join(dir,'STAFFOLOGY_ASSEMBLY.json')),prior);
 });
 for(const kind of ['missing prior receipt','wrong prior server','incomplete prior receipt','missing patched receipt','changed patched receipt','missing workflow dependency','changed workflow dependency'])test('native patch rejects '+kind+' without changing server bytes',async t=>{
  const m=await helper(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'native-patch-negative-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.writeFileSync(path.join(dir,'server.cjs'),await preimage());copyWorkflowReceiptInputs(dir);const prior=JSON.parse(fs.readFileSync(path.join(runtime,'STAFFOLOGY_ASSEMBLY.json'),'utf8'));
  if(kind!=='missing prior receipt'){if(kind==='wrong prior server')prior.assembledFiles.server='0'.repeat(64);if(kind==='incomplete prior receipt'){delete prior.sourceHashes;for(const key of Object.keys(prior.assembledFiles))if(key!=='server')delete prior.assembledFiles[key];}fs.writeFileSync(path.join(dir,'STAFFOLOGY_ASSEMBLY.json'),JSON.stringify(prior));}
  if(kind.includes('patched receipt')){m.patchNativeSetupContainmentRuntime(dir);if(kind==='missing patched receipt')fs.unlinkSync(path.join(dir,'NATIVE_SETUP_CONTAINMENT_ASSEMBLY.json'));else fs.writeFileSync(path.join(dir,'NATIVE_SETUP_CONTAINMENT_ASSEMBLY.json'),'{}');}
  if(kind==='missing workflow dependency')fs.unlinkSync(path.join(dir,'operations-runtime/workflow-action-evidence-sources.cjs'));
  if(kind==='changed workflow dependency')fs.appendFileSync(path.join(dir,'operations-runtime/workflow-action-evidence-sources.cjs'),'\n// Synthetic unknown bytes\n');
  const before=fs.readFileSync(path.join(dir,'server.cjs'));assert.throws(()=>m.patchNativeSetupContainmentRuntime(dir),/NATIVE_SETUP_CONTAINMENT/);assert.deepEqual(fs.readFileSync(path.join(dir,'server.cjs')),before);
 });
}else{
 test('native runtime proves exact containment dependency bytes and chained final server identity',()=>{
  const receiptBytes=fs.readFileSync(path.join(runtime,'NATIVE_SETUP_CONTAINMENT_ASSEMBLY.json')),receipt=JSON.parse(receiptBytes),priorBytes=fs.readFileSync(path.join(runtime,'STAFFOLOGY_ASSEMBLY.json')),prior=JSON.parse(priorBytes),helperSha256=hash(fs.readFileSync(path.join(root,'scripts/patch-native-setup-containment.mjs'))),moduleHashes={},workflowModules={};
  assert.equal(receipt.helperSha256,helperSha256,'Exact admitted helper bytes required; no fallback or runtime build mutation');assert.equal(prior.assembledFiles.server,inputHash);assert.equal(receipt.priorStaffologyServerSha256,inputHash);
  assert.equal(receipt.sealedArchiveSha256,'3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d');assert.match(receipt.recipeSha256,/^[a-f0-9]{64}$/);
  assert.equal(receipt.inputServerSha256,inputHash);assert.equal(receipt.outputServerSha256,hash(fs.readFileSync(path.join(runtime,'server.cjs'))));assert.equal(receipt.priorStaffologyReceiptSha256,hash(priorBytes));
  for(const file of ['implementation-run-schema.cjs','customer-workspace.cjs','setup-only-policy.cjs','native-setup-containment.cjs']){const bytes=fs.readFileSync(path.join(runtime,'implementation-runtime',file));assert.deepEqual(bytes,fs.readFileSync(path.join(root,'implementation/runtime',file)),'Actual runtime dependency differs: '+file);moduleHashes[file]=hash(bytes);}
  for(const file of ['workflow-action-evidence-bridge.cjs','workflow-action-evidence-sources.cjs']){const bytes=fs.readFileSync(path.join(runtime,'operations-runtime',file));assert.deepEqual(bytes,fs.readFileSync(path.join(root,'operations/runtime',file)),'Actual workflow dependency differs: '+file);workflowModules[file]=hash(bytes);assert.equal(receipt.workflowModules?.[file],workflowModules[file],'Exact workflow receipt dependency required: '+file);}
  console.log('VECTOR_NATIVE_CONTAINMENT_IDENTITY='+JSON.stringify({runtime:path.resolve(runtime),localPaths:Number(localPaths),nativeReceiptSha256:hash(receiptBytes),helperSha256,recipeSha256:receipt.recipeSha256,inputServerSha256:receipt.inputServerSha256,outputServerSha256:receipt.outputServerSha256,priorStaffologyReceiptSha256:receipt.priorStaffologyReceiptSha256,priorStaffologyServerSha256:prior.assembledFiles.server,sealedArchiveSha256:receipt.sealedArchiveSha256,bootstrapSha256:hash(fs.readFileSync(path.join(runtime,'security-runtime/bootstrap.cjs'))),modules:moduleHashes,workflowModules}));
 });

 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 async function until(fn,label){const deadline=Date.now()+5000;while(Date.now()<deadline){if(fn())return;await pause(10);}throw Error(label);}
 function business(db){return{tenants:db.prepare('SELECT * FROM tenants ORDER BY id').all(),audit:db.prepare("SELECT * FROM audit_events WHERE action NOT LIKE 'session-%' ORDER BY id").all(),invites:db.prepare('SELECT * FROM onboarding_invites ORDER BY id').all()};}
 function foundation(db){
  const source=fs.readFileSync(path.join(runtime,'server.cjs'),'utf8'),match=source.match(/db\.exec\(`(PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;[\s\S]*?CREATE TRIGGER IF NOT EXISTS no_audit_delete[\s\S]*?END;)`\);/);
  assert.ok(match,'Actual native foundation owner missing');db.exec(match[1]);db.exec("ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT '[]'");
  for(const [name,ddl]of [['issued_at','INTEGER'],['last_seen','INTEGER'],['source_hash','TEXT'],['source_basis','TEXT'],['source_authoritative','INTEGER NOT NULL DEFAULT 0'],['client_hash','TEXT']])db.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${ddl}`);
 }
 function workflowOwnerFixture(t,{method='GET',capture=true}={}){
  const source=fs.readFileSync(path.join(runtime,'server.cjs'),'utf8'),line=source.split('\n').find(line=>line.startsWith('function createNativeWorkflowSourceOwner('));
  assert.ok(line,'Actual packaged native workflow factory required; no helper execution or substitute issuer');
  const context={};vm.runInNewContext(line+';this.create=createNativeWorkflowSourceOwner;',context);
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'native-workflow-owner-')),dbPath=path.join(directory,'state.sqlite'),db=new DatabaseSync(dbPath),connections=[db];
  t.after(()=>{for(const connection of connections.reverse())connection.close();fs.rmSync(directory,{recursive:true,force:true});});foundation(db);
  const nativeFile=path.join(runtime,'implementation-runtime/native-setup-containment.cjs');assert.deepEqual(fs.readFileSync(nativeFile),fs.readFileSync(path.join(root,'implementation/runtime/native-setup-containment.cjs')));delete require.cache[require.resolve(nativeFile)];
  const api=require(nativeFile),moduleFile=file=>path.join(runtime,'implementation-runtime',file);
  api.installNativeSetupFactory({initializeSchema(actual){require(moduleFile('implementation-run-schema.cjs')).initializeImplementationRunSchema({db:actual});require(moduleFile('customer-workspace.cjs')).initializeCustomerWorkspaceSchema({db:actual});require(moduleFile('setup-only-policy.cjs')).initializeSetupOnlySchema({db:actual});},createReader:require(moduleFile('setup-only-policy.cjs')).createSetupOnlyReader});
  const guard=api.bindNativeDatabase({db,requestSource:req=>({identity:req.socket.remoteAddress,basis:'direct',containmentEligible:true}),clientFingerprint:req=>hash(req.headers['user-agent']).slice(0,24)});
  const state={version:1,org:[{id:'d1',parent:null},{id:'m1',parent:'d1'}],staff:[{id:'e1',manager:'m1',site:'A'}]};db.prepare('INSERT INTO tenants VALUES(?,?,?)').run('workflow-proof',state.version,JSON.stringify(state));
  const actor={email:'native@workflow.example.invalid',tenant:'workflow-proof',personId:'d1',personnelId:null,role:'director',costs:true,permissions:['company.configure']};
  db.prepare('INSERT INTO users(email,tenant,person_id,role,costs,salt,password_hash,permissions) VALUES(?,?,?,?,?,?,?,?)').run(actor.email,actor.tenant,actor.personId,actor.role,1,'SYNTHETIC','UNUSABLE-SYNTHETIC-HASH',JSON.stringify(actor.permissions));
  const req={method,url:'/api/workforce/lifecycle/action-evidence/absence',headers:{cookie:'wfm_session=synthetic-workflow-original','user-agent':'native-workflow-owner'},socket:{remoteAddress:'127.0.0.1'}};
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?,?)').run(hash('synthetic-workflow-original'),actor.email,Date.now()+60000,Date.now()-1000,Date.now(),hash('127.0.0.1').slice(0,24),'direct',1,hash(req.headers['user-agent']).slice(0,24));guard.captureRequestActor(req,actor);
  const view=Object.freeze({url:req.url,method:'GET',headers:Object.freeze({...req.headers}),socket:req.socket}),owner=context.create(db,guard),ticket=capture?owner.sourceOwner.capture(req,view):undefined;
  const resolve=(overrides={})=>owner.resolveSourceActor({ticket,sourceRequest:view,state,principal:actor,db,...overrides});
  return{db,state,actor,req,view,owner,ticket,resolve,guard,secondOwner:()=>context.create(db,guard),readOnlyConnection(){const other=new DatabaseSync(dbPath,{readOnly:true});connections.push(other);return other;}};
 }
 const ownerDenied=error=>error.status===403&&error.statusCode===403&&error.code==='WFM_NATIVE_WORKFLOW_OWNER_REQUIRED';
 test('native runtime workflow factory resolves the genuine original actor without identity writes',t=>{
  const f=workflowOwnerFixture(t),before=f.db.prepare('SELECT total_changes() n').get().n;assert.equal(f.resolve(),f.actor);assert.equal(f.resolve({principal:{...f.actor}}),f.actor,'Matching freshly read tuple resolves to the original actor, never its clone');assert.equal(f.owner.sourceOwner.assertCurrent(f.ticket,f.req,f.state),f.actor);assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,1);
 });
 for(const attack of ['missing ticket','cloned ticket','cloned source view','wrong original request','missing original request','same-path different database','cross-owner ticket','released ticket','duplicate capture','altered principal tuple'])test('native runtime workflow factory rejects '+attack+' with the genuine native guard',t=>{
  const f=workflowOwnerFixture(t),before=f.db.prepare('SELECT total_changes() n').get().n;
  if(attack==='missing ticket')assert.throws(()=>f.resolve({ticket:undefined}),ownerDenied);
  if(attack==='cloned ticket')assert.throws(()=>f.resolve({ticket:{...f.ticket}}),ownerDenied);
  if(attack==='cloned source view')assert.throws(()=>f.resolve({sourceRequest:Object.freeze({...f.view})}),ownerDenied);
  if(attack==='wrong original request')assert.throws(()=>f.owner.sourceOwner.assertCurrent(f.ticket,{...f.req},f.state),ownerDenied);
  if(attack==='missing original request')assert.throws(()=>f.owner.sourceOwner.assertCurrent(f.ticket,undefined,f.state),ownerDenied);
  if(attack==='same-path different database')assert.throws(()=>f.resolve({db:f.readOnlyConnection()}),ownerDenied);
  if(attack==='cross-owner ticket'){const other=f.secondOwner(),ticket=other.sourceOwner.capture(f.req,f.view);assert.equal(other.resolveSourceActor({ticket,sourceRequest:f.view,state:f.state,principal:f.actor,db:f.db}),f.actor);assert.throws(()=>f.resolve({ticket}),ownerDenied);}
  if(attack==='released ticket'){f.owner.sourceOwner.release(f.ticket,f.req);assert.throws(()=>f.resolve(),ownerDenied);assert.throws(()=>f.owner.sourceOwner.assertCurrent(f.ticket,f.req,f.state),ownerDenied);assert.throws(()=>f.owner.sourceOwner.capture(f.req,f.view),ownerDenied);}
  if(attack==='duplicate capture')assert.throws(()=>f.owner.sourceOwner.capture(f.req,f.view),ownerDenied);
  if(attack==='altered principal tuple')assert.throws(()=>f.resolve({principal:{...f.actor,personId:'m1'}}),ownerDenied);
  assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before,'Failed ticket controls perform no identity or business writes');
 });
 for(const omitted of [undefined,null,false])test('native runtime workflow factory rejects '+String(omitted)+' original request in assertion and release',t=>{
  const f=workflowOwnerFixture(t),before=f.db.prepare('SELECT total_changes() n').get().n;assert.throws(()=>f.owner.sourceOwner.assertCurrent(f.ticket,omitted,f.state),ownerDenied);assert.throws(()=>f.owner.sourceOwner.release(f.ticket,omitted),ownerDenied);assert.equal(f.resolve(),f.actor,'Wrong release must leave the actual ticket valid');assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);
 });
 test('native runtime workflow factory rejects a captured POST paired with a GET source view',t=>{
  const f=workflowOwnerFixture(t,{method:'POST',capture:false}),before=f.db.prepare('SELECT total_changes() n').get().n;assert.equal(f.guard.assertRequestCurrent(f.req),f.actor,'Original POST was genuinely captured by the real guard');assert.throws(()=>f.owner.sourceOwner.capture(f.req,f.view),ownerDenied);assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);
 });
 function workflowObservationPreload(runtime,nonce){
  // Observe or pause genuine owners. Never replace their decisions, actor,
  // database, source result or calendar result with a synthetic authority.
  const sqlite=require('node:sqlite'),prepare=sqlite.DatabaseSync.prototype.prepare;
  const seen=new Map(),captures=new Map(),releases=new Map();
  sqlite.DatabaseSync.prototype.prepare=function(sql){
   const statement=prepare.call(this,sql);
   if(sql!=="UPDATE sessions SET last_seen=?,source_hash=?,source_basis=?,source_authoritative=?,client_hash=? WHERE token_hash=?")return statement;
   return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key,target);if(key==='run')return(...args)=>{const result=value.apply(target,args);seen.set(args.at(-1),(seen.get(args.at(-1))||0)+1);return result;};return typeof value==='function'?value.bind(target):value;}});
  };
  let configuration={},sequence=0,activeWorkflow,priorView,priorTicket;
  const waits=new Map(),send=data=>process.send({...data,nonce,pid:process.pid});
  const digest=req=>require('node:crypto').createHash('sha256').update(String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('wfm_session='))?.slice('wfm_session='.length)||'').digest('hex');
  async function gate(phase,value){
   if(configuration.phase!==phase||configuration.workflow!==activeWorkflow)return value;
   const id=++sequence;send({kind:'native-proof-workflow-await',phase,workflow:activeWorkflow,id});
   await new Promise(resolve=>waits.set(id,resolve));return value;
  }
  process.on('message',message=>{
   if(message?.nonce!==nonce)return;
   if(message.kind==='native-proof-workflow-configure'){configuration=message.configuration||{};send({kind:'native-proof-workflow-configured',id:message.id});}
   if(message.kind==='native-proof-workflow-release'){const resume=waits.get(message.id);if(!resume)throw Error('Unknown genuine workflow await');waits.delete(message.id);resume();}
   if(message.kind==='native-proof-workflow-statistics')send({kind:'native-proof-workflow-statistics',id:message.id,sessionUpdates:seen.get(message.digest)||0,captures:captures.get(message.digest)||0,releases:releases.get(message.digest)||0});
  });
  const sourcesPath=require.resolve(require('node:path').join(runtime,'operations-runtime/workflow-action-evidence-sources.cjs'));
  const sources=require(sourcesPath);
  require.cache[sourcesPath].exports={...sources,createWorkflowActionEvidenceSourceReaders(options){
   const readers=sources.createWorkflowActionEvidenceSourceReaders(options);
   return Object.freeze(Object.fromEntries(Object.entries(readers).map(([name,read])=>[name,async(...args)=>{
    activeWorkflow=({timeReviewSourceProvider:'time-review',absenceSourceProvider:'absence',weeklySignoffSourceProvider:'weekly-signoff'})[name];
    const originalView=args[0],originalTicket=args[2];
    if(configuration.attack==='missing-ticket')args[2]=undefined;
    if(configuration.attack==='clone-ticket')args[2]=Object.freeze({...args[2]});
    if(configuration.attack==='clone-view')args[0]=Object.freeze({...args[0],headers:Object.freeze({...args[0].headers})});
    if(configuration.attack==='cross-view'){if(!priorView)throw Error('Genuine prior workflow view required');args[0]=priorView;}
    if(configuration.attack==='borrowed-ticket'){if(!priorTicket)throw Error('Genuine prior workflow ticket required');args[2]=priorTicket;}
    priorView=originalView;priorTicket=originalTicket;
    return await gate('provider',await read(...args));
   }])));
  }};
  const bridgePath=require.resolve(require('node:path').join(runtime,'operations-runtime/workflow-action-evidence-bridge.cjs'));
  const bridge=require(bridgePath);
  require.cache[bridgePath].exports={...bridge,createWorkflowActionEvidenceBridge(options){
   const owner=options.sourceOwner;
   if(owner)options={...options,sourceOwner:Object.freeze({
    capture(req,view){const token=digest(req),ticket=owner.capture(req,view);captures.set(token,(captures.get(token)||0)+1);if(configuration.attack==='released-ticket')owner.release(ticket,req);return ticket;},
    assertCurrent(...args){if(configuration.attack==='cross-request')args[1]={...args[1],headers:{...args[1].headers}};return owner.assertCurrent(...args);},
    release(ticket,req){const result=owner.release(ticket,req),token=digest(req);releases.set(token,(releases.get(token)||0)+1);return result;}
   })};
   const calendar=options.tenantCalendar;
   if(calendar)options={...options,tenantCalendar:{...calendar,snapshot(...args){return gate('calendar',calendar.snapshot(...args));}}};
   return bridge.createWorkflowActionEvidenceBridge(options);
  }};
 }
 async function fixture(t,{held=false,gateAI=false,gateWorkflow=false}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'native-http-')),dbPath=path.join(directory,'state.sqlite'),nonce=randomBytes(18).toString('hex');
  const db=new DatabaseSync(dbPath);db.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000');
  if(held){foundation(db);db.prepare('INSERT INTO tenants VALUES(?,?,?)').run('held-native',1,JSON.stringify({version:1,org:[],staff:[]}));}
  // Only the endpoint and optional advisory AI await are test seams. Authority,
  // session, SQLite, dispatch, native bootstrap and cache owners execute intact.
  const preload=path.join(directory,'owned-listener.cjs');
  const observations=held?`const sqlite=require('node:sqlite'),exec=sqlite.DatabaseSync.prototype.exec;let nativeFoundation;sqlite.DatabaseSync.prototype.exec=function(sql){const result=exec.call(this,sql);if(!nativeFoundation&&typeof sql==='string'&&sql.startsWith('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;')&&sql.includes('CREATE TABLE IF NOT EXISTS tenants('))nativeFoundation=this;return result;};const report=console.error;console.error=function(...args){if(args[0]==='WFM_NATIVE_SETUP_CONTAINMENT_HELD=SETUP_MODE_BINDING_UNAVAILABLE'){if(!nativeFoundation)throw Error('Actual native foundation observer missing');process.send({kind:'native-proof-held-preflight',nonce:${JSON.stringify(nonce)},pid:process.pid,canonicalTables:nativeFoundation.prepare("SELECT count(*) n FROM sqlite_master WHERE name='customer_workspaces'").get().n,tenants:nativeFoundation.prepare('SELECT count(*) n FROM tenants').get().n});}return report.apply(console,args);};`:'';
  fs.writeFileSync(preload,observations+`const http=require('node:http'),original=http.Server.prototype.listen;http.Server.prototype.listen=function(...args){this.once('listening',()=>process.send({kind:'native-proof-listening',nonce:${JSON.stringify(nonce)},pid:process.pid,address:this.address()}));const callback=args.find(x=>typeof x==='function');return original.call(this,{port:0,host:'127.0.0.1'},...(callback?[callback]:[]));};global.fetch=()=>{throw Error('Real provider fetch forbidden in native proof');};${gateWorkflow?'('+workflowObservationPreload.toString()+')('+JSON.stringify(runtime)+','+JSON.stringify(nonce)+');':''}${gateAI?`const ai=require(${JSON.stringify(path.join(runtime,'lib/ai.cjs'))});let sequence=0;ai.explain=async()=>{const id=++sequence;process.send({kind:'native-proof-ai',nonce:${JSON.stringify(nonce)},pid:process.pid,id});await new Promise(resolve=>{const ready=m=>{if(m?.kind==='native-proof-ai-release'&&m.id===id){process.off('message',ready);resolve();}};process.on('message',ready);});return {status:'synthetic-advisory',text:'SYNTHETIC-ADVISORY-'+id};};`:''}`);
  const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,PORT:'1',WFM_DB:dbPath,WFM_HOSTED_STAGING:'false',NODE_ENV:'test',WFM_IDENTITY_SURVIVAL_GUARD:'enforce',WFM_AUTH_SOURCE_MODE:'direct',WFM_INTEGRATIONS_JSON:'[]',WFM_OUTBOUND_INTEGRATIONS_JSON:'[]',WFM_PAYROLL_ACK_PROVIDERS_JSON:'[]',WFM_SUPPORT_ENABLED:'false',WFM_AGENTS_API_ENABLED:'false',WFM_TENANT_CLOCK_ISO:'2026-09-24T12:00:00Z',WFM_TENANT_TIMEZONE:'Europe/London'};
  const loader=path.join(runtime,'local-paths.cjs'),child=spawn(process.execPath,[...(localPaths==='1'?['--require',loader]:[]),'--require',preload,path.join(runtime,'security-runtime/bootstrap.cjs')],{cwd:runtime,env,stdio:['ignore','pipe','pipe','ipc']});
  let diagnostics='',endpoint,failure;const aiCalls=[],heldPreflights=[],workflowCalls=[],workflowReplies=new Map();let workflowSequence=0;
  for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{diagnostics=(diagnostics+b).slice(-12000);});
  child.on('error',e=>failure=e);const closed=new Promise(resolve=>child.once('close',resolve));
  child.on('message',m=>{if(m?.nonce!==nonce||m.pid!==child.pid){failure=Error('Foreign native proof child message');return;}if(m.kind==='native-proof-workflow-await'){workflowCalls.push(m);return;}if(['native-proof-workflow-configured','native-proof-workflow-statistics'].includes(m.kind)){workflowReplies.set(m.id,m);return;}if(m.kind==='native-proof-held-preflight'){heldPreflights.push(m);return;}if(m.kind==='native-proof-ai'){assert.ok(Number.isSafeInteger(m.id)&&m.id>0);aiCalls.push(m.id);return;}if(m.kind!=='native-proof-listening'||endpoint||m.address?.address!=='127.0.0.1'||m.address.family!=='IPv4'||!Number.isInteger(m.address.port)||m.address.port<1||m.address.port>65535){failure=Error('Malformed or duplicate actual child endpoint');return;}endpoint=m.address;});
  t.after(async()=>{if(child.pid&&child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await Promise.race([closed,pause(2000)]);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed;}db.close();fs.rmSync(directory,{recursive:true,force:true});});
  const deadline=Date.now()+30000;while(!endpoint&&Date.now()<deadline){if(failure)throw failure;if(child.exitCode!==null||child.signalCode!==null)throw Error('Actual native bootstrap exited: '+diagnostics);await pause(20);}assert.ok(endpoint,'Actual native listener unavailable: '+diagnostics);
  const origin='http://127.0.0.1:'+endpoint.port;
  const startupCanonicalTableCount=db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='customer_workspaces'").get().n;
  assert.equal((await fetch(origin+'/api/health')).status,200,'Actual native listener health: '+diagnostics);
  function actor({email='superuser@northstar.example',personId,role,permissions}={}){
   if(!db.prepare('SELECT 1 FROM users WHERE email=?').get(email))db.prepare('INSERT INTO users(email,tenant,person_id,role,costs,salt,password_hash,permissions) VALUES(?,?,?,?,?,?,?,?)').run(email,'held-native',personId||'synthetic-rootless','payroll_admin',0,'SYNTHETIC','UNUSABLE-SYNTHETIC-HASH',JSON.stringify(permissions||[]));
   for(const [column,value]of [['person_id',personId],['role',role],['permissions',permissions===undefined?undefined:JSON.stringify(permissions)]])if(value!==undefined)db.prepare('UPDATE users SET '+column+'=? WHERE email=?').run(value,email);
   const token=randomBytes(32).toString('hex'),digest=hash(token);db.prepare('INSERT INTO sessions(token_hash,email,expires,issued_at,last_seen) VALUES(?,?,?,?,?)').run(digest,email,Date.now()+120000,Date.now(),1);return{email,digest,cookie:'wfm_session='+token};
  }
  const headers=a=>({'user-agent':'Native-Containment-Proof',origin,...(a?{cookie:a.cookie}:{})});
  async function request(a,url,body){const r=await fetch(origin+url,{method:body===undefined?'GET':'POST',headers:{...headers(a),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,body:await r.json()};}
  async function heldBody(a,url,body,change){
   const payload=JSON.stringify(body),r=http.request(origin+url,{method:'POST',headers:{...headers(a),'content-type':'application/json','content-length':Buffer.byteLength(payload)}});
   const result=new Promise((resolve,reject)=>{r.once('error',reject);r.once('response',res=>{let text='';res.on('data',b=>text+=b);res.once('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text)});}catch(e){reject(e);}});});});
   r.write(payload.slice(0,1));try{await until(()=>db.prepare('SELECT last_seen FROM sessions WHERE token_hash=?').get(a.digest)?.last_seen>1,'Actual original actor was not captured: '+diagnostics);change();r.end(payload.slice(1));return await result;}catch(e){r.destroy();throw e;}
  }
  const state=()=>JSON.parse(db.prepare("SELECT state FROM tenants WHERE id='northstar-demo'").get().state),save=s=>db.prepare("UPDATE tenants SET version=?,state=? WHERE id='northstar-demo'").run(s.version,JSON.stringify(s));
  function pending(){const {createCustomerWorkspaceRegistry}=require(path.join(runtime,'implementation-runtime/customer-workspace.cjs'));const registry=createCustomerWorkspaceRegistry({db,createInitialWorkspace:()=>{throw Error('Proof must never activate a workspace');}});registry.recordOrder({orderAuthorized:true,ownerAuthorized:true,expectedRevision:0,orderAuthorityRef:'synthetic-proof/order',orderId:'synthetic-native-pending',customerId:'synthetic-proof/customer',customerAuthorityRef:'synthetic-proof/customer-authority',tenant:'northstar-demo',provider:'docusign',envelopeId:'synthetic-native-envelope',contractRef:'synthetic-native-contract',relationship:'initial',nominatedSuperUserEmail:'synthetic@example.invalid',nominationAuthorityRef:'synthetic-proof/nomination',profile:{organisationName:'Synthetic proof only'}});}
  function setupOnly(){
   // Local synthetic canonical evidence only. No signing route, first-owner
   // adapter, customer account or external activation is supplied or invoked.
   const {createCustomerWorkspaceRegistry}=require(path.join(runtime,'implementation-runtime/customer-workspace.cjs'));
   const registry=createCustomerWorkspaceRegistry({db,createInitialWorkspace:binding=>{db.prepare('INSERT INTO implementation_runs VALUES(?,?,?,?,?,?,?,?,?)').run('synthetic-native-mode-run',binding.tenant,hash(binding.contractRef),'OPEN',1,2,8,'2026-10-12T00:00:00.000Z','2026-10-12T00:00:00.000Z');return{initialSetupRunId:'synthetic-native-mode-run'};}});
   registry.accept({verified:true,ownerAuthorized:true,customerId:'synthetic-mode-customer',customerAuthorityRef:'synthetic-proof/customer',tenant:'northstar-demo',provider:'synthetic-proof-provider',eventId:'synthetic-mode-event',contractRef:'synthetic-mode-contract',relationship:'initial',ownerEmail:'synthetic@example.invalid',ownerAuthorityRef:'synthetic-proof/nomination'});
   assert.equal(require(path.join(runtime,'implementation-runtime/setup-only-policy.cjs')).createSetupOnlyReader({db}).forTenant('northstar-demo').mode,'SETUP_ONLY');
  }
  async function workflowCommand(kind,values={}){const id=++workflowSequence;child.send({kind,id,nonce,...values});await until(()=>workflowReplies.has(id),'Actual workflow observation command not acknowledged: '+diagnostics);const result=workflowReplies.get(id);workflowReplies.delete(id);return result;}
  return{db,actor,request,heldBody,state,save,pending,setupOnly,aiCalls,startupCanonicalTableCount,heldPreflights,async awaitAI(){await until(()=>aiCalls.length>0,'Actual AI advisory await not entered');return aiCalls.shift();},releaseAI:id=>child.send({kind:'native-proof-ai-release',id}),configureWorkflow:configuration=>workflowCommand('native-proof-workflow-configure',{configuration}),workflowStatistics:a=>workflowCommand('native-proof-workflow-statistics',{digest:a.digest}),async awaitWorkflow(phase,workflow){await until(()=>workflowCalls.length>0,'Actual workflow '+phase+' await not entered: '+diagnostics);const next=workflowCalls.shift();assert.equal(next.phase,phase);assert.equal(next.workflow,workflow);return next.id;},releaseWorkflow:id=>child.send({kind:'native-proof-workflow-release',nonce,id}),diagnostics:()=>diagnostics};
 }

 const workflowPath=workflow=>'/api/workforce/lifecycle/action-evidence/'+workflow+(workflow==='absence'?'':'?period=2026-09-07');
 for(const workflow of ['time-review','weekly-signoff','absence'])test('native HTTP workflow '+workflow+' retains genuine original actor and session without recapture',async t=>{
  const f=await fixture(t,{gateWorkflow:true}),a=f.actor({permissions:['company.configure']}),before=business(f.db),reply=await f.request(a,workflowPath(workflow));
  assert.equal(reply.status,200,JSON.stringify(reply));assert.equal(reply.body.workflow,workflow);assert.equal(reply.body.scope.tenant,'northstar-demo');assert.equal(reply.body.contractVersion,'WFM_WORKFLOW_ACTION_EVIDENCE_V1');assert.match(reply.body.contextKey,/^[a-f0-9]{64}$/);
  if(workflow==='absence')assert.deepEqual(reply.body.items,[],'Native absence schema must not invent confirmation');
  const observed=await f.workflowStatistics(a);assert.equal(observed.captures,1,'Exactly one ticket from the already captured original request');assert.equal(observed.releases,1,'Actual owner finally releases the ticket');assert.equal(observed.sessionUpdates,1,'Reader must not call actor(req) again or replay a session');
  assert.deepEqual(business(f.db),before);assert.equal(f.db.prepare('SELECT count(*) n FROM sessions WHERE token_hash=?').get(a.digest).n,1,'Original session retained');assert.equal((await f.request(a,'/api/bootstrap')).status,200,'Original unchanged session remains valid');
 });
 for(const workflow of ['time-review','weekly-signoff','absence'])for(const phase of ['provider','calendar'])test('native HTTP workflow '+workflow+' '+phase+' await preserves unchanged original authority',async t=>{
  const f=await fixture(t,{gateWorkflow:true}),a=f.actor({permissions:['company.configure']});await f.configureWorkflow({workflow,phase});const before=business(f.db),pending=f.request(a,workflowPath(workflow)),id=await f.awaitWorkflow(phase,workflow);f.releaseWorkflow(id);const allowed=await pending;
  assert.equal(allowed.status,200,JSON.stringify({workflow,phase,allowed}));assert.equal(allowed.body.workflow,workflow);assert.equal(allowed.body.scope.tenant,'northstar-demo');const observed=await f.workflowStatistics(a);assert.equal(observed.captures,1);assert.equal(observed.releases,1);assert.equal(observed.sessionUpdates,1,'Paused read does not recapture the native actor');assert.deepEqual(business(f.db),before);
 });
 for(const workflow of ['time-review','weekly-signoff','absence'])for(const phase of ['provider','calendar'])for(const drift of ['session','permissions','pending mode','schema','source revision'])test('native HTTP workflow '+workflow+' '+phase+' await rejects '+drift+' drift before disclosure',async t=>{
  const f=await fixture(t,{gateWorkflow:true}),a=f.actor({permissions:['company.configure']});await f.configureWorkflow({workflow,phase});
  const pending=f.request(a,workflowPath(workflow)),id=await f.awaitWorkflow(phase,workflow);
  if(drift==='session')f.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(a.digest);
  if(drift==='permissions')f.db.prepare("UPDATE users SET permissions='[]' WHERE email=?").run(a.email);
  if(drift==='pending mode')f.pending();
  if(drift==='schema'){const trigger=f.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='customer_workspace_runtime_state' ORDER BY name LIMIT 1").get();assert.ok(trigger);f.db.exec('DROP TRIGGER '+trigger.name);}
  if(drift==='source revision'){const changed=f.state();changed.version++;f.save(changed);}
  const after=business(f.db);f.releaseWorkflow(id);const denied=await pending;
  assert.equal(denied.status,({session:401,permissions:403,'pending mode':403,schema:503,'source revision':409})[drift],JSON.stringify({workflow,phase,drift,denied}));
  for(const field of ['items','unavailable','contextKey','scope','state','actor'])assert.equal(denied.body[field],undefined,'Denied workflow discloses no '+field);
  assert.deepEqual(business(f.db),after,'Read denial changes no business state');
 });
 for(const attack of ['missing-ticket','clone-ticket','clone-view','cross-view','borrowed-ticket','cross-request','released-ticket'])test('native HTTP workflow owner rejects '+attack+' without source disclosure',async t=>{
  const f=await fixture(t,{gateWorkflow:true}),a=f.actor({permissions:['company.configure']});
  if(['cross-view','borrowed-ticket'].includes(attack))assert.equal((await f.request(a,workflowPath('absence'))).status,200,'Genuine earlier view/ticket required');
  await f.configureWorkflow({attack});const before=business(f.db),denied=await f.request(a,workflowPath('absence'));
  assert.equal(denied.status,403,JSON.stringify({attack,denied}));assert.equal(denied.body.items,undefined);assert.equal(denied.body.state,undefined);assert.equal(denied.body.actor,undefined);assert.deepEqual(business(f.db),before);
 });
 test('native HTTP workflow adapter preserves anonymous method selector and unknown-source denials',async t=>{
  const f=await fixture(t,{gateWorkflow:true});assert.equal((await f.request(null,workflowPath('absence'))).status,401);
  const a=f.actor({permissions:['company.configure']}),before=business(f.db);
  assert.equal((await f.request(a,workflowPath('time-review')+'&tenant=other')).status,400);
  assert.equal((await f.request(a,workflowPath('time-review'),{})).status,405);
  assert.equal((await f.request(a,'/api/workforce/lifecycle/action-evidence/unknown')).status,404);assert.deepEqual(business(f.db),before);
 });

 test('native HTTP original body capture denies deleted bearer and authority drift outside JSON catch',async t=>{
  const f=await fixture(t);for(const kind of ['session','permissions']){const a=f.actor({permissions:['company.configure']}),before=business(f.db),s=f.state(),r=await f.heldBody(a,'/api/command',{version:s.version,command:'jurisdiction',payload:{country:'GB-SCT'}},()=>kind==='session'?f.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(a.digest):f.db.prepare("UPDATE users SET permissions='[]' WHERE email=?").run(a.email));assert.equal(r.status,kind==='session'?401:403,JSON.stringify(r));assert.equal(r.body.result,undefined);assert.deepEqual(business(f.db),before);}
 });
 test('native HTTP org mutation replay retains unchanged result and rejects original authority loss',async t=>{
  const f=await fixture(t),a=f.actor({permissions:['company.configure']}),s=f.state(),nodes=s.org.filter(n=>n.parent!==null),n=nodes.find(n=>s.org.some(p=>p.id!==n.parent&&p.id!==n.id&&p.role===s.org.find(o=>o.id===n.parent)?.role));assert.ok(n,'Genuine alternate same-level parent required');const parent=s.org.find(p=>p.id!==n.parent&&p.id!==n.id&&p.role===s.org.find(o=>o.id===n.parent)?.role),body={version:s.version,command:'org-move',payload:{node:n.id,newParent:parent.id,effectiveFrom:'2099-01-01',reason:'Synthetic reviewed future move',clientKey:'native-proof-'+randomBytes(8).toString('hex')}};
  const first=await f.request(a,'/api/command',body);assert.equal(first.status,200,JSON.stringify(first));const before=business(f.db),replay=await f.request(a,'/api/command',body);assert.equal(replay.status,200,JSON.stringify(replay));assert.deepEqual(business(f.db),before);
  const currentVersionBody={...body,version:f.state().version},callbackReplay=await f.request(a,'/api/command',currentVersionBody);assert.equal(callbackReplay.status,200,JSON.stringify(callbackReplay));assert.deepEqual(business(f.db),before,'Callback replay also has no business effect');
  for(const replayBody of [body,currentVersionBody]){const current=f.actor({permissions:['company.configure']}),denied=await f.heldBody(current,'/api/command',replayBody,()=>f.db.prepare("UPDATE users SET permissions='[]' WHERE email=?").run(current.email));assert.equal(denied.status,403,JSON.stringify(denied));assert.equal(denied.body.result,undefined);assert.deepEqual(business(f.db),before);}
 });
 test('native HTTP Personal leader branch accepts original root and rejects a personnel alias',async t=>{
  const f=await fixture(t),s=f.state(),base=s.staff[0],id='m1';s.staff.push({...base,id,manager:'d1',site:''});s.staff.push({...base,id:'native-descendant',manager:id,site:'PRIVATE-DESCENDANT-SITE'});f.save(s);
  const effective=require(path.join(runtime,'public/org-admin.js')).decorate(structuredClone(s));assert.ok(effective.org.some(n=>n.id===id),'Genuine leader must survive actual effective graph decoration');assert.equal(effective.staff.find(p=>p.id===id).site,'','Exact empty-site worker+leader traversal branch required');
  const same=f.actor({email:'manager@northstar.example',personId:id});assert.equal((await f.request(same,'/api/personal')).status,200);
  const alias=f.actor({email:'payroll@northstar.example'});f.db.prepare("INSERT INTO personnel_links(email,tenant,staff_id,status,linked_by,linked_at) VALUES(?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET staff_id=excluded.staff_id,status='active'").run(alias.email,'northstar-demo',id,'active','synthetic-proof','2026-10-12T00:00:00.000Z');const denied=await f.request(alias,'/api/personal');assert.equal(denied.status,403,JSON.stringify(denied));assert.ok(!JSON.stringify(denied.body).includes('PRIVATE-DESCENDANT-SITE'));
  f.db.prepare('UPDATE personnel_links SET staff_id=? WHERE email=?').run(base.id,alias.email);assert.equal((await f.request(alias,'/api/personal')).status,200,'Worker-only Personal remains compatible');
 });
 test('native HTTP rootless payroll keeps exact current reopen and denies traversal or unknown commands',async t=>{
  const f=await fixture(t),s=f.state(),period=s.payrollControl.periods.find(p=>!p.batches.some(b=>['released','sent'].includes(b.status)));assert.ok(period);const team=period.teams[0],a=f.actor({email:'payroll@northstar.example',permissions:['payroll.view','payroll.reopen']}),body={version:s.version,command:'review-return',payload:{period:period.id,team:team.id,reason:'Synthetic reviewed correction'}};
  assert.equal((await f.request(a,'/api/payroll-run?period='+period.id)).status,200);assert.equal((await f.request(a,'/api/command',body)).status,200);
  for(const permissions of [['payroll.view'],['payroll.reopen']]){const current=f.actor({email:a.email,permissions}),before=business(f.db),r=await f.request(current,'/api/command',{...body,version:f.state().version});assert.equal(r.status,403,JSON.stringify(r));assert.deepEqual(business(f.db),before);}
  const current=f.actor({email:a.email,permissions:['payroll.view','payroll.reopen']}),before=business(f.db),denied=await f.heldBody(current,'/api/command',{...body,version:f.state().version},()=>f.db.prepare("UPDATE users SET permissions='[\"payroll.view\"]' WHERE email=?").run(a.email));assert.equal(denied.status,403,JSON.stringify(denied));assert.deepEqual(business(f.db),before);
  const fresh=f.actor({email:a.email,permissions:['payroll.view','payroll.reopen']});assert.equal((await f.request(fresh,'/api/command',{version:f.state().version,command:'payroll-unknown',payload:{}})).status,403);
 });
 test('native HTTP exact company-admin GET preserves rootless current configuration authority',async t=>{
  const f=await fixture(t),missing=f.actor({email:'admin@northstar.example',permissions:[]});assert.ok(!f.state().org.some(n=>n.id==='admin1'),'Real rootless native admin fixture required');assert.equal((await f.request(missing,'/api/company-admin')).status,403,'Existing company.configure remains mandatory');
  const current=f.actor({email:missing.email,permissions:['company.configure']}),before=business(f.db),allowed=await f.request(current,'/api/company-admin');assert.equal(allowed.status,200,JSON.stringify(allowed));assert.ok(Array.isArray(allowed.body.accounts));assert.deepEqual(business(f.db),before);
  assert.equal((await f.request(current,'/api/company-admin/unknown')).status,403,'Near-path GET cannot borrow the exact configuration exception');const unknownAccount=await f.request(current,'/api/company-admin/command',{version:f.state().version,command:'unknown',payload:{}});assert.equal(unknownAccount.status,400,'Existing finite account owner rejects unknown actions before its transaction');assert.equal(unknownAccount.body.error,'Unknown account administration action.');assert.equal((await f.request(current,'/api/command',{version:f.state().version,command:'unknown',payload:{}})).status,403,'Unknown general mutation still requires actual graph authority');assert.deepEqual(business(f.db),before);
 });
 test('native HTTP all cached previews and onboarding invite reject source drift after held body',async t=>{
  const f=await fixture(t);for(const route of ['/api/onboarding/preview','/api/demand/preview','/api/recommendations/preview','/api/resources/preview','/api/pattern-preview','/api/premium-preview','/api/payroll/preview','/api/ai','/api/onboarding/invite'])await t.test(route,async()=>{
   const a=f.actor({permissions:['company.configure']}),original=f.state();let after;
   const r=await f.heldBody(a,route,{csv:'synthetic-invalid',options:{},sourceId:'synthetic',version:original.version},()=>{const changed=structuredClone(original);changed.org[0].name='Synthetic unchanged authority label';changed.org[0].id='changed-native-root';f.save(changed);after=business(f.db);});
   assert.equal(r.status,403,JSON.stringify({route,r}));assert.deepEqual(business(f.db),after);f.save(original);
  });
 });
 test('native HTTP cached preview rejects current pending mode after held body without operational effects',async t=>{
  const f=await fixture(t),a=f.actor({permissions:['company.configure']});let after;const r=await f.heldBody(a,'/api/payroll/preview',{csv:'synthetic-invalid',options:{}},()=>{f.pending();after=business(f.db);});assert.equal(r.status,403,JSON.stringify(r));assert.equal(r.body.result,undefined);assert.deepEqual(business(f.db),after);
 });
 test('native HTTP actual SETUP_ONLY load and mutation deny before operational effects',async t=>{
  const f=await fixture(t),a=f.actor({permissions:['company.configure']}),s=f.state(),mutation={version:s.version,command:'jurisdiction',payload:{country:'GB-SCT'}};let before;const held=await f.heldBody(a,'/api/command',mutation,()=>{f.setupOnly();before=business(f.db);});assert.equal(held.status,403,JSON.stringify(held));assert.equal(held.body.result,undefined);assert.deepEqual(business(f.db),before);const journal=f.db.prepare('SELECT * FROM customer_workspace_runtime_state_events ORDER BY created_at').all();
  for(const [route,body]of [['/api/bootstrap',undefined],['/api/command',{version:s.version,command:'jurisdiction',payload:{country:'GB-SCT'}}]]){const denied=await f.request(a,route,body);assert.equal(denied.status,403,JSON.stringify({route,denied}));assert.equal(denied.body.result,undefined);assert.deepEqual(business(f.db),before);assert.deepEqual(f.db.prepare('SELECT * FROM customer_workspace_runtime_state_events ORDER BY created_at').all(),journal);}
 });
 test('native HTTP cached preview schema corruption stays held after fixture DDL restoration',async t=>{
  const f=await fixture(t),a=f.actor({permissions:['company.configure']}),before=business(f.db),trigger=f.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='customer_workspace_runtime_state' ORDER BY name LIMIT 1").get();assert.ok(trigger);const r=await f.heldBody(a,'/api/payroll/preview',{csv:'synthetic-invalid',options:{}},()=>f.db.exec('DROP TRIGGER '+trigger.name));assert.equal(r.status,503,JSON.stringify(r));assert.deepEqual(business(f.db),before);f.db.exec(trigger.sql);assert.equal((await f.request(a,'/api/bootstrap')).status,503,'Later DDL cannot clear a process schema hold');
 });
 test('native HTTP known-held startup retains health and contain-first session deletion under audit fault',async t=>{
  const f=await fixture(t,{held:true}),a=f.actor({email:'held@example.invalid'});assert.equal(f.heldPreflights.length,1,'Actual early-bind process-held marker must be observed, never inferred from listener timing');assert.equal(f.heldPreflights[0].canonicalTables,0,'Native early preflight creates no missing canonical replacement');assert.equal(f.heldPreflights[0].tenants,1);assert.equal((await f.request(a,'/api/bootstrap')).status,503);assert.equal(f.db.prepare('SELECT count(*) n FROM tenants').get().n,1);if(f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='customer_workspaces'").get().n)assert.equal(f.db.prepare('SELECT count(*) n FROM customer_workspaces').get().n,0,'Later service DDL must not fabricate customer facts or clear native hold');
  f.db.prepare('UPDATE sessions SET source_hash=?,source_basis=?,source_authoritative=1,client_hash=?,last_seen=? WHERE token_hash=?').run(hash('192.0.2.25').slice(0,24),'direct-peer',hash('old-synthetic-client').slice(0,24),Date.now(),a.digest);f.db.exec("CREATE TRIGGER native_security_fault BEFORE INSERT ON audit_events WHEN NEW.action='session-revoked-context-divergence' BEGIN SELECT RAISE(ABORT,'Synthetic audit interruption');END");
  const denied=await f.request(a,'/api/bootstrap');assert.equal(denied.status,401,JSON.stringify(denied));assert.equal(f.db.prepare('SELECT count(*) n FROM sessions WHERE token_hash=?').get(a.digest).n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM tenants').get().n,1);
 });
 test('native HTTP AI result is fenced after its await before cache write and return',async t=>{
  const f=await fixture(t,{gateAI:true}),a=f.actor({permissions:['company.configure']}),original=f.state(),request=f.request(a,'/api/ai',{scope:a.personId,period:'weekly'}),id=await f.awaitAI();const changed=structuredClone(original);changed.org[0].id='changed-ai-root';f.save(changed);const after=business(f.db);f.releaseAI(id);const denied=await request;assert.equal(denied.status,403,JSON.stringify(denied));assert.equal(denied.body.text,undefined);assert.deepEqual(business(f.db),after);
  f.save(original);const fresh=f.actor({permissions:['company.configure']}),retry=f.request(fresh,'/api/ai',{period:'weekly'}),next=await f.awaitAI();assert.notEqual(next,id,'Denied response must not enter cache');f.releaseAI(next);const allowed=await retry;assert.equal(allowed.status,200,JSON.stringify(allowed));assert.equal(allowed.body.text,'SYNTHETIC-ADVISORY-'+next);const replay=await f.request(fresh,'/api/ai',{period:'weekly'});assert.equal(replay.status,200);assert.equal(replay.body.text,allowed.body.text);assert.equal(f.aiCalls.length,0,'Genuine unchanged cache replay performs no new advisory fetch');
 });
 for(const kind of ['authority','pending mode'])test('native HTTP AI post-await '+kind+' drift denies advisory disclosure',async t=>{
  const f=await fixture(t,{gateAI:true}),a=f.actor({permissions:['company.configure']}),request=f.request(a,'/api/ai',{period:'weekly'}),id=await f.awaitAI();
  if(kind==='authority')f.db.prepare("UPDATE users SET permissions='[]' WHERE email=?").run(a.email);else f.pending();
  const after=business(f.db);f.releaseAI(id);const denied=await request;assert.equal(denied.status,403,JSON.stringify(denied));assert.equal(denied.body.text,undefined);assert.deepEqual(business(f.db),after);
 });
}
