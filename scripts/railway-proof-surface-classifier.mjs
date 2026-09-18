import fs from 'node:fs';

const REQUIRED_HOSTED_VARS = Object.freeze([
  'PORT','WFM_DB','WFM_HOSTED_STAGING','WFM_PUBLIC_ORIGIN','WFM_RUNTIME_SHA256','WFM_STAGING_PASSWORD'
]);

function foldCollisions(names=[]) {
  const by = new Map();
  for (const raw of names) {
    const name = String(raw);
    const key = name.toLowerCase();
    const list = by.get(key) || [];
    list.push(name);
    by.set(key, list);
  }
  return [...by.values()].filter(x => x.length > 1);
}

function hasCredentialVariable(names=[]) {
  return names.some(n => /(?:password|secret|token|api[_-]?key|credential)/i.test(String(n)));
}

function classifyService(service, policy) {
  const findings=[];
  const vars=service.variable_names || [];
  const deployed=service?.latest_deployment?.status === 'SUCCESS';
  const publicFacing=Array.isArray(service?.public_domains) && service.public_domains.length > 0;
  const credentialBearing=hasCredentialVariable(vars);
  const builder=String(service?.build?.builder || '').toUpperCase();
  const dockerfilePath=service?.build?.dockerfilePath || null;
  const health=service?.deploy?.healthcheckPath || null;
  const retries=Number(service?.deploy?.restartPolicyMaxRetries ?? 0);
  const sourceRepo=service?.source?.repo || null;
  const collisions=foldCollisions(vars);

  if (collisions.length) findings.push({
    code:'CASE_INSENSITIVE_VARIABLE_COLLISION', severity:'high',
    detail:collisions.map(x=>x.join('/')).join(', ')
  });

  if (publicFacing && !service.latest_deployment) findings.push({
    code:'PUBLIC_DOMAIN_WITHOUT_DEPLOYMENT', severity:'warning',
    detail:'Public route exists but no deployment is present; it must not count as hosted proof and requires lifecycle cleanup.'
  });

  if (service?.staged_change && !service.latest_deployment) findings.push({
    code:'STAGED_CHANGE_NOT_DEPLOYED', severity:'info',
    detail:'Staged Railway configuration is not runtime evidence and must not satisfy proof admission.'
  });

  if (deployed && publicFacing && credentialBearing) {
    if (builder !== 'DOCKERFILE' || dockerfilePath !== policy.required_dockerfile_path) findings.push({
      code:'PUBLIC_CREDENTIALLED_PROOF_NOT_DOCKERFILE_HARDENED', severity:'critical',
      detail:`builder=${builder || '<unset>'}, dockerfilePath=${dockerfilePath || '<unset>'}`
    });
    if (health !== policy.required_healthcheck_path) findings.push({
      code:'PUBLIC_CREDENTIALLED_PROOF_MISSING_HEALTHCHECK', severity:'high',
      detail:`healthcheckPath=${health || '<unset>'}`
    });
    if (!Number.isFinite(retries) || retries < policy.minimum_restart_retries) findings.push({
      code:'PUBLIC_CREDENTIALLED_PROOF_MISSING_RESTART_POLICY', severity:'medium',
      detail:`restartPolicyMaxRetries=${String(service?.deploy?.restartPolicyMaxRetries ?? '<unset>')}`
    });
    if (sourceRepo !== policy.allowed_repository) findings.push({
      code:'PUBLIC_CREDENTIALLED_PROOF_SOURCE_REPO_DRIFT', severity:'critical',
      detail:`repo=${sourceRepo || '<unset>'}`
    });
    for (const name of REQUIRED_HOSTED_VARS) {
      if (!vars.includes(name)) findings.push({
        code:'PUBLIC_CREDENTIALLED_PROOF_MISSING_REQUIRED_VARIABLE_NAME', severity:'high', detail:name
      });
    }
  }

  const blocksProof=findings.some(f=>['critical','high'].includes(f.severity));
  return {
    service:service.name,
    service_id:service.service_id || null,
    deployed_successfully:deployed,
    public_facing:publicFacing,
    credential_bearing:credentialBearing,
    can_count_as_hosted_proof: deployed && publicFacing && !blocksProof,
    findings
  };
}

export function classifySnapshot(snapshot) {
  const policy=snapshot.policy || {};
  const services=(snapshot.services || []).map(s=>classifyService(s,policy));
  const blocking=services.flatMap(s=>s.findings.filter(f=>['critical','high'].includes(f.severity)).map(f=>({service:s.service,...f})));
  const warnings=services.flatMap(s=>s.findings.filter(f=>f.severity==='warning').map(f=>({service:s.service,...f})));
  return {
    schema:'wfm.railway-proof-surface-classification.v1',
    release_evidence: blocking.length ? 'FAIL_CLOSED_PROOF_SURFACE_UNVERIFIED' : 'USE_ELIGIBLE_SERVICES_ONLY',
    metrics:{
      services_examined:services.length,
      active_public_credentialled_services:services.filter(s=>s.deployed_successfully&&s.public_facing&&s.credential_bearing).length,
      blocking_findings:blocking.length,
      public_domains_without_deployment:services.filter(s=>s.findings.some(f=>f.code==='PUBLIC_DOMAIN_WITHOUT_DEPLOYMENT')).length,
      eligible_hosted_proof_services:services.filter(s=>s.can_count_as_hosted_proof).length
    },
    blocking,
    warnings,
    services
  };
}

if (process.argv[1] && process.argv[1].endsWith('railway-proof-surface-classifier.mjs') && process.argv[2]) {
  const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  const result=classifySnapshot(input);
  console.log(JSON.stringify(result,null,2));
  if (process.argv.includes('--fail-closed') && result.blocking.length) process.exitCode=2;
}
