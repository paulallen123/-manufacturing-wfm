import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const require=createRequire(import.meta.url);
const {validateVideoGenerationJob}=require('./runtime/training-video-contract.cjs');
const PORT=Number(process.env.PORT||3000);
const JOB_PATH=process.env.TRAINING_JOB_PATH||'/data/job.json';
const OUTPUT_ROOT=process.env.TRAINING_OUTPUT_ROOT||'/data/training-output';
let state={running:true,passed:false,error:null,receipt:null};

function sha256File(file){return createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function msTime(ms){
  const total=Math.max(0,Math.round(ms));
  const h=Math.floor(total/3600000),m=Math.floor((total%3600000)/60000),s=Math.floor((total%60000)/1000),x=total%1000;
  return [String(h).padStart(2,'0'),String(m).padStart(2,'0'),String(s).padStart(2,'0')].join(':')+'.'+String(x).padStart(3,'0');
}
function vtt(cues){return 'WEBVTT\n\n'+cues.map(c=>msTime(c.start)+' --> '+msTime(c.end)+'\n'+c.text.replace(/-->/g,'→')).join('\n\n')+'\n';}
function privacyScan(text){
  const emails=[...text.matchAll(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi)].map(m=>m[0]);
  const nonSynthetic=emails.filter(value=>!/@(?:[a-z0-9-]+\.)*example$/i.test(value));
  const ni=/\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/i.test(text);
  const secrets=/(sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9._~+\/-]{20,}|BEGIN\s+(?:RSA|OPENSSH|EC)\s+PRIVATE\s+KEY)/i.test(text);
  return {pii:nonSynthetic.length||ni?'FAIL':'PASS',secrets:secrets?'FAIL':'PASS',nonSyntheticEmails:nonSynthetic.slice(0,5)};
}
function safeJob(){
  const job=JSON.parse(fs.readFileSync(JOB_PATH,'utf8'));
  const validation=validateVideoGenerationJob(job);
  if(!validation.ok) throw new Error('Training job rejected: '+validation.errors.join(','));
  return job;
}
async function addOverlay(page,title,instruction,index,total){
  await page.evaluate(({title,instruction,index,total})=>{
    let root=document.getElementById('vector-training-capture-overlay');
    if(!root){
      root=document.createElement('aside');
      root.id='vector-training-capture-overlay';
      Object.assign(root.style,{position:'fixed',left:'28px',right:'28px',bottom:'28px',zIndex:'2147483600',padding:'18px 22px',borderRadius:'16px',background:'rgba(15,23,42,.94)',color:'#fff',boxShadow:'0 18px 50px rgba(0,0,0,.28)',fontFamily:'system-ui,sans-serif',pointerEvents:'none'});
      document.body.appendChild(root);
    }
    root.replaceChildren();
    const meta=document.createElement('div');meta.textContent='VECTOR GUIDE · '+index+' / '+total;Object.assign(meta.style,{fontSize:'11px',fontWeight:'800',letterSpacing:'.08em',opacity:'.72',marginBottom:'6px'});
    const heading=document.createElement('strong');heading.textContent=title;Object.assign(heading.style,{fontSize:'22px',display:'block',lineHeight:'1.2'});
    const body=document.createElement('span');body.textContent=instruction;Object.assign(body.style,{fontSize:'15px',display:'block',lineHeight:'1.45',marginTop:'6px',maxWidth:'1000px'});
    root.append(meta,heading,body);
  },{title,instruction,index,total});
}
async function run(){
  const job=safeJob();
  const outputDir=path.join(OUTPUT_ROOT,job.artifactFingerprint);
  fs.mkdirSync(outputDir,{recursive:true});
  const accessUrl=process.env.TRAINING_ACCESS_URL||job.targetOrigin+'/?vector_home=1';
  if(new URL(accessUrl).origin!==job.targetOrigin) throw new Error('Training access origin must match the verified target origin.');

  let browser,context,page,video;
  const consoleErrors=[],observedSelectors=[],screenshots=[],cues=[];
  const recordingStart=Date.now();
  try{
    browser=await chromium.launch({headless:true});
    context=await browser.newContext({
      recordVideo:{dir:outputDir,size:{width:1440,height:900}},
      viewport:{width:1440,height:900},
      locale:job.locale,
      reducedMotion:'reduce'
    });
    page=await context.newPage();
    video=page.video();
    page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text().slice(0,1000));});
    page.on('pageerror',error=>consoleErrors.push(String(error?.message||error).slice(0,1000)));

    await page.goto(accessUrl,{waitUntil:'domcontentloaded',timeout:45000});
    await page.locator('body.vector-ui-active').waitFor({state:'visible',timeout:30000});
    const navigated=await page.evaluate(async route=>{
      const api=window.VectorWorkforceOperations;
      if(!api||typeof api.go!=='function') return false;
      return await api.go(route);
    },job.capture.route);
    if(navigated!==true) throw new Error('Verified VECTOR navigation refused training route: '+job.capture.route);

    for(const selector of job.capture.requiredSelectors){
      await page.locator(selector).first().waitFor({state:'visible',timeout:15000});
      observedSelectors.push(selector);
    }
    let expectedTextObserved=!job.capture.expectedText;
    if(job.capture.expectedText){
      const match=page.getByText(job.capture.expectedText,{exact:false}).first();
      await match.waitFor({state:'visible',timeout:15000});
      expectedTextObserved=true;
    }
    for(const selector of job.capture.safeFocusSelectors||[]){
      const target=page.locator(selector).first();
      if(await target.count()) await target.focus();
    }

    const introStart=Date.now()-recordingStart;
    await addOverlay(page,job.competencyKey,'This demonstration is generated from the exact verified VECTOR workflow. Watching it does not prove competence.',0,job.script.length);
    await page.waitForTimeout(1800);
    cues.push({start:introStart,end:Date.now()-recordingStart,text:'VECTOR demonstration. Watching guidance does not prove competence.'});

    for(const step of job.script){
      const start=Date.now()-recordingStart;
      await addOverlay(page,step.title,step.instruction,step.index,job.script.length);
      const shot=path.join(outputDir,'step-'+String(step.index).padStart(2,'0')+'.png');
      await page.screenshot({path:shot,fullPage:false});
      screenshots.push({stepId:step.id,file:path.basename(shot),sha256:sha256File(shot)});
      await page.waitForTimeout(3200);
      cues.push({start,end:Date.now()-recordingStart,text:step.title+'. '+step.instruction});
    }

    const visibleText=(await page.locator('body').innerText()).slice(0,250000);
    const scan=privacyScan(visibleText+'\n'+job.script.map(x=>x.title+' '+x.instruction).join('\n'));
    const transcriptFile=path.join(outputDir,'transcript.txt');
    fs.writeFileSync(transcriptFile,job.script.map((x,i)=>String(i+1)+'. '+x.title+'\n'+x.instruction).join('\n\n')+'\n');
    const captionFile=path.join(outputDir,'captions.vtt');
    fs.writeFileSync(captionFile,vtt(cues));
    await context.close(); context=null;
    const videoPath=await video.path();
    const canonicalVideo=path.join(outputDir,'training.webm');
    if(videoPath!==canonicalVideo) fs.renameSync(videoPath,canonicalVideo);

    const receipt={
      contractVersion:'VECTOR_TRAINING_VIDEO_RECEIPT_V1',
      jobId:job.jobId,
      artifactFingerprint:job.artifactFingerprint,
      productSha:job.productSha,
      uiVersion:job.uiVersion,
      sourceClass:'SYNTHETIC',
      capture:{
        route:job.capture.route,
        observedSelectors,
        expectedTextObserved,
        finalHash:new URL(page.url()).hash
      },
      scan,
      consoleErrors,
      media:{
        videoFile:'training.webm',
        videoSha256:sha256File(canonicalVideo),
        captionsFile:'captions.vtt',
        captionsSha256:sha256File(captionFile),
        transcriptFile:'transcript.txt',
        transcriptSha256:sha256File(transcriptFile),
        screenshots,
        durationMs:Date.now()-recordingStart,
        width:1440,
        height:900
      },
      narration:{status:'NOT_CONFIGURED',audioSha256:null},
      publication:{durable:false,url:null},
      generatedAt:new Date().toISOString()
    };
    fs.writeFileSync(path.join(outputDir,'receipt.json'),JSON.stringify(receipt,null,2));
    if(receipt.scan.pii!=='PASS'||receipt.scan.secrets!=='PASS'||consoleErrors.length) throw new Error('Training evidence failed privacy/secret/console admission.');
    state={running:false,passed:true,error:null,receipt};
  } finally {
    try{if(context)await context.close();}catch{}
    try{if(browser)await browser.close();}catch{}
  }
}
http.createServer((req,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.statusCode=state.error?503:200;
  res.end(JSON.stringify(state));
}).listen(PORT,'0.0.0.0');

run().catch(error=>{
  state={running:false,passed:false,error:String(error?.stack||error),receipt:null};
});
