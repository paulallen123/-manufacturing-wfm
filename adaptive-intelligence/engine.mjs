import crypto from 'node:crypto';

const clone=v=>structuredClone(v);
const nowIso=()=>new Date().toISOString();
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

export class AdaptiveIntelligenceEngine {
  #outcomes=[];
  #evals=[];
  #skills=[];
  #marketGaps=[];
  #candidates=[];
  #decisions=[];

  constructor({minRepeatedWins=3}={}){
    this.minRepeatedWins=Math.max(2,Number(minRepeatedWins)||3);
  }

  ingestOutcome(input){
    const required=['tenantScope','source','category','fingerprint','baseline','result','verified'];
    for(const key of required) if(input?.[key]===undefined||input?.[key]===null||input?.[key]==='') throw new Error('OUTCOME_MISSING_'+key);
    if(input.crossTenantRawMemory===true) throw new Error('CROSS_TENANT_RAW_MEMORY_FORBIDDEN');
    if(input.containsSecret===true) throw new Error('SECRET_IN_LEARNING_MEMORY_FORBIDDEN');
    if(input.memoryGrantsAuthority===true) throw new Error('LEARNING_MEMORY_AUTHORITY_FORBIDDEN');
    if(typeof input.baseline!=='number'||typeof input.result!=='number') throw new Error('OUTCOME_NUMERIC_BASELINE_RESULT_REQUIRED');

    const receipt={
      id:'out_'+hash([input.tenantScope,input.fingerprint,input.source,input.baseline,input.result,this.#outcomes.length]).slice(0,16),
      tenantScope:String(input.tenantScope),
      source:String(input.source),
      category:String(input.category),
      fingerprint:String(input.fingerprint),
      baseline:input.baseline,
      result:input.result,
      delta:input.result-input.baseline,
      verified:input.verified===true,
      evidenceRef:input.evidenceRef||null,
      createdAt:input.createdAt||nowIso()
    };
    this.#outcomes.push(receipt);

    if(receipt.verified && receipt.delta<0){
      this.#createEvalFromRegression(receipt);
    }
    if(receipt.verified && receipt.delta>0){
      this.#considerSkillCandidate(receipt);
    }
    return clone(receipt);
  }

  #createEvalFromRegression(receipt){
    const existing=this.#evals.find(x=>x.origin==='regression'&&x.tenantScope===receipt.tenantScope&&x.fingerprint===receipt.fingerprint);
    if(existing) return existing;
    const evaluation={
      id:'eval_'+hash(['regression',receipt.tenantScope,receipt.fingerprint]).slice(0,16),
      origin:'regression',
      tenantScope:receipt.tenantScope,
      fingerprint:receipt.fingerprint,
      baseline:receipt.baseline,
      observed:receipt.result,
      evidenceRef:receipt.evidenceRef,
      releaseBlocking:true,
      createdAt:nowIso()
    };
    this.#evals.push(evaluation);
    return evaluation;
  }

  #considerSkillCandidate(receipt){
    const wins=this.#outcomes.filter(x=>x.verified&&x.tenantScope===receipt.tenantScope&&x.fingerprint===receipt.fingerprint&&x.delta>0);
    if(wins.length<this.minRepeatedWins) return null;
    const existing=this.#skills.find(x=>x.tenantScope===receipt.tenantScope&&x.fingerprint===receipt.fingerprint&&x.status==='candidate');
    if(existing) return existing;
    const avgDelta=wins.reduce((n,x)=>n+x.delta,0)/wins.length;
    const candidate={
      id:'skill_'+hash([receipt.tenantScope,receipt.fingerprint,wins.map(x=>x.id)]).slice(0,16),
      tenantScope:receipt.tenantScope,
      fingerprint:receipt.fingerprint,
      version:1,
      status:'candidate',
      authority:'none',
      verifiedWinCount:wins.length,
      averageImprovement:avgDelta,
      evidenceRefs:wins.map(x=>x.evidenceRef).filter(Boolean),
      createdAt:nowIso()
    };
    this.#skills.push(candidate);
    return candidate;
  }

  ingestMarketCapability(input){
    const required=['competitor','capability','sourceAuthority','vectorEvidenceStatus'];
    for(const key of required) if(!input?.[key]) throw new Error('MARKET_SIGNAL_MISSING_'+key);
    if(!['official','primary','independent-verified'].includes(input.sourceAuthority)) throw new Error('MARKET_SOURCE_NOT_AUTHORITATIVE');
    const gap=input.vectorEvidenceStatus!=='PASS';
    const record={
      id:'gap_'+hash([input.competitor,input.capability,input.sourceRef]).slice(0,16),
      competitor:String(input.competitor),
      capability:String(input.capability),
      sourceAuthority:input.sourceAuthority,
      sourceRef:input.sourceRef||null,
      vectorEvidenceStatus:input.vectorEvidenceStatus,
      gap,
      createdAt:nowIso()
    };
    this.#marketGaps.push(record);
    if(gap){
      const evaluation={
        id:'eval_'+hash(['market',record.competitor,record.capability]).slice(0,16),
        origin:'market-gap',
        tenantScope:null,
        fingerprint:'market:'+record.competitor+':'+record.capability,
        capability:record.capability,
        competitor:record.competitor,
        sourceRef:record.sourceRef,
        releaseBlocking:false,
        target:'Design a leapfrog outcome, not a copy, then prove it against Vector evidence.',
        createdAt:nowIso()
      };
      if(!this.#evals.some(x=>x.id===evaluation.id)) this.#evals.push(evaluation);
    }
    return clone(record);
  }

  evaluateCandidate(input){
    const required=['id','level','baselineScore','candidateScore','holdoutScore','safetyPass','tenantIsolationPass','rollbackReady'];
    for(const key of required) if(input?.[key]===undefined||input?.[key]===null) throw new Error('CANDIDATE_MISSING_'+key);
    const c={...clone(input),evaluatedAt:nowIso()};
    this.#candidates.push(c);
    let decision='reject';
    let reason='quality-gate';

    if(c.memoryGrantsAuthority===true){
      reason='memory-authority-forbidden';
    }else if(!c.safetyPass||!c.tenantIsolationPass||!c.rollbackReady){
      reason='safety-isolation-or-rollback-failed';
    }else if(!(c.candidateScore>c.baselineScore&&c.holdoutScore>c.baselineScore)){
      reason='no-holdout-improvement';
    }else if(c.level===0||c.level===1){
      decision='promote';
      reason='safe-non-mutating-improvement';
    }else if(c.level===2){
      if(c.shadowPass===true&&c.canaryPass===true&&c.independentPolicyAuthority===true){
        decision='promote';
        reason='bounded-reversible-policy-approved';
      }else{
        reason='shadow-canary-or-authority-missing';
      }
    }else if(c.level>=3){
      decision='route-to-release-gates';
      reason='high-impact-change-requires-independent-release-authority';
    }

    const result={
      id:'decision_'+hash([c.id,c.level,c.candidateScore,c.holdoutScore,decision]).slice(0,16),
      candidateId:c.id,
      level:c.level,
      decision,
      reason,
      directProductionAuthorityGranted:false,
      evaluatedAt:c.evaluatedAt
    };
    this.#decisions.push(result);
    return clone(result);
  }

  snapshot(){
    return clone({
      outcomes:this.#outcomes,
      evals:this.#evals,
      skills:this.#skills,
      marketGaps:this.#marketGaps,
      candidates:this.#candidates,
      decisions:this.#decisions
    });
  }
}
