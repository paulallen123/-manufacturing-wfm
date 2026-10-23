'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {once}=require('node:events');
const {startReceipt}=require('./isolated-build-receipt.cjs');
const sha='1234567890abcdef1234567890abcdef12345678';

function fixture(t,contents=sha+'\n') {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'build-receipt-'));
  const sourcePath=path.join(dir,'source-sha');
  fs.writeFileSync(sourcePath,contents);
  const prior=process.env.RAILWAY_GIT_COMMIT_SHA;
  process.env.RAILWAY_GIT_COMMIT_SHA=sha;
  t.after(()=>{if(prior===undefined)delete process.env.RAILWAY_GIT_COMMIT_SHA;else process.env.RAILWAY_GIT_COMMIT_SHA=prior;fs.rmSync(dir,{recursive:true,force:true});});
  return {sourcePath,expectedSourceSha:sha,port:0,allowEphemeralPort:true};
}

function request(url,method='GET') {
  return new Promise((resolve,reject)=>{
    const req=http.request(url,{method,agent:false},res=>{
      let body='';res.setEncoding('utf8');res.on('data',chunk=>{body+=chunk;});
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));
    });
    req.once('error',reject);req.end();
  });
}

test('missing or malformed identities refuse synchronously before any listener',t=>{
  const options=fixture(t);
  fs.unlinkSync(options.sourcePath);
  assert.throws(()=>startReceipt(options),/ENOENT/);
  fs.mkdirSync(options.sourcePath);
  assert.throws(()=>startReceipt(options),/EISDIR/);
  fs.rmdirSync(options.sourcePath);
  for(const value of ['', 'not-a-sha', sha+'extra',sha.toUpperCase()]){
    fs.writeFileSync(options.sourcePath,value);
    assert.throws(()=>startReceipt(options),/INVALID_IDENTITY/);
  }
  fs.writeFileSync(options.sourcePath,sha);
  delete process.env.RAILWAY_GIT_COMMIT_SHA;
  assert.throws(()=>startReceipt(options),/INVALID_IDENTITY/);
  process.env.RAILWAY_GIT_COMMIT_SHA='invalid';
  assert.throws(()=>startReceipt(options),/INVALID_IDENTITY/);
  process.env.RAILWAY_GIT_COMMIT_SHA=sha;
  for(const value of [undefined,'', 'invalid'])assert.throws(()=>startReceipt({...options,expectedSourceSha:value}),/INVALID_IDENTITY/);
});

test('both provider mismatch and unapproved matching image/provider refuse',t=>{
  const options=fixture(t);
  const other='a'.repeat(40);
  process.env.RAILWAY_GIT_COMMIT_SHA=other;
  assert.throws(()=>startReceipt(options),/IDENTITY_MISMATCH/);
  fs.writeFileSync(options.sourcePath,other);
  assert.throws(()=>startReceipt(options),/IDENTITY_MISMATCH/);
});

test('invalid ports refuse before listening',t=>{
  const options=fixture(t);
  assert.throws(()=>startReceipt({...options,allowEphemeralPort:false}),/INVALID_PORT/);
  for(const port of [undefined,'',-1,'1.5','1e3',65536,' 3000','3000x'])assert.throws(()=>startReceipt({...options,port}),/INVALID_PORT/);
});

test('serialized deployed function reports only bound identity and closes on SIGTERM',async t=>{
  const options=fixture(t);
  // The deployed node -e command embeds this function body, not this test module.
  const serialized=eval('('+startReceipt.toString()+')');
  const server=serialized(options);
  t.after(()=>{server.close();server.closeAllConnections();});
  await once(server,'listening');
  const origin='http://127.0.0.1:'+server.address().port;
  const response=await request(origin+'/');
  assert.equal(response.status,200);
  assert.equal(response.headers['cache-control'],'no-store');
  const body=JSON.parse(response.body);
  assert.equal(body.sourceCommit,sha);
  assert.equal(body.status,'IMAGE_IDENTITY_MATCHED');
  assert.equal(body.sourceTree,undefined);
  assert.match(body.scope,/customer application and Golden Journey not verified/);
  assert.equal((await request(origin+'/api/health')).status,404);
  assert.equal((await request(origin+'/','POST')).status,404);
  const closed=once(server,'close');
  process.emit('SIGTERM');
  await closed;
  assert.equal(server.listening,false);
});
