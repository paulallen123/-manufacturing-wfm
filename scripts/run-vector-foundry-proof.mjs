#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const { VectorToolFoundry } = require(path.join(root, 'engineering/runtime/vector-tool-foundry.cjs'));
const { registerCoreEngineeringTools } = require(path.join(root, 'engineering/runtime/vector-tool-builtins.cjs'));
const { VectorEngineeringLearningBridge } = require(path.join(root, 'engineering/runtime/vector-engineering-learning-bridge.cjs'));

const frontier = JSON.parse(fs.readFileSync(path.join(root, 'release/vector-frontier-convergence.json'), 'utf8'));
const plane = JSON.parse(fs.readFileSync(path.join(root, 'release/vector-engineering-plane.json'), 'utf8'));

const foundry = new VectorToolFoundry({ principal: 'vector-engineering-plane' });
registerCoreEngineeringTools(foundry);

const learningBridge = new VectorEngineeringLearningBridge({ foundry, now: () => 0 });
const learningCandidate = learningBridge.propose({
  candidateId: 'vector-foundry-preflight-regression',
  signal: 'REGRESSION',
  evidenceClass: 'SYNTHETIC',
  evidenceRefs: ['proof:vector-foundry-preflight'],
  confidence: 1,
  patternCount: 1,
  summary: 'A proof failure becomes a persistent Product Factory eval candidate without execution authority.',
  sourceRef: frontier.sourceBranch || 'vector-frontier-candidate',
});
if (!learningBridge.verify(learningCandidate)) throw new Error('VECTOR_FOUNDRY_LEARNING_DIGEST_FAILED');
if (learningCandidate.route !== 'PERSISTENT_EVAL_CANDIDATE') throw new Error('VECTOR_FOUNDRY_LEARNING_ROUTE_FAILED');
if (learningCandidate.governance.mayExecute || learningCandidate.governance.mayMutateProduction || learningCandidate.governance.maySelfPromote) {
  throw new Error('VECTOR_FOUNDRY_LEARNING_AUTHORITY_FAILED');
}
foundry.registerPipeline({
  id: 'vector.engineering.preflight',
  version: '1.0.0',
  purpose: 'Prove engineering-plane boundaries and current frontier contract remain aligned.',
  steps: [
    { alias: 'plane-contract', toolId: 'vector.contract.check', version: '1.0.0', mode: 'SHADOW' },
    { alias: 'frontier-contract', toolId: 'vector.contract.check', version: '1.0.0', mode: 'SHADOW' },
    { alias: 'isolation-scenarios', toolId: 'vector.scenario.assert', version: '1.0.0', mode: 'SHADOW' }
  ]
});

const result = await foundry.executePipeline({
  pipelineId: 'vector.engineering.preflight',
  version: '1.0.0',
  environment: 'PROOF',
  sourceRef: frontier.sourceBranch || 'vector-frontier-candidate',
  inputs: {
    'plane-contract': {
      document: plane,
      requiredPaths: [
        'contractVersion',
        'sourceControl.sourceOfTruth',
        'boundaries.productionMutationAllowed',
        'boundaries.rawCustomerDataAllowed',
        'governance.immutableToolVersions'
      ],
      equals: {
        'contractVersion': 'VECTOR_ENGINEERING_PLANE_V1',
        'sourceControl.sourceOfTruth': true,
        'boundaries.productionExecutionAllowed': false,
        'boundaries.productionMutationAllowed': false,
        'boundaries.rawCustomerDataAllowed': false,
        'boundaries.directExternalSystemWritesAllowed': false,
        'governance.selfCertificationAllowed': false
      }
    },
    'frontier-contract': {
      document: frontier,
      requiredPaths: ['contractVersion', 'sourceBranch', 'proofRules.exactSourceBinding', 'isolation.northstarModified', 'isolation.productionModified'],
      equals: {
        'proofRules.exactSourceBinding': true,
        'isolation.northstarModified': false,
        'isolation.productionModified': false
      }
    },
    'isolation-scenarios': {
      scenarios: [
        { id: 'github-remains-source-of-truth', expected: true, actual: plane.sourceControl.sourceOfTruth },
        { id: 'engineering-plane-cannot-run-in-production', expected: false, actual: plane.boundaries.productionExecutionAllowed },
        { id: 'engineering-plane-cannot-mutate-production', expected: false, actual: plane.boundaries.productionMutationAllowed },
        { id: 'northstar-not-shared-runtime', expected: false, actual: plane.boundaries.northstarRuntimeShared },
        { id: 'frontier-production-unchanged', expected: false, actual: frontier.isolation.productionModified }
      ]
    }
  }
});

if (result.status !== 'PASS') throw new Error('VECTOR_FOUNDRY_PREFLIGHT_FAILED');
if (!foundry.verifyRunLedger()) throw new Error('VECTOR_FOUNDRY_LEDGER_FAILED');

const inventory = foundry.inventory();
if (inventory.some((tool) => tool.allowedEnvironments.includes('PRODUCTION') || tool.mayTouchCustomerData || tool.mayWriteExternalSystems)) {
  throw new Error('VECTOR_FOUNDRY_BOUNDARY_FAILED');
}

console.log(JSON.stringify({
  contractVersion: 'VECTOR_FOUNDRY_PROOF_V1',
  status: 'PASS',
  toolCount: inventory.length,
  pipelineDigest: result.resultDigest,
  runLedgerVerified: true,
  githubSourceOfTruth: true,
  productionMutation: false,
  customerDataUsed: false,
  northstarSharedRuntime: false,
  learningBridgeProven: true,
  learningCandidateRoute: learningCandidate.route,
  learningCandidateDigest: learningCandidate.candidateDigest
}, null, 2));
console.log('VECTOR_FOUNDRY_PROOF=PASS');
