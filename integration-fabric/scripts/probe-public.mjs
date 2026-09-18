import fs from 'node:fs';
import {loadCatalog} from './load-catalog.mjs';

const catalog = loadCatalog();
const timeoutMs = Number(process.env.PROBE_TIMEOUT_MS || 12000);
const concurrency = Math.max(1, Math.min(8, Number(process.env.PROBE_CONCURRENCY || 4)));

const targets = catalog.systems
  .filter(x => x.docsUrl && (x.priority === 'P0' || x.researchStatus === 'docs-verified'))
  .map(x => ({id:x.id, name:x.name, url:x.docsUrl}));

function classify(status) {
  if (status >= 200 && status < 400) return 'public-surface-reachable';
  if (status >= 400 && status < 500) return 'public-auth-or-client-boundary-reachable';
  if (status >= 500) return 'remote-server-error';
  return 'unknown';
}

async function one(t) {
  const started=Date.now();
  try {
    const u=new URL(t.url);
    if (u.protocol !== 'https:') throw new Error('non-https target blocked');
    const res=await fetch(u, {
      method:'GET',
      redirect:'follow',
      headers:{'user-agent':'Manufacturing-WFM-Integration-Lab/0.1 (+read-only-public-probe)'},
      signal:AbortSignal.timeout(timeoutMs)
    });
    const reader=res.body?.getReader();
    if (reader) {
      try { await reader.read(); } finally { try { await reader.cancel(); } catch {} }
    }
    return {id:t.id,name:t.name,url:t.url,status:res.status,state:classify(res.status),latencyMs:Date.now()-started};
  } catch (e) {
    return {id:t.id,name:t.name,url:t.url,status:null,state:'network-or-dns-unreachable',latencyMs:Date.now()-started,error:String(e?.message||e).slice(0,240)};
  }
}

const queue=[...targets];
const results=[];
async function worker(){
  while(queue.length) {
    const t=queue.shift();
    if (!t) return;
    results.push(await one(t));
  }
}
await Promise.all(Array.from({length:Math.min(concurrency,queue.length||1)},()=>worker()));
results.sort((a,b)=>a.id.localeCompare(b.id));

const report={
  schemaVersion:1,
  generatedAt:new Date().toISOString(),
  claimBoundary:'Public documentation/auth-boundary reachability only. No customer credentials, tenant data, provider certification or write operations are exercised. Public reachability never promotes a system to sandbox-authenticated, tenant-authenticated or round-trip evidence.',
  catalogOverlay:catalog.researchOverlay || null,
  total:results.length,
  reachable:results.filter(x=>x.state!=='network-or-dns-unreachable').length,
  results
};
fs.mkdirSync('integration-fabric/reports',{recursive:true});
fs.writeFileSync('integration-fabric/reports/public-probe.json', JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({total:report.total,reachable:report.reachable,unreachable:report.total-report.reachable},null,2));
