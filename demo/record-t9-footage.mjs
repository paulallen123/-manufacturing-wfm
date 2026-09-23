import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';

const TARGET='https://vector-t9-live-demo-v2-production.up.railway.app/';
const OUT='/app/public';
const VIDEO_DIR='/app/videos';
fs.mkdirSync(OUT,{recursive:true});
fs.mkdirSync(VIDEO_DIR,{recursive:true});

let status={state:'STARTING',target:TARGET,startedAt:new Date().toISOString()};

function sendJson(res,code,payload){
  res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(JSON.stringify(payload,null,2));
}

const server=http.createServer((req,res)=>{
  if(req.url==='/healthz'){
    if(status.state==='READY') return sendJson(res,200,status);
    return sendJson(res,503,status);
  }
  if(req.url==='/status'||req.url==='/status.json') return sendJson(res,200,status);
  if(req.url==='/' ){
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
    return res.end('<!doctype html><meta name="viewport" content="width=device-width"><title>Vector T9 Footage</title><style>body{font-family:system-ui;background:#06111f;color:#fff;padding:30px}a{color:#65b5ff}</style><h1>Vector T9 actual footage</h1><p>Recorder state: <b>'+status.state+'</b></p><p><a href="/vector-t9-wow-footage.mp4">Open MP4</a></p><p>This video is a real Chromium recording of the live hosted Vector T9 demo.</p>');
  }
  const file=req.url==='/vector-t9-wow-footage.webm'
    ? path.join(OUT,'vector-t9-wow-footage.webm')
    : req.url==='/vector-t9-wow-footage.mp4'
      ? path.join(OUT,'vector-t9-wow-footage.mp4')
      : null;
  if(!file) return sendJson(res,404,{error:'NOT_FOUND'});
  if(!fs.existsSync(file)) return sendJson(res,503,status);
  const stat=fs.statSync(file);
  const type=file.endsWith('.mp4')?'video/mp4':'video/webm';
  res.writeHead(200,{'content-type':type,'content-length':stat.size,'cache-control':'public,max-age=300'});
  fs.createReadStream(file).pipe(res);
});

server.listen(3000,'0.0.0.0',()=>{
  console.log('VECTOR_T9_FOOTAGE_SERVER LISTENING 3000');
  void record();
});

async function record(){
  status={state:'RECORDING',target:TARGET,startedAt:new Date().toISOString()};
  let browser,context,page;
  try{
    browser=await chromium.launch({headless:true});
    context=await browser.newContext({
      viewport:{width:1280,height:720},
      recordVideo:{dir:VIDEO_DIR,size:{width:1280,height:720}}
    });
    page=await context.newPage();
    await page.goto(TARGET,{waitUntil:'networkidle',timeout:60000});
    await page.waitForSelector('#runFresh',{timeout:30000});
    await page.waitForTimeout(1800);

    await page.click('#runFresh');
    await page.waitForFunction(()=>document.querySelector('#autonomy')?.textContent?.includes('BOUNDED_AUTO'),null,{timeout:15000});
    await page.waitForTimeout(3200);

    await page.click('#learn');
    await page.waitForFunction(()=>document.querySelector('#learning')?.textContent?.includes('Self-promote'),null,{timeout:15000});
    await page.waitForTimeout(3800);

    await page.reload({waitUntil:'networkidle',timeout:60000});
    await page.waitForSelector('#runStale',{timeout:30000});
    await page.waitForTimeout(1700);
    await page.click('#runStale');
    await page.waitForFunction(()=>document.querySelector('#autonomy')?.textContent?.includes('SHADOW'),null,{timeout:15000});
    await page.waitForTimeout(4200);

    const video=page.video();
    await context.close();
    context=null;
    const source=await video.path();
    await browser.close();
    browser=null;

    const webm=path.join(OUT,'vector-t9-wow-footage.webm');
    fs.copyFileSync(source,webm);
    const mp4=path.join(OUT,'vector-t9-wow-footage.mp4');
    const ff=spawnSync('ffmpeg',[
      '-y','-i',webm,'-c:v','libx264','-preset','medium','-crf','20',
      '-pix_fmt','yuv420p','-movflags','+faststart',mp4
    ],{encoding:'utf8'});
    if(ff.status!==0) throw new Error('ffmpeg failed: '+String(ff.stderr||'').slice(-1500));

    status={
      state:'READY',
      target:TARGET,
      completedAt:new Date().toISOString(),
      mp4:'/vector-t9-wow-footage.mp4',
      webm:'/vector-t9-wow-footage.webm',
      bytes:fs.statSync(mp4).size,
      proof:'REAL_CHROMIUM_RECORDING_OF_LIVE_HOSTED_VECTOR_T9',
      journey:[
        'public page loaded',
        'fresh decision clicked',
        'BOUNDED_AUTO observed',
        'causal learning clicked',
        'self-authority boundary observed',
        'page reloaded',
        'stale decision clicked',
        'SHADOW observed'
      ]
    };
    fs.writeFileSync(path.join(OUT,'status.json'),JSON.stringify(status,null,2));
    console.log('VECTOR_T9_FOOTAGE_READY '+status.bytes);
  }catch(error){
    try{if(context)await context.close();}catch{}
    try{if(browser)await browser.close();}catch{}
    status={state:'FAILED',target:TARGET,error:String(error?.stack||error),failedAt:new Date().toISOString()};
    fs.writeFileSync(path.join(OUT,'status.json'),JSON.stringify(status,null,2));
    console.error('VECTOR_T9_FOOTAGE_FAILED '+status.error);
  }
}
