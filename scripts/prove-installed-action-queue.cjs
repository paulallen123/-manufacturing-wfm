'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process'),{createHash}=require('node:crypto');
const TEST_FILES=['vector-action-queue.test.cjs','vector-gusto.test.cjs','vector-staffology-controls.test.cjs','vector-settings-navigation.test.cjs'];
function extractUniqueBytes(bundle,source){
 if(!Buffer.isBuffer(bundle)||!Buffer.isBuffer(source)||source.length===0)throw Error('BUNDLE_BYTES_REQUIRED');
 const at=bundle.indexOf(source);
 if(at<0||bundle.indexOf(source,at+1)!==-1)throw Error('INSTALLED_SEGMENT_MISSING_OR_AMBIGUOUS');
 return Buffer.from(bundle.subarray(at,at+source.length));
}
function assertRuntimeBinding(version,expected,installed){
 if(version!=='v22.23.2'||typeof expected!=='string'||!/^[a-f0-9]{40}$/.test(expected)||typeof installed!=='string'||installed.trim()!==expected)throw Error('RUNTIME_SOURCE_BINDING_MISMATCH');
}
function assertCompleteTap(output,status){
 if(status!==0||typeof output!=='string')throw Error('INSTALLED_TEST_PROCESS_FAILED');
 for(const [name,expected] of Object.entries({tests:49,pass:49,fail:0,cancelled:0,skipped:0,todo:0})){
  const matches=[...output.matchAll(new RegExp('^# '+name+' (\\d+)\\r?$','gm'))];
  if(matches.length!==1||Number(matches[0][1])!==expected)throw Error('INSTALLED_TAP_INCOMPLETE_'+name);
 }
}
function readRegular(file){if(!fs.lstatSync(file).isFile())throw Error('REGULAR_FILE_REQUIRED');return fs.readFileSync(file);}
function run(){
 const root='/proof-source',runtime='/app/public';
 const expected=process.env.VECTOR_EXPECTED_SOURCE_SHA,imageId=process.env.VECTOR_PROOF_IMAGE_ID;
 assertRuntimeBinding(process.version,expected,readRegular('/app/.wfm-build-source-sha').toString('utf8'));
 if(!/^sha256:[a-f0-9]{64}$/.test(imageId||''))throw Error('IMAGE_ID_REQUIRED');
 const jsBundle=readRegular(path.join(runtime,'vector-ui.js')),cssBundle=readRegular(path.join(runtime,'vector-ui.css'));
 const shell=extractUniqueBytes(jsBundle,readRegular(path.join(root,'ux-overlay/vector-shell.js')));
 const css=extractUniqueBytes(cssBundle,readRegular(path.join(root,'ux-overlay/vector-shell.css')));
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vector-installed-action-queue-'));
 try{
  fs.writeFileSync(path.join(directory,'vector-shell.js'),shell);
  fs.writeFileSync(path.join(directory,'vector-shell.css'),css);
  for(const file of TEST_FILES)fs.writeFileSync(path.join(directory,file),readRegular(path.join(root,'ux-overlay',file)));
  const result=spawnSync(process.execPath,['--test','--test-reporter=tap',...TEST_FILES.map(file=>path.join(directory,file))],{encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
  process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
  assertCompleteTap(result.stdout,result.status);
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  console.log('VECTOR_INSTALLED_ACTION_QUEUE=PASS '+JSON.stringify({sourceSha:expected,imageId,node:process.version,tests:49,failures:0,skips:0,shellSha256:hash(shell),cssSha256:hash(css),installedJsSha256:hash(jsBundle),installedCssSha256:hash(cssBundle),claim:'Installed byte-identical shell segment in synthetic VM tests; composed browser and hosted customer proof remain unproven.'}));
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
}
module.exports={extractUniqueBytes,assertRuntimeBinding,assertCompleteTap};
if(require.main===module)run();
