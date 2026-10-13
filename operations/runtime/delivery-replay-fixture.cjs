'use strict';
const {createHash}=require('node:crypto');
const {Readable}=require('node:stream');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const path=require('node:path');
const {createDemandDecisionService}=require('./demand-decision-service.cjs');
const sha=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
function input({site='south-plant',tenant='tenant-heldout',optionAllowed=true}={}){
 const base=Date.parse('2026-10-12T20:00:00.000Z'),at=new Date(base).toISOString();
 const scope={tenant,site,line:'line-heldout',order:'order-heldout',material:'material-heldout',shipment:'shipment-heldout'};
 const source=(kind,payload)=>({kind,id:'record-'+kind,scope:{...scope},source:'source-owned-'+kind,
  sourceRevision:'head-7',revision:7,recordHash:sha(payload),observedAt:new Date(base-5*60000).toISOString(),confidence:0.99,payload});
 return {scope,asOf:at,policy:{version:'policy-heldout-4',currency:'GBP',maxAgeMinutes:15,minConfidence:0.9},evidence:[
  source('inventory',{quantityOnHand:20,safetyStock:0,unit:'units'}),
  source('consumption',{quantityPerHour:20,startsAt:at,unit:'units'}),
  source('requirement',{remainingQuantity:100,requiredAt:new Date(base+3600000).toISOString(),unit:'units'}),
  source('eta',{arrivesAt:new Date(base+4*3600000).toISOString()}),
  source('economics',{currency:'GBP',lostContributionPerHour:9000,idleLabourPerHour:2000,recoveryOvertimePerHour:1000,customerPenalty:4000,componentsNonOverlapping:true})
 ],options:[{id:'heldout-recovery',kind:'RESEQUENCE',recoveredHours:1,costUpper:1000,avoidedCostLower:9000,
  sourceRef:'trusted-option-revision:7',feasibility:{safety:true,quality:optionAllowed,qualifiedStaff:true,capacity:true,approvalRoute:true}}]};
}
function fixture(){
 const scratch=require('node:os').tmpdir();
 const dir=fs.mkdtempSync(path.join(scratch,'heldout-'));
 const dbPath=path.join(dir,'review.sqlite');const db=new DatabaseSync(dbPath);
 db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL,person_id TEXT,costs INTEGER,permissions TEXT);'+
  'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);'+
  'CREATE TABLE tenants(id TEXT PRIMARY KEY,version INTEGER,state TEXT);');
 const users=[['limited','supervisor','north-supervisor',0],['cost-authorised','manager','north-manager',1],['unknown','unknown-role','north-supervisor',0],['other','manager','south-manager',1]];
 for(const [name,role,person,costs] of users){
  const tenant=name==='other'?'tenant-other':'tenant-heldout',email=name+'@heldout.invalid';
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(email,tenant,role,person,costs,JSON.stringify(['schedule.read']));
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(name),email,Date.now()+600000);
 }
 const state={version:1,org:[{id:'north-manager',parent:null,role:'Factory manager'},{id:'north-supervisor',parent:'north-manager',role:'Team leader'},{id:'south-manager',parent:null,role:'Factory manager'}],staff:[{id:'worker-north',manager:'north-supervisor',site:'north-plant'},{id:'worker-south',manager:'south-manager',site:'south-plant'}],operations:{siteAccess:{}}};
 db.prepare('INSERT INTO tenants VALUES(?,?,?)').run('tenant-heldout',1,JSON.stringify(state));
 return {dir,dbPath,db,close(){db.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
function verifierFor(snapshot){
 const records=new Map(snapshot.evidence.map(e=>[e.kind,sha(e)])),scope=sha(snapshot.scope),policy=sha(snapshot.policy),options=sha(snapshot.options);
 return (candidate,tenant)=>candidate.scope?.tenant===tenant&&sha(candidate.scope)===scope&&sha(candidate.policy)===policy&&
  candidate.evidence.length===records.size&&candidate.evidence.every(e=>records.get(e.kind)===sha(e))&&sha(candidate.options)===options;
}
function request(method,url,body,name){
 const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);req.method=method;req.url=url;
 req.headers=name?{cookie:'wfm_session='+name}:{'x-wfm-demand-internal':'heldout-worker-token'};return req;
}
async function call(service,req){
 const res={statusCode:200,headers:{},headersSent:false,writableEnded:false,setHeader(k,v){this.headers[k]=v;},end(data){this.body=String(data);this.headersSent=this.writableEnded=true;}};
 await service.handleRequest(req,res);return {status:res.statusCode,body:JSON.parse(res.body)};
}
const post=(service,value)=>call(service,request('POST','/api/operations/intelligence/delivery-disruption/shadow',{tenant:value.scope.tenant,input:value}));
const read=(service,name,path='/delivery-disruptions')=>call(service,request('GET','/api/operations/intelligence'+path,undefined,name));
const serviceFor=(f,verifyDeliveryEvidence)=>createDemandDecisionService({dbPath:f.dbPath,internalToken:'heldout-worker-token',verifyDeliveryEvidence});
const rows=f=>f.db.prepare('SELECT tenant,digest,result_json FROM vector_delivery_disruption_shadows').all();
module.exports={input,fixture,verifierFor,post,read,serviceFor,rows,sha,request,call};
