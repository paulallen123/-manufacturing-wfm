#!/usr/bin/env node
import fs from 'node:fs';import assert from 'node:assert/strict';
const c=JSON.parse(fs.readFileSync(new URL('../release/t9-customer-guardian-contract.json',import.meta.url),'utf8'));
for(const k of ['simulationInvisible','simulationOffCriticalResponsePath','noRequestBodiesStored','noSecretsOrCookiesStored','noProductionMutationFromSimulation','noSimulationResultMayCountAsProof'])assert.equal(c.customerPromise[k],true,k);
assert.equal(c.remediation.autoFixRequiresCertifiedSafeRemediator,true);assert.equal(c.remediation.repairActorAndVerifierMustBeDistinct,true);assert.equal(c.remediation.unknownsCannotAutoFix,true);assert.equal(c.remediation.unresolvedFindingNeverStopsUnrelatedDevelopment,true);assert.equal(c.evolution.scenarioCandidatesAreProposalOnly,true);assert.equal(c.evolution.authorityMayNeverSelfExpand,true);console.log('VECTOR_T9_CUSTOMER_GUARDIAN_CONTRACT=PASS');
