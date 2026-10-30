import {constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const requiredArtifacts=Object.freeze([
 'source-sha.txt','image-inspect.json','runtime-container-image-id.txt',
 'auth-client-source-sha.txt','auth-client-image-inspect.json','auth-client-image-node-version.txt','auth-client-module-smoke.log',
 'staffology/source-sha.txt','staffology/STAFFOLOGY_ASSEMBLY.json','staffology/LOCAL_PROOF_PROVENANCE.json','staffology/staffology-full.tap',
 'staffology-proof-build.log','runtime-image-build.log','auth-client-image-build.log','production-refusal.log',
 'runtime-identity.json','runtime-identity.headers','hosted-http-diagnostics.log','health.json','bootstrap-unauth.json','demand-unauth.json'
]);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const refuse=code=>{throw Error('RUNTIME_ARTIFACT_MANIFEST_REFUSED '+code);};
const imageId=value=>typeof value==='string'&&/^sha256:[0-9a-f]{64}$/.test(value);

function readArtifact(root,relative){
 let descriptor;
 try{
  let directory=root;
  for(const component of ['',...relative.split('/').slice(0,-1)]){
   directory=component?path.join(directory,component):directory;
   const info=lstatSync(directory);
   if(!info.isDirectory()||info.isSymbolicLink())refuse('NONREGULAR_DIRECTORY');
  }
  const target=path.join(root,relative),info=lstatSync(target);
  if(!info.isFile()||info.isSymbolicLink())refuse('NONREGULAR_ARTIFACT');
  descriptor=openSync(target,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  if(!fstatSync(descriptor).isFile())refuse('NONREGULAR_ARTIFACT');
  const bytes=readFileSync(descriptor);
  if(!bytes.length)refuse('EMPTY_ARTIFACT');
  return bytes;
 }catch(error){
  if(error.message?.startsWith('RUNTIME_ARTIFACT_MANIFEST_REFUSED '))throw error;
  refuse('UNREADABLE_ARTIFACT');
 }finally{if(descriptor!==undefined)closeSync(descriptor);}
}
function json(bytes){try{return JSON.parse(bytes.toString('utf8'));}catch{refuse('INVALID_JSON');}}
function inspectedImage(bytes){const rows=json(bytes);if(!Array.isArray(rows)||rows.length!==1||!imageId(rows[0]?.Id))refuse('INVALID_IMAGE_ID');return rows[0].Id;}
function header(bytes,name,expected){
 const values=bytes.toString('utf8').split(/\r?\n/).filter(line=>line.toLowerCase().startsWith(name+':')).map(line=>line.slice(line.indexOf(':')+1).trim());
 if(values.length!==1||values[0]!==expected)refuse('IDENTITY_HEADER_MISMATCH');
}

export function createRuntimeArtifactManifest(directory,sourceSha){
 if(typeof sourceSha!=='string'||!/^[0-9a-f]{40}$/.test(sourceSha))refuse('INVALID_SOURCE_SHA');
 const root=path.resolve(directory),files=new Map(requiredArtifacts.map(relative=>[relative,readArtifact(root,relative)]));
 for(const name of ['source-sha.txt','auth-client-source-sha.txt','staffology/source-sha.txt'])if(files.get(name).toString('utf8').trim()!==sourceSha)refuse('SOURCE_MISMATCH');
 const runtimeImageId=inspectedImage(files.get('image-inspect.json')),authClientImageId=inspectedImage(files.get('auth-client-image-inspect.json'));
 if(files.get('runtime-container-image-id.txt').toString('utf8').trim()!==runtimeImageId)refuse('CONTAINER_IMAGE_MISMATCH');
 if(files.get('auth-client-image-node-version.txt').toString('utf8').trim()!=='v22.23.2')refuse('CLIENT_NODE_MISMATCH');
 const identity=json(files.get('runtime-identity.json'));
 if(identity?.candidateSha!==sourceSha||identity.sourceBinding!=='build-file-matched'||identity.fixtureOnly!==true||identity.productionApproved!==false||identity.pilotReady!==false)refuse('RUNTIME_IDENTITY_MISMATCH');
 header(files.get('runtime-identity.headers'),'x-wfm-source-sha',sourceSha);
 header(files.get('runtime-identity.headers'),'x-wfm-source-binding','build-file-matched');
 const smokeLines=files.get('auth-client-module-smoke.log').toString('utf8').split(/\r?\n/).filter(line=>line.startsWith('{'));
 if(smokeLines.length!==1)refuse('CLIENT_SMOKE_MISSING');
 const smoke=json(Buffer.from(smokeLines[0]));
 if(smoke.scope!=='PACKAGING_MODULE_SMOKE_ONLY'||smoke.checkoutSourceSha!==sourceSha||smoke.sqliteAvailable!==true||smoke.signedSessionExecuted!==false||smoke.chromiumExecuted!==false||smoke.hostedProof!==false)refuse('CLIENT_SMOKE_MISMATCH');
 const diagnostics=files.get('hosted-http-diagnostics.log').toString('utf8').split(/\r?\n/);
 for(const check of ['health-ready','runtime-identity-build-file-matched','root-page','bootstrap-unauthenticated-401','demand-unauthenticated-401'])if(!diagnostics.includes('HOSTED_HTTP_ASSERTION=PASS check='+check))refuse('HTTP_RECEIPT_MISSING');
 if(!diagnostics.some(line=>/^VECTOR_APPLICATION_UID=PASS real=[1-9][0-9]* effective=[1-9][0-9]* saved=[1-9][0-9]* filesystem=[1-9][0-9]*$/.test(line)))refuse('UID_RECEIPT_MISSING');
 return {
  schemaVersion:1,scope:'CI_ARTIFACT_IDENTITY_MANIFEST_ONLY',sourceSha,
  runtimeImageId,authClientImageId,imageIdKind:'Docker local image ID',
  artifacts:requiredArtifacts.map(relative=>({path:relative,bytes:files.get(relative).length,sha256:sha256(files.get(relative))})),
  signed:false,registryDigestAttested:false,testCountsVerified:false,providerAuthority:false,hostedCustomerProof:false
 };
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==4)refuse('USAGE');
  const manifest=createRuntimeArtifactManifest(process.argv[2],process.argv[3]);
  const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
  writeFileSync(path.join(path.resolve(process.argv[2]),'artifact-manifest.json'),bytes,{flag:'wx',mode:0o644});
  console.log('RUNTIME_ARTIFACT_MANIFEST=WRITTEN source='+manifest.sourceSha+' sha256='+sha256(bytes));
 }catch(error){
  console.error(error.message?.startsWith('RUNTIME_ARTIFACT_MANIFEST_REFUSED ')?error.message:'RUNTIME_ARTIFACT_MANIFEST_REFUSED OUTPUT_UNAVAILABLE');
  process.exitCode=1;
 }
}
