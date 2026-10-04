'use strict';

const { DatabaseSync } = require('node:sqlite');

function isoDate(value) {
  const s=String(value||'').slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:null;
}
function monday(date) {
  const d=new Date(date+'T12:00:00Z');
  const day=d.getUTCDay()||7;
  d.setUTCDate(d.getUTCDate()-day+1);
  return d.toISOString().slice(0,10);
}
function sunday(start) {
  const d=new Date(start+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+6); return d.toISOString().slice(0,10);
}
function json(res,status,body){res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.end(JSON.stringify(body));}
function tenantFrom(req){return String(req.headers['x-wfm-tenant']||'').trim();}

function createOperationalPeriodRollover({dbPath}={}) {
  if(!dbPath) throw new Error('dbPath required');
  const db=new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE IF NOT EXISTS vector_operational_periods(
    tenant TEXT NOT NULL, period TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
    source TEXT NOT NULL, source_digest TEXT, created_at TEXT NOT NULL,
    PRIMARY KEY(tenant,period)
  )`);

  function ensure({tenant,date,source='published-schedule',sourceDigest=null}) {
    if(!tenant) throw new Error('tenant required');
    const d=isoDate(date); if(!d) throw new Error('valid date required');
    const period=monday(d), end=sunday(period);
    const now=new Date().toISOString();
    db.prepare(`INSERT OR IGNORE INTO vector_operational_periods
      (tenant,period,start_date,end_date,source,source_digest,created_at) VALUES(?,?,?,?,?,?,?)`)
      .run(tenant,period,period,end,source,sourceDigest,now);
    return db.prepare('SELECT * FROM vector_operational_periods WHERE tenant=? AND period=?').get(tenant,period);
  }
  function list(tenant){return db.prepare('SELECT * FROM vector_operational_periods WHERE tenant=? ORDER BY period').all(tenant);}

  async function handleRequest(req,res){
    const u=new URL(req.url,'http://vector.local');
    if(u.pathname!=='/api/operations/period-rollover') return false;
    const tenant=tenantFrom(req);
    if(!tenant) return json(res,401,{error:'Tenant identity required.'}),true;
    if(req.method==='GET') return json(res,200,{periods:list(tenant)}),true;
    if(req.method!=='POST') return json(res,405,{error:'Method not allowed.'}),true;
    let raw=''; for await(const c of req){raw+=c;if(raw.length>16384)return json(res,413,{error:'Payload too large.'}),true;}
    let body={}; try{body=raw?JSON.parse(raw):{};}catch{return json(res,400,{error:'Invalid JSON.'}),true;}
    try{
      const period=ensure({tenant,date:body.date,source:body.source||'published-schedule',sourceDigest:body.sourceDigest||null});
      return json(res,200,{status:'PASS',period,createdOrExisting:true}),true;
    }catch(e){return json(res,400,{error:String(e.message||e)}),true;}
  }
  return {ensure,list,handleRequest,close(){db.close();}};
}
module.exports={createOperationalPeriodRollover};
