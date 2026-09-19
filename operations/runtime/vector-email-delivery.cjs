'use strict';

const RESEND_ENDPOINT='https://api.resend.com/emails';
const DEFAULT_TIMEOUT_MS=12_000;

function compact(v,max=500){return String(v??'').trim().slice(0,max);}
function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||'').trim());}
function providerReady(env=process.env){
  return String(env.WFM_VECTOR_EMAIL_PROVIDER||'').toLowerCase()==='resend' &&
    String(env.WFM_VECTOR_RESEND_TOKEN||'').length>=8 &&
    Boolean(compact(env.WFM_VECTOR_EMAIL_FROM,300));
}
function normalizeRecipients(to){
  const rows=(Array.isArray(to)?to:[to]).map(v=>compact(v,320).toLowerCase()).filter(Boolean);
  if(!rows.length||rows.length>20||rows.some(v=>!validEmail(v)))throw new Error('Vector email requires valid recipients.');
  return [...new Set(rows)];
}
async function sendResendReport({
  token,from,to,subject,html,text,idempotencyKey,
  fetchImpl=globalThis.fetch,timeoutMs=DEFAULT_TIMEOUT_MS
}={}){
  const secret=String(token||'');
  if(secret.length<8)throw new Error('Vector email provider token is not configured.');
  const sender=compact(from,320);
  if(!sender)throw new Error('Vector email sender is not configured.');
  const recipients=normalizeRecipients(to);
  const subj=compact(subject,300);
  if(!subj)throw new Error('Vector email subject is required.');
  const safeHtml=String(html||'').slice(0,2_000_000);
  const safeText=String(text||'').slice(0,500_000);
  if(!safeHtml&&!safeText)throw new Error('Vector email body is empty.');
  const key=compact(idempotencyKey,256);
  if(!key)throw new Error('Vector email requires an idempotency key.');
  if(typeof fetchImpl!=='function')throw new Error('Vector email fetch runtime is unavailable.');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Math.max(1000,Math.min(Number(timeoutMs)||DEFAULT_TIMEOUT_MS,30_000)));
  try{
    const response=await fetchImpl(RESEND_ENDPOINT,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        Authorization:'Bearer '+secret,
        'Idempotency-Key':key
      },
      body:JSON.stringify({from:sender,to:recipients,subject:subj,html:safeHtml||undefined,text:safeText||undefined}),
      signal:controller.signal,
      redirect:'error'
    });
    const raw=await response.text();
    let body={};try{body=raw?JSON.parse(raw):{};}catch{}
    if(!response.ok){
      const message=compact(body?.message||body?.name||'provider rejected request',240);
      throw new Error('Vector email provider failed with HTTP '+response.status+(message?': '+message:''));
    }
    const id=compact(body?.id,160);
    if(!id)throw new Error('Vector email provider returned no delivery id.');
    return {provider:'RESEND',id};
  }catch(error){
    if(error?.name==='AbortError')throw new Error('Vector email provider timed out.');
    const message=String(error?.message||error||'Vector email failed.').replaceAll(secret,'[REDACTED]');
    throw new Error(message);
  }finally{clearTimeout(timer);}
}
module.exports={RESEND_ENDPOINT,providerReady,normalizeRecipients,sendResendReport};
