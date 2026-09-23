#!/usr/bin/env node
import assert from 'node:assert/strict';
import http from 'node:http';
import {verifyHostedPublicRuntime} from './verify-hosted-public-runtime.mjs';

async function withServer(handler,fn){
  const server=http.createServer(handler);
  await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',err=>err?reject(err):resolve()));
  const address=server.address();
  try{return await fn('http://127.0.0.1:'+address.port);}
  finally{await new Promise(resolve=>server.close(()=>resolve()));}
}

await withServer((req,res)=>{
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({status:'LIVE_VECTOR_RUNTIME'}));
},async origin=>{
  const r=await verifyHostedPublicRuntime({origin,expectedMarker:'LIVE_VECTOR_RUNTIME',attempts:1,allowHttp:true});
  assert.equal(r.state,'HOSTED_PROVEN');
  assert.equal(r.httpStatus,200);
});

await withServer((req,res)=>{
  res.writeHead(502,{'content-type':'text/html'});
  res.end('Application failed to respond');
},async origin=>{
  await assert.rejects(
    verifyHostedPublicRuntime({origin,expectedMarker:'LIVE_VECTOR_RUNTIME',attempts:1,allowHttp:true}),
    /HTTP 502|failure page/i
  );
});

await withServer((req,res)=>{
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({status:'WRONG_APP'}));
},async origin=>{
  await assert.rejects(
    verifyHostedPublicRuntime({origin,expectedMarker:'LIVE_VECTOR_RUNTIME',attempts:1,allowHttp:true}),
    /identity marker/i
  );
});

console.log('VECTOR_HOSTED_PUBLIC_RUNTIME_VERIFIER=PASS cases=3');
