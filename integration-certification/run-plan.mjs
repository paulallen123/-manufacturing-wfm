#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const fail = (m) => { throw new Error(m); };
const sha = (v) => crypto.createHash('sha256').update(Buffer.isBuffer(v)?v:String(v)).digest('hex');
const now = () => new Date().toISOString();

const planPath = process.argv[2];
if (!planPath) fail('Usage: node integration-certification/run-plan.mjs <plan.json>');

const plan = JSON.parse(fs.readFileSync(planPath,'utf8'));
if (!plan.providerId || !Array.isArray(plan.steps) || !plan.steps.length) fail('Invalid plan.');

const matrixPath = new URL('./provider-matrix.json', import.meta.url);
const matrix = JSON.parse(fs.readFileSync(matrixPath,'utf8'));
const provider = matrix.providers.find(p=>p.id===plan.providerId);
if (!provider) fail('Unknown providerId.');

const stepValues = new Map();

function expandString(value) {
  return String(value).replace(/\$\{ENV:([A-Z0-9_]+)\}/g,(_,k)=>{
    const v=process.env[k];
    if (v == null || v === '') fail(`Missing environment variable ${k}`);
    return v;
  }).replace(/\$\{STEP:([A-Za-z0-9_-]+)\.([A-Za-z0-9_.-]+)\}/g,(_,step,key)=>{
    const source=stepValues.get(step);
    if (!source) fail(`Missing prior step ${step}`);
    let cur=source;
    for (const part of key.split('.')) cur=cur?.[part];
    if (cur == null) fail(`Missing extracted value ${step}.${key}`);
    return String(cur);
  });
}
function expand(v){
  if (typeof v==='string') return expandString(v);
  if (Array.isArray(v)) return v.map(expand);
  if (v && typeof v==='object') return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,expand(x)]));
  return v;
}
function hostAllowed(hostname){
  return (provider.allowedHosts||[]).includes(hostname);
}
function assertSafeUrl(raw){
  const u=new URL(raw);
  if (u.protocol!=='https:') fail('Only HTTPS provider endpoints are allowed.');
  if (!hostAllowed(u.hostname)) fail(`Host not explicitly allowlisted for ${provider.id}: ${u.hostname}`);
  return u;
}
function jsonPath(obj,p){
  let cur=obj;
  for(const part of p.split('.')){
    if(part==='') continue;
    cur=cur?.[/^\d+$/.test(part)?Number(part):part];
  }
  return cur;
}
function redactHeaders(headers){
  const out={};
  for(const [k,v] of Object.entries(headers||{})){
    const low=k.toLowerCase();
    out[k]=['authorization','apikey','api-key','x-api-key','cookie','set-cookie'].includes(low)?'[REDACTED]':v;
  }
  return out;
}

const runId=`${plan.providerId}-${Date.now()}`;
const evidence={
  schemaVersion:1,
  runId,
  providerId:plan.providerId,
  providerStateAtStart:provider.currentState,
  targetClaim:plan.targetClaim||provider.nextClaim,
  vectorCandidateSha:process.env.VECTOR_CANDIDATE_SHA||'UNBOUND',
  planSha256:sha(fs.readFileSync(planPath)),
  startedAt:now(),
  terminal:'RUNNING',
  steps:[]
};

try{
  if(evidence.vectorCandidateSha==='UNBOUND') fail('VECTOR_CANDIDATE_SHA must bind the exact candidate under test.');
  for(const rawStep of plan.steps){
    const step=expand(rawStep);
    if(!step.name || !step.method || !step.url) fail('Each step requires name, method and url.');
    const url=assertSafeUrl(step.url);
    const headers=step.headers||{};
    const body=step.body===undefined?undefined:JSON.stringify(step.body);
    const start=Date.now();
    let res, buf;
    try{
      res=await fetch(url,{method:step.method,headers,body,redirect:'error',signal:AbortSignal.timeout(step.timeoutMs||15000)});
      buf=Buffer.from(await res.arrayBuffer());
    }catch(err){
      evidence.steps.push({name:step.name,method:step.method,url:url.origin+url.pathname,status:'NETWORK_ERROR',durationMs:Date.now()-start,error:String(err?.name||err),headers:redactHeaders(headers)});
      throw err;
    }
    let parsed=null;
    const contentType=res.headers.get('content-type')||'';
    if(contentType.includes('json')){
      try{ parsed=JSON.parse(buf.toString('utf8')); }catch{}
    }
    const expected=step.expectStatus||[200];
    const row={
      name:step.name,
      method:step.method,
      url:url.origin+url.pathname,
      querySha256:url.search?sha(url.search):null,
      requestHeaders:redactHeaders(headers),
      status:res.status,
      durationMs:Date.now()-start,
      contentType,
      responseSha256:sha(buf),
      responseBytes:buf.length,
      assertions:[]
    };
    if(!expected.includes(res.status)){
      row.assertions.push({type:'status',pass:false,expected,actual:res.status});
      evidence.steps.push(row);
      fail(`Unexpected status for ${step.name}: ${res.status}`);
    }
    row.assertions.push({type:'status',pass:true,expected,actual:res.status});
    if(step.assertJson){
      if(parsed===null) fail(`Step ${step.name} requires JSON assertions but response was not JSON.`);
      for(const rule of step.assertJson){
        const actual=jsonPath(parsed,rule.path);
        const pass=JSON.stringify(actual)===JSON.stringify(rule.equals);
        row.assertions.push({type:'json-equals',path:rule.path,pass,expectedSha256:sha(JSON.stringify(rule.equals)),actualSha256:sha(JSON.stringify(actual))});
        if(!pass) fail(`JSON assertion failed for ${step.name}: ${rule.path}`);
      }
    }
    const extracted={};
    for(const [key,p] of Object.entries(step.extract||{})){
      if(parsed===null) fail(`Step ${step.name} requires JSON extraction but response was not JSON.`);
      const value=jsonPath(parsed,p);
      if(value==null) fail(`Step ${step.name} missing JSON path ${p}`);
      extracted[key]=value;
      row.assertions.push({type:'json-path',path:p,pass:true,valueSha256:sha(JSON.stringify(value))});
    }
    stepValues.set(step.name,extracted);
    evidence.steps.push(row);
  }
  evidence.terminal='PASS';
}catch(err){
  evidence.terminal='FAIL';
  evidence.failure={name:String(err?.name||'Error'),message:String(err?.message||err)};
}
evidence.finishedAt=now();
evidence.evidenceSha256=sha(JSON.stringify(evidence));

const outDir=path.resolve('integration-certification/evidence');
fs.mkdirSync(outDir,{recursive:true});
const out=path.join(outDir,`${runId}.json`);
fs.writeFileSync(out,JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({terminal:evidence.terminal,providerId:evidence.providerId,runId,evidence:out,evidenceSha256:evidence.evidenceSha256},null,2));
if(evidence.terminal!=='PASS') process.exitCode=1;
