'use strict';

// Local development support control plane. It has no business-data mutation,
// shell, model, deployment or credential capability. Reports are untrusted data.
const {randomUUID,createHash}=require('node:crypto');
const AREAS=['application','schedule','availability','attendance','payroll','people','resources','integrations','platform','security'];
const SYMPTOMS=['error','slow','incorrect-result','missing-data','how-to'];
const MINUTE=60000,HOUR=60*MINUTE;
const DEFAULTS=Object.freeze({slo:0.999,slowMs:2000,minShort:20,minLong:100,burn:14.4});
function assert(ok,message,status=400){if(!ok)throw Object.assign(Error(message),{status});}
function admin(a){return Array.isArray(a.permissions)&&a.permissions.includes('company.configure');}
function areaForPath(p){
  if(/^\/api\/(payroll|cost)/.test(p))return 'payroll';
  if(/^\/api\/(schedule|roster)/.test(p))return 'schedule';
  if(/^\/api\/availability/.test(p))return 'availability';
  if(/^\/api\/(personal|time-review|attendance|kiosk)/.test(p))return 'attendance';
  if(/^\/api\/(people|org|onboarding)/.test(p))return 'people';
  if(/^\/api\/(resources|demand)/.test(p))return 'resources';
  if(/^\/api\/integrations/.test(p))return 'integrations';
  return 'application'; // No query, identifier, body or arbitrary path is retained.
}

// A symptom detector, not proof of a bug or a prediction of every future outage.
// Dual windows reduce brief-spike noise. Low-volume bursts have a separate rule.
function evaluate(rows,now,observedSince,config=DEFAULTS){
  const c={...DEFAULTS,...config};
  assert(Number.isFinite(now)&&Number.isFinite(observedSince),'Invalid observation time.');
  assert(c.slo>0&&c.slo<1&&c.minShort>0&&c.minLong>0&&c.burn>0,'Invalid detector configuration.');
  const valid=rows.filter(r=>Number.isFinite(r.minute)&&r.minute>now-HOUR&&r.minute<=now);
  const sum=(rs)=>rs.reduce((a,r)=>({requests:a.requests+r.requests,errors:a.errors+r.errors,slow:a.slow+r.slow}),{requests:0,errors:0,slow:0});
  const long=sum(valid),short=sum(valid.filter(r=>r.minute>now-5*MINUTE));
  const latest=valid.length?Math.max(...valid.map(r=>r.minute)):null;
  const status=!long.requests||latest<now-5*MINUTE?'unknown':now-observedSince<HOUR?'warming-up':short.requests<c.minShort||long.requests<c.minLong?'insufficient-traffic':'observed';
  const findings=[];
  for(const [field,code]of [['errors','error-budget-burn'],['slow','latency-budget-burn']]){
    const shortBurn=short.requests?short[field]/short.requests/(1-c.slo):null;
    const longBurn=long.requests?long[field]/long.requests/(1-c.slo):null;
    if(status==='observed'&&shortBurn>=c.burn&&longBurn>=c.burn)findings.push({code,severity:'high',evidence:{short,long,shortBurn,longBurn,slo:c.slo}});
  }
  if(short.requests>=5&&short.errors>=3&&short.errors/short.requests>=0.5)findings.push({code:'failure-burst',severity:'high',evidence:{short}});
  return {status,short,long,latest,findings};
}

function createStore(db,{clock=Date.now,enabled=true}={}){
  db.exec(`CREATE TABLE IF NOT EXISTS support_cases(
    id TEXT PRIMARY KEY,tenant TEXT NOT NULL REFERENCES tenants(id),reporter TEXT NOT NULL,
    request_key TEXT NOT NULL,payload_hash TEXT NOT NULL,area TEXT NOT NULL,symptom TEXT NOT NULL,
    description TEXT NOT NULL,created_at INTEGER NOT NULL,
    UNIQUE(tenant,reporter,request_key));
    CREATE INDEX IF NOT EXISTS support_cases_scope ON support_cases(tenant,created_at);
    CREATE TABLE IF NOT EXISTS support_case_notes(
      case_id TEXT NOT NULL REFERENCES support_cases(id),request_key TEXT NOT NULL,
      note TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(case_id,request_key));
    CREATE TABLE IF NOT EXISTS support_buckets(
      tenant TEXT NOT NULL REFERENCES tenants(id),area TEXT NOT NULL,minute INTEGER NOT NULL,
      requests INTEGER NOT NULL,errors INTEGER NOT NULL,slow INTEGER NOT NULL,
      PRIMARY KEY(tenant,area,minute));
    CREATE TABLE IF NOT EXISTS support_monitor(
      tenant TEXT PRIMARY KEY REFERENCES tenants(id),observed_since INTEGER NOT NULL,
      last_scan INTEGER,last_observation INTEGER);
    CREATE TABLE IF NOT EXISTS support_incidents(
      id TEXT PRIMARY KEY,tenant TEXT NOT NULL REFERENCES tenants(id),fingerprint TEXT NOT NULL,
      area TEXT NOT NULL,code TEXT NOT NULL,severity TEXT NOT NULL,evidence TEXT NOT NULL,
      first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL,UNIQUE(tenant,fingerprint));
    CREATE TABLE IF NOT EXISTS support_jobs(
      id TEXT PRIMARY KEY,tenant TEXT NOT NULL REFERENCES tenants(id),incident_id TEXT NOT NULL UNIQUE REFERENCES support_incidents(id),
      status TEXT NOT NULL CHECK(status='awaiting-worker'),created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS support_events(
      id INTEGER PRIMARY KEY,tenant TEXT NOT NULL REFERENCES tenants(id),actor TEXT NOT NULL,
      action TEXT NOT NULL,record_id TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TRIGGER IF NOT EXISTS support_events_no_update BEFORE UPDATE ON support_events BEGIN SELECT RAISE(ABORT,'Support events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS support_events_no_delete BEFORE DELETE ON support_events BEGIN SELECT RAISE(ABORT,'Support events are append-only'); END;`);
  if (!db.prepare('PRAGMA table_info(support_events)').all().some(c=>c.name==='evidence_json')) db.exec('ALTER TABLE support_events ADD COLUMN evidence_json TEXT');
  db.exec(`CREATE TRIGGER IF NOT EXISTS support_incident_evidence_history
    AFTER UPDATE OF evidence ON support_incidents WHEN OLD.evidence <> NEW.evidence
    BEGIN INSERT INTO support_events(tenant,actor,action,record_id,created_at,evidence_json)
      VALUES(OLD.tenant,'system:detector','incident-evidence-replaced',OLD.id,NEW.last_seen,
        json_object('previous',json(OLD.evidence),'current',json(NEW.evidence))); END;`);
  // Coverage cannot survive a process outage without an external monitor.
  db.prepare('UPDATE support_monitor SET observed_since=?,last_scan=NULL').run(clock());
  let degraded=false;
  const guard=()=>assert(enabled,'Support collection is disabled.',503);
  const now=()=>clock();
  const cleanFingerprint=v=>String(v??'').trim().replace(/[^A-Za-z0-9_.:-]/g,'').slice(0,120);
  const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}};
  function event(a,action,id,t,evidence=null){db.prepare('INSERT INTO support_events(tenant,actor,action,record_id,created_at,evidence_json) VALUES(?,?,?,?,?,?)').run(a.tenant,a.email,action,id,t,evidence===null?null:JSON.stringify(evidence));}
  function incident(tenant,area,code,severity,evidence,t,fingerprintKey=''){
    const fingerprint=[area,code,cleanFingerprint(fingerprintKey)].filter(Boolean).join(':');
    const old=db.prepare('SELECT id,evidence FROM support_incidents WHERE tenant=? AND fingerprint=?').get(tenant,fingerprint);
    if(old){db.prepare('UPDATE support_incidents SET evidence=?,last_seen=? WHERE id=?').run(JSON.stringify(evidence),t,old.id);return old.id;}
    const id=randomUUID();
    db.prepare('INSERT INTO support_incidents VALUES(?,?,?,?,?,?,?,?,?)').run(id,tenant,fingerprint,area,code,severity,JSON.stringify(evidence),t,t);
    db.prepare('INSERT INTO support_jobs VALUES(?,?,?,?,?)').run(randomUUID(),tenant,id,'awaiting-worker',t);
    event({tenant,email:'system:detector'},'incident-opened',id,t,evidence);
    return id;
  }
  function submit(a,p){
    guard();assert(p&&typeof p==='object'&&!Array.isArray(p),'Expected a report object.');
    assert(Object.keys(p).every(k=>['requestKey','area','symptom','description'].includes(k)),'Unsupported report field.');
    assert(typeof p.requestKey==='string'&&/^[a-zA-Z0-9_-]{16,80}$/.test(p.requestKey),'A stable request key is required.');
    assert(AREAS.includes(p.area)&&SYMPTOMS.includes(p.symptom),'Select an area and symptom.');
    assert(typeof p.description==='string','Describe the problem.');
    const description=p.description.trim();
    assert(description.length>=20&&description.length<=2000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(description),'Use 20–2,000 characters without control characters.');
    const hash=createHash('sha256').update(JSON.stringify([p.area,p.symptom,description])).digest('hex');
    return transaction(()=>{
      const old=db.prepare('SELECT * FROM support_cases WHERE tenant=? AND reporter=? AND request_key=?').get(a.tenant,a.email,p.requestKey);
      if(old){assert(old.payload_hash===hash,'This request key belongs to a different report.',409);return {id:old.id,status:'reported',replayed:true};}
      const t=now(),recent=db.prepare('SELECT COUNT(*) n FROM support_cases WHERE tenant=? AND reporter=? AND created_at>?').get(a.tenant,a.email,t-HOUR).n;
      assert(recent<10,'Ten reports were received in the last hour. Retry later using the same request key.',429);
      const id=randomUUID();
      db.prepare('INSERT INTO support_cases VALUES(?,?,?,?,?,?,?,?,?)').run(id,a.tenant,a.email,p.requestKey,hash,p.area,p.symptom,description,t);
      event(a,'customer-report-received',id,t);
      incident(a.tenant,p.area,p.symptom==='how-to'?'help-request':'customer-'+p.symptom,'review',{source:'customer',verification:'unverified',descriptionIncluded:false},t);
      return {id,status:'reported',replayed:false};
    });
  }
  function addDetail(a,id,note,key){
    guard();assert(typeof note==='string'&&note.length>=2&&note.length<=2000,'Use 2–2,000 characters.');
    assert(typeof key==='string'&&/^[a-zA-Z0-9_-]{16,80}$/.test(key),'A stable request key is required.');
    return transaction(()=>{
      assert(db.prepare('SELECT id FROM support_cases WHERE id=? AND tenant=? AND reporter=?').get(id,a.tenant,a.email),'Report not found.',404);
      const old=db.prepare('SELECT note FROM support_case_notes WHERE case_id=? AND request_key=?').get(id,key);
      if(old){assert(old.note===note,'This request key belongs to different information.',409);return;}
      assert(db.prepare('SELECT COUNT(*) n FROM support_case_notes WHERE case_id=?').get(id).n<100,'Report detail limit reached.',429);
      db.prepare('INSERT INTO support_case_notes VALUES(?,?,?,?)').run(id,key,note,now());event(a,'customer-report-detail',id,now());
    });
  }
  function observe(a,pathname,status,duration){
    if(!enabled)return;
    // Only call with a server-authenticated actor and response timing. No client telemetry endpoint.
    assert(Number.isInteger(status)&&status>=100&&status<=599&&Number.isFinite(duration)&&duration>=0,'Invalid server observation.');
    const t=now(),minute=Math.floor(t/MINUTE)*MINUTE,area=areaForPath(pathname);
    transaction(()=>{
      db.prepare('INSERT INTO support_monitor VALUES(?,?,NULL,?) ON CONFLICT(tenant) DO UPDATE SET last_observation=excluded.last_observation').run(a.tenant,t,t);
      db.prepare(`INSERT INTO support_buckets VALUES(?,?,?,1,?,?) ON CONFLICT(tenant,area,minute)
        DO UPDATE SET requests=requests+1,errors=errors+excluded.errors,slow=slow+excluded.slow`).run(a.tenant,area,minute,status>=500?1:0,duration>=DEFAULTS.slowMs?1:0);
    });
  }
  function scan(){
    if(!enabled)return;
    const t=now();
    transaction(()=>{
      for(const {id:tenant}of db.prepare('SELECT id FROM tenants').all()){
        let monitor=db.prepare('SELECT * FROM support_monitor WHERE tenant=?').get(tenant);
        if(!monitor){db.prepare('INSERT INTO support_monitor VALUES(?,?,NULL,NULL)').run(tenant,t);monitor={observed_since:t};}
        // A delayed timer cannot establish continuous observation coverage.
        if(monitor.last_scan!==null&&monitor.last_scan!==undefined&&t-monitor.last_scan>2*MINUTE){monitor.observed_since=t;db.prepare('UPDATE support_monitor SET observed_since=? WHERE tenant=?').run(t,tenant);}
        const rows=db.prepare('SELECT * FROM support_buckets WHERE tenant=? AND minute>?').all(tenant,t-HOUR);
        for(const area of AREAS){const result=evaluate(rows.filter(r=>r.area===area),t,monitor.observed_since);for(const f of result.findings)incident(tenant,area,f.code,f.severity,f.evidence,t);}
        const groups=db.prepare(`SELECT area,symptom,COUNT(*) reports,COUNT(DISTINCT reporter) reporters FROM support_cases
          WHERE tenant=? AND created_at>? AND symptom!='how-to' GROUP BY area,symptom HAVING COUNT(DISTINCT reporter)>=2`).all(tenant,t-24*HOUR);
        for(const g of groups)incident(tenant,g.area,'repeated-'+g.symptom,'review',{reports:g.reports,distinctReporters:g.reporters,verification:'unverified',windowHours:24},t);
        const delayed=db.prepare('SELECT COUNT(*) n,MIN(created_at) oldest FROM support_jobs WHERE tenant=? AND created_at<=?').get(tenant,t-15*MINUTE);
        if(delayed.n)incident(tenant,'application','investigation-overdue','high',{pending:delayed.n,oldest:delayed.oldest,reason:'No repair worker is connected.'},t);
        db.prepare('UPDATE support_monitor SET last_scan=? WHERE tenant=?').run(t,tenant);
      }
      db.prepare('DELETE FROM support_buckets WHERE minute<?').run(t-48*HOUR);
    });
    // Clear the collection outage only after the entire scan commits.
    degraded=false;
  }
  function report(a){
    const t=now(),canReview=admin(a),m=db.prepare('SELECT * FROM support_monitor WHERE tenant=?').get(a.tenant);
    const cases=db.prepare('SELECT id,area,symptom,description,created_at FROM support_cases WHERE tenant=? AND reporter=? ORDER BY created_at DESC,id LIMIT 100').all(a.tenant,a.email).map(x=>({...x,status:'reported'}));
    const withNotes=rows=>rows.map(r=>({...r,notes:db.prepare('SELECT note,created_at FROM support_case_notes WHERE case_id=? ORDER BY created_at LIMIT 100').all(r.id)}));
    const result={enabled,canReview,cases:withNotes(cases),caseCount:db.prepare('SELECT COUNT(*) n FROM support_cases WHERE tenant=? AND reporter=?').get(a.tenant,a.email).n,
      service:{collection:!enabled?'disabled':degraded?'degraded':!m?.last_scan||t-m.last_scan>2*MINUTE?'unknown':'running',lastScan:m?.last_scan||null,repairWorker:'not-connected',automaticRepairs:false},
      notice:'Reports are acknowledged and queued for investigation. A reported problem is not yet a confirmed bug or a verified fix.'};
    if(canReview){
      const rows=db.prepare('SELECT * FROM support_buckets WHERE tenant=? AND minute>?').all(a.tenant,t-HOUR);
      result.detectors=AREAS.map(area=>({area,...evaluate(rows.filter(r=>r.area===area),t,m?.observed_since??t)}));
      result.incidents=db.prepare(`SELECT i.*,j.status job_status FROM support_incidents i JOIN support_jobs j ON j.incident_id=i.id WHERE i.tenant=? ORDER BY i.last_seen DESC LIMIT 100`).all(a.tenant).map(({tenant,fingerprint,evidence,...r})=>({...r,evidence:JSON.parse(evidence),status:'needs-investigation'}));
      result.incidentCount=db.prepare('SELECT COUNT(*) n FROM support_incidents WHERE tenant=?').get(a.tenant).n;
      result.reports=withNotes(db.prepare('SELECT id,area,symptom,description,created_at FROM support_cases WHERE tenant=? ORDER BY created_at DESC,id LIMIT 100').all(a.tenant));
      result.reportCount=db.prepare('SELECT COUNT(*) n FROM support_cases WHERE tenant=?').get(a.tenant).n;
      result.thresholds=DEFAULTS;
    }
    return result;
  }
  function recordSystemFinding(input){
    guard();assert(input&&typeof input==='object'&&!Array.isArray(input),'System finding is invalid.');
    const tenant=String(input.tenant||''),area=String(input.area||''),code=String(input.code||''),severity=String(input.severity||'review'),fingerprintKey=cleanFingerprint(input.fingerprintKey);
    assert(tenant&&db.prepare('SELECT id FROM tenants WHERE id=?').get(tenant),'System finding tenant is not configured.',404);
    const validIntegration=area==='integrations'&&/^provider-[a-z0-9-]{3,80}$/.test(code);
    const validShield=(area==='security'||area==='platform')&&/^shield-[a-z0-9-]{3,100}$/.test(code);
    assert(validIntegration||validShield,'Only bounded provider or protection-shield findings are accepted.');
    assert(['review','high'].includes(severity),'Unsupported system finding severity.');
    const evidence=input.evidence&&typeof input.evidence==='object'&&!Array.isArray(input.evidence)?input.evidence:{};
    const text=JSON.stringify(evidence);assert(text.length<=4000&&!/(access[_-]?token|authorization|password|secret|nextRequest)/i.test(text),'System finding evidence contains prohibited material.');
    return transaction(()=>incident(tenant,area,code,severity,evidence,now(),fingerprintKey));
  }
  function advisories(a){
    assert(admin(a),'Company configuration permission required.',403);
    const rows=db.prepare('SELECT id,area,code,severity,first_seen,last_seen FROM support_incidents WHERE tenant=? ORDER BY last_seen DESC LIMIT 100').all(a.tenant);
    return {schemaVersion:1,sourceEnvironment:'local-development',applicationVersion:require('../package.json').version,
      advisories:rows.map(r=>({id:r.id,component:r.area,signal:r.code,severity:r.severity,firstSeen:r.first_seen,lastSeen:r.last_seen,verification:'unverified',recommendedAction:'Check the affected component in an isolated environment.'})),
      delivery:'not-connected',notice:'Customer descriptions and identities are excluded. This is a read-only export; no other environment has been notified.'};
  }
  return {submit,addDetail,observe,scan,report,advisories,recordSystemFinding,markDegraded(){degraded=true;}};
}
module.exports={AREAS,SYMPTOMS,DEFAULTS,areaForPath,evaluate,createStore};
