#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const ledgerPath=path.join(root,'release','research-convergence-ledger.json');
const capabilityPath=path.join(root,'release','capability-superset.json');
const convergencePath=path.join(root,'release','vector-eow-convergence.json');

function fail(message){
  console.error('VECTOR_RESEARCH_CONVERGENCE_GATE=FAIL');
  console.error(message);
  process.exit(1);
}

if(!fs.existsSync(ledgerPath)) fail('Missing research convergence ledger.');
if(!fs.existsSync(capabilityPath)) fail('Missing capability superset manifest.');
if(!fs.existsSync(convergencePath)) fail('Missing FORGE convergence policy.');

const ledger=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));
const capabilities=JSON.parse(fs.readFileSync(capabilityPath,'utf8'));
const convergence=JSON.parse(fs.readFileSync(convergencePath,'utf8'));

if(ledger.schemaVersion!==1||ledger.contract!=='VECTOR_RESEARCH_CONVERGENCE_CONTINUITY_V1') fail('Unsupported research convergence contract.');
for(const [key,value] of Object.entries({
  noResearchOrPrototypeMayBeDropped:ledger.policy?.noResearchOrPrototypeMayBeDropped,
  registrationRequired:ledger.policy?.registrationRequired,
  mustConvergeOrBeSupersededWithSupersetProof:ledger.policy?.mustConvergeOrBeSupersededWithSupersetProof,
  blockedItemsRequireResolutionRoute:ledger.policy?.blockedItemsRequireResolutionRoute,
  unsafeOrUnprovenResearchMayNotBypassReleaseGates:ledger.policy?.unsafeOrUnprovenResearchMayNotBypassReleaseGates,
  goldenJourneyPriorityPreserved:ledger.policy?.goldenJourneyPriorityPreserved,
  noDuplicateLoop:ledger.policy?.noDuplicateLoop
})) if(value!==true) fail('Research continuity policy must remain true: '+key);

if(convergence.policy?.noResearchLoss!==true) fail('FORGE convergence must enforce noResearchLoss.');
if(convergence.policy?.researchConvergenceLedgerRequired!==true) fail('FORGE convergence must require the research ledger.');
if(convergence.policy?.everyResearchCapabilityMustConvergeOrBeSupersededWithSupersetProof!==true) fail('Research must converge or be superseded with proof.');
if(convergence.policy?.researchMayNotDisplaceGoldenJourneyProof!==true) fail('Research must not displace Golden Journey proof.');

const allowed=new Set(ledger.allowedStatuses||[]);
const forbidden=new Set(['DROPPED','ABANDONED','IGNORED','WONT_DO','ARCHIVED_WITHOUT_CONVERGENCE']);
const canonical=new Set((capabilities.capabilities||[]).map(x=>x.id));
const seen=new Set();
const sourceRefs=new Set();

for(const item of ledger.items||[]){
  if(!item.id||seen.has(item.id)) fail('Invalid or duplicate research item: '+item.id);
  seen.add(item.id);
  if(!allowed.has(item.status)||forbidden.has(item.status)) fail(item.id+': invalid/disallowed status '+item.status);
  if(item.mustConvergeOrBeSuperseded!==true) fail(item.id+': convergence obligation missing.');
  if(item.preserveGoldenJourneyPriority!==true) fail(item.id+': Golden Journey priority boundary missing.');
  if(!Array.isArray(item.sourceRefs)||item.sourceRefs.length===0) fail(item.id+': source provenance required.');
  for(const ref of item.sourceRefs) sourceRefs.add(ref);
  if(!String(item.customerValue||'').trim()) fail(item.id+': customer value required.');
  if(!String(item.convergenceRoute||'').trim()) fail(item.id+': explicit convergence route required.');

  if(item.status==='CONVERGED_INTO_FORGE'){
    if(!item.canonicalCapabilityId||!canonical.has(item.canonicalCapabilityId)) fail(item.id+': converged item must map to capability superset.');
  }
  if(item.status==='BLOCKED_WITH_ROUTE'){
    if(!Array.isArray(item.blockers)||item.blockers.length===0) fail(item.id+': blocked item must state blockers.');
  }
  if(item.status==='SUPERSEDED_WITH_SUPERSET_PROOF'){
    if(!item.supersededBy) fail(item.id+': superseding capability required.');
    if(!Array.isArray(item.supersetProof)||item.supersetProof.length===0) fail(item.id+': supersession requires superset proof.');
  }
}

for(const ref of ledger.requiredSourceRefs||[]) if(!sourceRefs.has(ref)) fail('Known research source is unregistered: '+ref);

for(const id of [
  'country-policy-packs',
  'water-resilience-orchestration',
  'skill-chain-resilience',
  'degraded-mode-readiness',
  'loss-prevention-workforce',
  'controlled-environment-flow',
  'privacy-preserving-capability-provenance',
  'factory-capability-graph',
  'manufacturing-event-disruption-cost'
]) if(!seen.has(id)) fail('Critical research capability missing from convergence ledger: '+id);

const pending=(ledger.items||[]).filter(x=>!['CONVERGED_INTO_FORGE','SUPERSEDED_WITH_SUPERSET_PROOF'].includes(x.status));
console.log('VECTOR_RESEARCH_CONVERGENCE_GATE=PASS items='+seen.size+' pending='+pending.length+' registeredSources='+sourceRefs.size);
