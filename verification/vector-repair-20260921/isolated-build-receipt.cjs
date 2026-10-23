'use strict';

// Serialized into the existing isolated service's start command. This is not
// customer application startup, and the sealed SHA is artifact-declared identity.
function startReceipt({expectedSourceSha,sourcePath='/app/.wfm-build-source-sha',port=process.env.PORT,allowEphemeralPort=false}={}) {
  const fs=require('node:fs');
  const http=require('node:http');
  const valid=sha=>typeof sha==='string'&&/^[0-9a-f]{40}$/.test(sha);
  const sourceSha=fs.readFileSync(sourcePath,'utf8').trim();
  const runtimeSha=process.env.RAILWAY_GIT_COMMIT_SHA;
  if(!valid(sourceSha)||!valid(runtimeSha)||!valid(expectedSourceSha))throw Error('BUILD_RECEIPT_INVALID_IDENTITY');
  if(sourceSha!==runtimeSha||sourceSha!==expectedSourceSha)throw Error('BUILD_RECEIPT_IDENTITY_MISMATCH');
  if(!/^(0|[1-9][0-9]{0,4})$/.test(String(port))||Number(port)>65535||(Number(port)===0&&!allowEphemeralPort))throw Error('BUILD_RECEIPT_INVALID_PORT');
  const receipt=JSON.stringify({status:'IMAGE_IDENTITY_MATCHED',scope:'Isolated image admission only; customer application and Golden Journey not verified',identityBasis:'artifact-declared SHA matched Railway runtime SHA and reviewed expected SHA',sourceCommit:sourceSha});
  const server=http.createServer((req,res)=>{
    if(req.method!=='GET'||req.url!=='/'){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(receipt);
  });
  const stop=()=>{server.close();server.closeAllConnections();};
  process.once('SIGTERM',stop);
  server.once('close',()=>process.removeListener('SIGTERM',stop));
  server.listen(Number(port),'0.0.0.0');
  return server;
}

module.exports={startReceipt};
