'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { VectorToolFoundry } = require('./vector-tool-foundry.cjs');
const { registerCoreEngineeringTools } = require('./vector-tool-builtins.cjs');

test('tool versions are immutable and production is excluded at registration', () => {
  const foundry = new VectorToolFoundry();
  foundry.registerTool({ id: 'vector.test.echo', version: '1.0.0', lifecycle: 'SHADOW', handler: async (input) => input });
  assert.throws(() => foundry.registerTool({ id: 'vector.test.echo', version: '1.0.0', lifecycle: 'SHADOW', handler: async () => ({}) }), (error) => error.code === 'VECTOR_FOUNDRY_TOOL_IMMUTABLE');
  assert.throws(() => foundry.registerTool({ id: 'vector.bad.prod', version: '1.0.0', lifecycle: 'SHADOW', allowedEnvironments: ['PRODUCTION'], handler: async () => ({}) }), (error) => error.code === 'VECTOR_FOUNDRY_PRODUCTION_BOUNDARY');
});

test('shadow tools run only in shadow and engineering plane hard-denies production', async () => {
  const foundry = new VectorToolFoundry();
  registerCoreEngineeringTools(foundry);
  const ok = await foundry.executeTool({
    toolId: 'vector.scenario.assert', version: '1.0.0', environment: 'PROOF', mode: 'SHADOW', sourceRef: 'branch:test',
    input: { scenarios: [{ id: 'isolation', expected: true, actual: true }] },
  });
  assert.equal(ok.output.pass, true);
  await assert.rejects(() => foundry.executeTool({
    toolId: 'vector.scenario.assert', version: '1.0.0', environment: 'PROOF', mode: 'EXECUTE', sourceRef: 'branch:test', input: { scenarios: [] },
  }), (error) => error.code === 'VECTOR_FOUNDRY_SHADOW_ONLY');
  await assert.rejects(() => foundry.executeTool({
    toolId: 'vector.scenario.assert', version: '1.0.0', environment: 'PRODUCTION', mode: 'SHADOW', sourceRef: 'branch:test', input: { scenarios: [] },
  }), (error) => error.code === 'VECTOR_FOUNDRY_PRODUCTION_BOUNDARY');
});

test('lifecycle promotion is independent, evidence-bound and cannot skip shadow', () => {
  const foundry = new VectorToolFoundry({ principal: 'vector-platform' });
  foundry.registerTool({ id: 'vector.new.tool', version: '1.0.0', owner: 'builder-a', lifecycle: 'PROPOSED', handler: async () => ({ pass: true }) });
  assert.throws(() => foundry.transitionLifecycle({ toolId: 'vector.new.tool', version: '1.0.0', to: 'CERTIFIED', actor: 'governance-b', verified: true, evidenceRefs: ['proof-1'], sourceCommit: 'a'.repeat(40) }), (error) => error.code === 'VECTOR_FOUNDRY_LIFECYCLE_TRANSITION');
  assert.throws(() => foundry.transitionLifecycle({ toolId: 'vector.new.tool', version: '1.0.0', to: 'SHADOW', actor: 'builder-a', verified: true, evidenceRefs: ['proof-1'] }), (error) => error.code === 'VECTOR_FOUNDRY_INDEPENDENT_GOVERNANCE');
  foundry.transitionLifecycle({ toolId: 'vector.new.tool', version: '1.0.0', to: 'SHADOW', actor: 'governance-b', verified: true, evidenceRefs: ['proof-1'] });
  foundry.transitionLifecycle({ toolId: 'vector.new.tool', version: '1.0.0', to: 'CERTIFIED', actor: 'governance-b', verified: true, evidenceRefs: ['proof-2'], sourceCommit: 'a'.repeat(40) });
  assert.equal(foundry.describeTool('vector.new.tool', '1.0.0').lifecycle, 'CERTIFIED');
  assert.equal(foundry.verifyLifecycleLedger(), true);
});

test('pipeline composes versioned tools and run receipts form a tamper-evident ledger', async () => {
  const foundry = new VectorToolFoundry();
  registerCoreEngineeringTools(foundry);
  foundry.registerPipeline({
    id: 'vector.release.preflight', version: '1.0.0',
    steps: [
      { alias: 'contract', toolId: 'vector.contract.check', version: '1.0.0', mode: 'SHADOW' },
      { alias: 'scenarios', toolId: 'vector.scenario.assert', version: '1.0.0', mode: 'SHADOW' },
    ],
  });
  const result = await foundry.executePipeline({
    pipelineId: 'vector.release.preflight', version: '1.0.0', environment: 'PROOF', sourceRef: 'candidate:abc',
    inputs: {
      contract: { document: { safe: true }, requiredPaths: ['safe'], equals: { safe: true } },
      scenarios: { scenarios: [{ id: 'customer-safe', expected: false, actual: false }] },
    },
  });
  assert.equal(result.status, 'PASS');
  assert.equal(foundry.runLog.length, 2);
  assert.equal(foundry.verifyRunLedger(), true);
});

test('tool evolution creates proposal-only revisions that cannot self-register or self-certify', () => {
  const foundry = new VectorToolFoundry();
  foundry.registerTool({ id: 'vector.tool.evolve', version: '1.0.0', lifecycle: 'SHADOW', handler: async () => ({ pass: true }) });
  const proposal = foundry.proposeToolRevision({
    toolId: 'vector.tool.evolve', fromVersion: '1.0.0', proposedVersion: '1.1.0',
    reason: 'Turn a repeated failure pattern into a reusable tool.', evidenceRefs: ['incident-proof-7'], changes: ['add bounded retry classifier'],
  });
  assert.equal(proposal.governance.mode, 'PROPOSAL_ONLY');
  assert.equal(proposal.governance.maySelfRegister, false);
  assert.equal(proposal.governance.maySelfCertify, false);
});

test('core engineering tools catch contract drift and metric regression', async () => {
  const foundry = new VectorToolFoundry();
  registerCoreEngineeringTools(foundry);
  const contract = await foundry.executeTool({
    toolId: 'vector.contract.check', version: '1.0.0', environment: 'CI', mode: 'SHADOW', sourceRef: 'ci:1',
    input: { document: { isolation: { productionModified: false } }, requiredPaths: ['isolation.productionModified'], equals: { 'isolation.productionModified': false } },
  });
  assert.equal(contract.output.pass, true);
  const regression = await foundry.executeTool({
    toolId: 'vector.regression.compare', version: '1.0.0', environment: 'CI', mode: 'SHADOW', sourceRef: 'ci:1',
    input: { baseline: { passRate: 100 }, candidate: { passRate: 98 }, tolerances: { passRate: 0 } },
  });
  assert.equal(regression.output.pass, false);
  assert.equal(regression.output.regressions[0].metric, 'passRate');
});


test('default generated ids are concrete and deterministic', async () => {
  const foundry = new VectorToolFoundry();
  registerCoreEngineeringTools(foundry);
  foundry.registerPipeline({
    id: 'vector.default-id-proof',
    version: '1.0.0',
    steps: [{ toolId: 'vector.scenario.assert', version: '1.0.0', mode: 'SHADOW' }],
  });
  const result = await foundry.executePipeline({
    pipelineId: 'vector.default-id-proof',
    version: '1.0.0',
    environment: 'CI',
    sourceRef: 'ci:default-id',
    inputs: {
      'step-1': { scenarios: [{ expected: true, actual: true }] },
    },
  });
  assert.equal(result.status, 'PASS');
  assert.equal(result.results[0].alias, 'step-1');
  assert.equal(result.results[0].output.results[0].id, 'scenario-1');
  assert.doesNotMatch(result.results[0].alias, /\$\{/);
  assert.doesNotMatch(result.results[0].output.results[0].id, /\$\{/);
});
