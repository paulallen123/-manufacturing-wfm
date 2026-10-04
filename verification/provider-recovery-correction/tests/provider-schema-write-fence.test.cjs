'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const New=require('../operations/runtime/provider-job-store.cjs'),Old=require('./load-sealed-provider-store.cjs');
const spec={tenant:'isolated-a',connectorId:'synthetic',provider:'synthetic',objectType:'employee',adapterName:'synthetic',providerVersion:'1',fixtureContract:'sql-write-fence',runKey:'one-run',startRequest:{page:1},maxFailures:1};
test('persistent guard rejects old connection callbacks and reacquisition after reopen',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-schema-fence-')),file=path.join(dir,'jobs.db');let db=new DatabaseSync(file),other;let now=1000000;
 try{let old=Old.createStore(db,{now:()=>now}),job=old.ensure(spec);old.acquire(job.id,'reused',{leaseMs:1000});now+=1001;
 const fresh=New.createStore(db,{now:()=>now}),lease=fresh.acquire(job.id,'reused',{leaseMs:1000}),actor={tenant:spec.tenant,permissions:['company.configure']},before=fresh.detail(actor,job.id);
 other=new DatabaseSync(file);old=Old.createStore(other,{now:()=>now});
 for(const action of [()=>old.checkpoint(job.id,'reused',{pages:1}),()=>old.complete(job.id,'reused'),()=>old.fail(job.id,'reused',Error('old'))])assert.throws(action,/vector_provider_write_fence/);
 assert.deepEqual(fresh.detail(actor,job.id),before);other.close();other=null;db.close();db=new DatabaseSync(file);
 old=Old.createStore(db,{now:()=>now});now+=1001;assert.throws(()=>old.acquire(job.id,'reused',{leaseMs:1000}),/vector_provider_write_fence/);
 const resumed=New.createStore(db,{now:()=>now}),successor=resumed.acquire(job.id,'reused',{leaseMs:1000});assert.equal(successor.leaseGeneration,lease.leaseGeneration+1);
 resumed.complete(job.id,'reused',{leaseGeneration:successor.leaseGeneration});assert.equal(resumed.raw(job.id).state,'completed');
 }finally{other?.close();db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('multiple current stores on one connection share narrow write authority',()=>{
 const db=new DatabaseSync(':memory:');try{const first=New.createStore(db),second=New.createStore(db),job=first.ensure(spec),lease=first.acquire(job.id,'current');second.checkpoint(job.id,'current',{leaseGeneration:lease.leaseGeneration,pages:1,nextRequest:null});first.complete(job.id,'current',{leaseGeneration:lease.leaseGeneration});assert.equal(second.raw(job.id).state,'completed');assert.throws(()=>db.prepare("UPDATE provider_adapter_runs SET state='retry' WHERE id=?").run(job.id),/current store authority/);}finally{db.close();}
});
test('audit rollback clears write authority before legacy requeue',()=>{
 const db=new DatabaseSync(':memory:');try{const fresh=New.createStore(db),old=Old.createStore(db),job=fresh.ensure(spec),lease=fresh.acquire(job.id,'current');fresh.fail(job.id,'current',Error('failure'),{leaseGeneration:lease.leaseGeneration});const actor={tenant:spec.tenant,email:'reviewer',permissions:['company.configure']},before=fresh.detail(actor,job.id);db.exec("CREATE TRIGGER stop_requeue_event BEFORE INSERT ON provider_adapter_run_events WHEN NEW.event_type='requeued' BEGIN SELECT RAISE(ABORT,'isolated audit outage');END;");assert.throws(()=>fresh.requeue(actor,job.id,{reason:'Reviewed isolated cause'}),/isolated audit outage/);db.exec('DROP TRIGGER stop_requeue_event');assert.throws(()=>old.requeue(actor,job.id,{reason:'Reviewed isolated cause'}),/current store authority/);assert.deepEqual(fresh.detail(actor,job.id),before);fresh.requeue(actor,job.id,{reason:'Reviewed isolated cause'});assert.equal(fresh.raw(job.id).state,'retry');}finally{db.close();}
});
