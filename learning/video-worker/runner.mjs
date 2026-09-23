import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

const require=createRequire(import.meta.url);
const {validateVideoGenerationJob}=require('./runtime/training-video-contract.cjs');
const {validateNarrationReceipt}=require('./runtime/training-voice-contract.cjs');
const PORT=Number(process.env.PORT||3000);
const JOB_PATH=process.env.TRAINING_JOB_PATH||'/data/job.json';
const OUTPUT_ROOT=process.env.TRAINING_OUTPUT_ROOT||'/data/training-output';
const NARRATION_PATH=process.env.TRAINING_NARRATION_PATH||'';
const NARRATION_RECEIPT_PATH=process.env.TRAINING_NARRATION_RECEIPT_PATH||'';
let state={running:true,passed:false,error:null,receipt:null};

function sha256File(file){return createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function mediaDurationMs(file){
  const raw=execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',file],{encoding:'utf8'}).trim();
  const seconds=Number(raw);
  if(!Number.isFinite(seconds)||seconds<=0) throw new Error('Rendered video duration could not be verified.');
  return Math.round(seconds*1000);
}
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
function narrationBinding(job){
  if(!NARRATION_PATH&&!NARRATION_RECEIPT_PATH) return null;
  if(!NARRATION_PATH||!NARRATION_RECEIPT_PATH) throw new Error('Narration audio and receipt must be supplied together.');
  if(!fs.existsSync(NARRATION_PATH)||!fs.existsSync(NARRATION_RECEIPT_PATH)) throw new Error('Narration evidence files are unavailable.');
  const receipt=JSON.parse(fs.readFileSync(NARRATION_RECEIPT_PATH,'utf8'));
  const validation=validateNarrationReceipt(job.narration.job,receipt);
  if(!validation.ok) throw new Error('Narration receipt rejected: '+validation.errors.join(','));
  return {receipt,validation,audioPath:NARRATION_PATH};
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
  const narration=narrationBinding(job);
  const width=Number(job.composition?.resolution?.width||1440);
  const height=Number(job.composition?.resolution?.height||900);
  const sceneById=new Map((job.composition?.scenes||[]).map(scene=>[scene.id,scene]));
  const timingById=new Map((narration?.receipt?.segmentTimings||[]).map(timing=>[timing.id,timing]));
  const pauseById=new Map((job.narration?.job?.segments||[]).map(segment=>[segment.id,Number(segment.pauseAfterMs||0)]));
  function holdFor(id,fallback){
    const timing=timingById.get(id);
    if(!timing) return Number(fallback);
    return Math.max(Number(fallback)||0,Math.round(Number(timing.endMs)-Number(timing.startMs)+Number(pauseById.get(id)||0)+220));
  }
  const recordingStart=Date.now();
  try{
    browser=await chromium.launch({headless:true});
    context=await browser.newContext({
      recordVideo:{dir:outputDir,size:{width,height}},
      viewport:{width,height},
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
    await page.waitForTimeout(holdFor('intro',Number(sceneById.get('intro')?.holdMs||1800)));
    cues.push({start:introStart,end:Date.now()-recordingStart,text:'VECTOR demonstration. Watching guidance does not prove competence.'});

    for(const step of job.script){
      const start=Date.now()-recordingStart;
      await addOverlay(page,step.title,step.instruction,step.index,job.script.length);
      const shot=path.join(outputDir,'step-'+String(step.index).padStart(2,'0')+'.png');
      await page.screenshot({path:shot,fullPage:false});
      screenshots.push({stepId:step.id,file:path.basename(shot),sha256:sha256File(shot)});
      await page.waitForTimeout(holdFor(step.id,Number(sceneById.get(step.id)?.holdMs||3200)));
      cues.push({start,end:Date.now()-recordingStart,text:step.title+'. '+step.instruction});
    }

    const visibleText=(await page.locator('body').innerText()).slice(0,250000);
    const scan=privacyScan(visibleText+'\n'+job.script.map(x=>x.title+' '+x.instruction).join('\n'));
    const recap=sceneById.get('recap');
    if(recap){
      const start=Date.now()-recordingStart;
      await addOverlay(page,recap.title,recap.narration,job.script.length+1,job.script.length+1);
      await page.waitForTimeout(holdFor('recap',Number(recap.holdMs||2200)));
      cues.push({start,end:Date.now()-recordingStart,text:recap.narration});
    }
    const transcriptFile=path.join(outputDir,'transcript.txt');
    const transcriptScenes=(job.composition?.scenes||[]).map((scene,index)=>String(index+1)+'. '+scene.title+'\n'+scene.narration).join('\n\n')+'\n';
    fs.writeFileSync(transcriptFile,transcriptScenes);
    const captionFile=path.join(outputDir,'captions.vtt');
    fs.writeFileSync(captionFile,vtt(cues));
    const capturedDurationMs=Date.now()-recordingStart;

    await context.close(); context=null;
    const videoPath=await video.path();
    const rawVideo=path.join(outputDir,'training.raw.webm');
    const canonicalVideo=path.join(outputDir,'training.webm');
    if(videoPath!==rawVideo) fs.renameSync(videoPath,rawVideo);
    const visualLeadMs=Math.max(0,Math.round(introStart));
    if(narration){
      const delay=String(visualLeadMs)+'|'+String(visualLeadMs);
      execFileSync('ffmpeg',[
        '-y','-i',rawVideo,'-i',narration.audioPath,
        '-filter_complex','[1:a]adelay='+delay+',loudnorm=I=-16:TP=-1:LRA=11,apad[a]',
        '-map','0:v:0','-map','[a]','-c:v','copy','-c:a','libopus','-b:a','160k',
        '-shortest',canonicalVideo
      ],{stdio:'ignore'});
    }else{
      fs.renameSync(rawVideo,canonicalVideo);
    }
    const renderedDurationMs=mediaDurationMs(canonicalVideo);

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
        durationMs:renderedDurationMs,
        captureDurationMs:capturedDurationMs,
        width,
        height
      },
      narration:narration?{
        status:'PRESENT',
        audioSha256:sha256File(narration.audioPath),
        audioUrl:narration.receipt.audioUrl||null,
        voiceProfileId:narration.receipt.voiceProfileId,
        voiceReceiptState:narration.validation.state,
        durationMs:Number(narration.receipt.durationMs),
        visualLeadMs,
        sync:'TIMING_BOUND'
      }:{
        status:'NOT_CONFIGURED',
        audioSha256:null,
        audioUrl:null,
        voiceProfileId:job.narration?.voiceProfileId||null,
        voiceReceiptState:null,
        durationMs:null,
        visualLeadMs:null,
        sync:null
      },
      publication:{durable:false,videoUrl:null,captionsUrl:null,transcriptUrl:null},
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
