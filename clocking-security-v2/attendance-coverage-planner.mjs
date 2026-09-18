const STRONG_IDENTITY=new Set(['exact_person','exact_sid','user_8021x','managed_device_certificate','assigned_badge','verified_personal_credential','managed_mobile_credential']);
const PRESENCE_QUALITY=new Set(['site_bound','work_bound']);

function id(v,name){
  if(!/^[A-Za-z0-9_.:-]{1,160}$/.test(String(v||''))) throw new Error(`Invalid ${name}.`);
  return String(v);
}
function uniqRoutes(routes){
  const seen=new Set();
  return routes.filter(r=>{
    const k=`${r.domain}:${r.sourceId}:${r.role}`;
    if(seen.has(k)) return false; seen.add(k); return true;
  });
}

/**
 * Build a safe automatic attendance plan from connector/onboarding discoveries.
 *
 * The planner never invents coverage. A route only participates when identity
 * is person-bound and the signal is site/work-bound. Cloud SSO identity-only
 * evidence and shared credentials remain outside automatic attendance.
 */
export function planAutomaticAttendanceCoverage({workers=[],discoveries=[]}={}){
  const byEmployee=new Map();
  for(const d of discoveries){
    const employee=id(d?.employee,'employee');
    if(d?.active===false) continue;
    if(!STRONG_IDENTITY.has(String(d?.identityStrength||''))) continue;
    if(!PRESENCE_QUALITY.has(String(d?.presenceQuality||''))) continue;
    const row={
      employee,
      sourceId:id(d?.sourceId,'source'),
      domain:id(d?.domain,'domain'),
      authoritative:d?.authoritative===true,
      supportsIn:d?.supportsIn===true,
      supportsOut:d?.supportsOut===true,
      corroborates:d?.corroborates!==false
    };
    const xs=byEmployee.get(employee)||[]; xs.push(row); byEmployee.set(employee,xs);
  }

  const plans=[],gaps=[];
  for(const w of workers){
    const employee=id(w?.employee||w?.id,'employee');
    const options=byEmployee.get(employee)||[];
    const direct=options.find(x=>x.authoritative&&x.supportsIn&&x.supportsOut);
    if(direct){
      plans.push({employee,automaticReady:true,routes:[{domain:direct.domain,sourceId:direct.sourceId,role:'authoritative',active:true}],basis:'authoritative_existing_source'});
      continue;
    }

    const inAnchors=options.filter(x=>x.supportsIn);
    const outAnchors=options.filter(x=>x.supportsOut);
    let selected=null;
    outer:
    for(const i of inAnchors){
      for(const o of outAnchors){
        const bases=[i,o];
        const baseDomains=new Set(bases.map(x=>x.domain));
        const corroborator=options.find(x=>x.corroborates && !baseDomains.has(x.domain));
        if(corroborator){ selected={i,o,c:corroborator}; break outer; }
        if(baseDomains.size>=2){ selected={i,o,c:null}; break outer; }
      }
    }

    if(selected){
      const routes=[
        {domain:selected.i.domain,sourceId:selected.i.sourceId,role:'anchor_in',active:true},
        {domain:selected.o.domain,sourceId:selected.o.sourceId,role:'departure_anchor',active:true},
        ...(selected.c?[{domain:selected.c.domain,sourceId:selected.c.sourceId,role:'corroborator',active:true}]:[])
      ];
      plans.push({employee,automaticReady:true,routes:uniqRoutes(routes),basis:'independent_existing_sources'});
      continue;
    }

    const missing=[];
    if(!inAnchors.length) missing.push('IN_ANCHOR');
    if(!outAnchors.length) missing.push('OUT_ANCHOR');
    const domains=new Set(options.map(x=>x.domain));
    if(inAnchors.length&&outAnchors.length&&domains.size<2) missing.push('INDEPENDENT_DOMAIN');
    if(inAnchors.length&&outAnchors.length&&domains.size>=2) missing.push('SAFE_CORROBORATION_COMBINATION');
    if(!options.length) missing.push('NO_STRONG_PERSON_BOUND_SIGNAL');
    gaps.push({employee,automaticReady:false,missing:[...new Set(missing)],availableSources:options.map(x=>({sourceId:x.sourceId,domain:x.domain,supportsIn:x.supportsIn,supportsOut:x.supportsOut}))});
  }

  return {
    total:workers.length,
    automaticReady:plans.length,
    automaticCoveragePct:workers.length?(plans.length/workers.length)*100:100,
    releaseTargetMet:plans.length===workers.length,
    plans,gaps
  };
}

export function applyAutomaticCoveragePlan({coverage,tenant,site,plan}={}){
  if(!coverage?.setCoveragePlan) throw new Error('AttendanceCoverageAssurance required.');
  for(const p of plan?.plans||[]){
    coverage.setCoveragePlan({tenant,site,employee:p.employee,routes:p.routes,fallback:null});
  }
  return {applied:(plan?.plans||[]).length,gaps:(plan?.gaps||[]).length};
}
