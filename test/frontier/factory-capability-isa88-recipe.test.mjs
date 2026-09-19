import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCapabilityGraph } from '../../src/frontier/factory-capability-graph.mjs';
import { buildProcessCapabilityReadinessMask } from '../../src/frontier/factory-capability-process-readiness.mjs';
import { extractIsa88CapabilitySteps } from '../../src/frontier/factory-capability-isa88-recipe.mjs';

const MIXING = 'http://www.iat.rwth-aachen.de/capability-ontology#MixingOfLiquids';
const ROTATIONAL_VELOCITY = 'http://qudt.org/vocab/quantitykind/RotationalVelocity';
const DURATION = 'http://www.w3.org/2006/time#Duration';
const RPM_UNIT = 'http://qudt.org/vocab/unit/REV-PER-MIN';
const SECOND_UNIT = 'http://si-digital-framework.org/SI/units/second';

const mapping = {
  [MIXING]: {
    capabilityId: 'stirring',
    minimumQualifiedPeople: 1,
    parameters: {
      [ROTATIONAL_VELOCITY]: {
        kind: 'constraint',
        semanticId: 'urn:prop:rpm',
        operator: 'contains',
        allowedUnitIds: [RPM_UNIT],
        unitAliases: { [RPM_UNIT]: 'rpm' },
      },
      [DURATION]: {
        kind: 'non_capability',
        reason: 'recipe execution duration is not a machine capability envelope in this experiment',
      },
    },
  },
};

function publicRecipe(rpm, duration, id) {
  const inputId = 'Educt_A001/04.15/12:54:01.0/';
  const mixId = 'Mixing_of_Liquids001/04.15/12:54:01.0/';
  const outputId = 'Product001/04.15/12:54:01.0/';
  return {
    ID: id,
    Inputs: [{ ID: inputId, Description: 'Ingredient A' }],
    Outputs: [{ ID: outputId, Description: 'Mixed product' }],
    Intermediates: [],
    ProcessElements: [{
      ID: mixId,
      Description: 'Mixing_of_Liquids',
      Parameters: [
        {
          ID: 'Revolutions_per_minute001/04.15/12:54:01.0/',
          Description: 'Revolutions per minute',
          ValueString: String(rpm),
          DataType: 'int',
          UnitOfMeasure: RPM_UNIT,
          Key: ROTATIONAL_VELOCITY,
        },
        {
          ID: 'Mixing_Duration001/04.15/12:54:01.0/',
          Description: 'Duration of the process step mixing',
          ValueString: String(duration),
          DataType: 'int',
          UnitOfMeasure: SECOND_UNIT,
          Key: DURATION,
        },
      ],
      SemanticDescription: MIXING,
    }],
    DirectedLinks: [
      { ID: 'in-to-mix', FromID: inputId, ToID: mixId },
      { ID: 'mix-to-out', FromID: mixId, ToID: outputId },
    ],
  };
}

function graphFromPublicPlant(stirringByAsset) {
  const scope = { tenantId: 'tenant-a', siteId: 'site-1' };
  const source = { provider: 'public-research-artifact', observedAt: '2026-09-19T04:00:00Z', revision: 'mp-opt', staleAfterMinutes: 180 };
  const assets = Object.entries(stirringByAsset).map(([assetId, values]) => ({
    ...scope,
    assetId,
    source,
    capabilities: values.length
      ? [{ capabilityId: 'stirring', properties: [{ semanticId: 'urn:prop:rpm', kind: 'set', value: values, unit: 'rpm' }] }]
      : [],
  }));
  return buildCapabilityGraph({
    ...scope,
    assets,
    capabilityRequirements: [{ ...scope, capabilityId: 'stirring', label: 'Stirring', requiredSkills: ['stir-operator'], minimumQualifiedPeople: 1 }],
    people: [{ ...scope, personId: 'operator-1', availableNow: true, qualifications: [{ skillId: 'stir-operator', status: 'valid', authoritative: true }] }],
    now: '2026-09-19T04:10:00Z',
  });
}

const referencePlant = {
  HC10: [100, 200],
  HC20: [150, 300],
  HC30: [100, 150],
  HC40: [],
};

const infeasibleSeed100066Plant = {
  HC10: [150, 100],
  HC20: [250],
  HC30: [250, 150],
  HC40: [300, 150],
};

test('extracts the public reference ISA-88 mixing setting into a deterministic capability requirement', () => {
  const result = extractIsa88CapabilitySteps(
    publicRecipe(150, 30, 'GeneralRecipe_DA_DB_DC_M150_U_S_SepC_SepB_SepA'),
    { capabilityMappings: mapping },
  );
  assert.equal(result.status, 'accepted');
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].requirement.capabilityId, 'stirring');
  assert.deepEqual(result.steps[0].requirement.constraints, [{
    semanticId: 'urn:prop:rpm',
    operator: 'contains',
    value: 150,
    unit: 'rpm',
    unitId: RPM_UNIT,
  }]);
  assert.match(result.authorityBoundary, /cannot publish a production plan/i);
});

test('public reference case remains technically feasible after recipe parsing', () => {
  const extracted = extractIsa88CapabilitySteps(
    publicRecipe(150, 30, 'GeneralRecipe_DA_DB_DC_M150_U_S_SepC_SepB_SepA'),
    { capabilityMappings: mapping },
  );
  const readiness = buildProcessCapabilityReadinessMask({ graph: graphFromPublicPlant(referencePlant), steps: extracted.steps });
  assert.equal(readiness.planStatus, 'ready');
  assert.deepEqual(readiness.steps[0].eligibleAssetIds, ['HC20', 'HC30']);
  assert.equal(readiness.metrics.technicallyFeasibleAssignments, 2);
});

test('public seed 100066 reproduces the published 200 rpm capability mismatch before optimisation', () => {
  const extracted = extractIsa88CapabilitySteps(
    publicRecipe(200, 700, 'GeneralRecipe_DC_DB_DA_M200_U_S_SepA_SepB_SepC'),
    { capabilityMappings: mapping },
  );
  const readiness = buildProcessCapabilityReadinessMask({ graph: graphFromPublicPlant(infeasibleSeed100066Plant), steps: extracted.steps });
  assert.equal(readiness.planStatus, 'not_feasible');
  assert.deepEqual(readiness.steps[0].eligibleAssetIds, []);
  assert.equal(readiness.metrics.technicallyFeasibleAssignments, 0);
  assert.equal(readiness.metrics.technicalPruningPct, 1);
});

test('unknown recipe capability semantics require review rather than guessed matching', () => {
  const recipe = publicRecipe(150, 30, 'unknown-capability');
  recipe.ProcessElements[0].SemanticDescription = 'urn:vendor:unknown-mixing';
  const result = extractIsa88CapabilitySteps(recipe, { capabilityMappings: mapping });
  assert.equal(result.status, 'review_required');
  assert.equal(result.steps.length, 0);
  assert.equal(result.reviewRequired[0].reason, 'capability_mapping_required');
});

test('unclassified process parameters block a partial capability requirement', () => {
  const recipe = publicRecipe(150, 30, 'unknown-parameter');
  recipe.ProcessElements[0].Parameters.push({
    ID: 'Mystery001', ValueString: '7', DataType: 'int', UnitOfMeasure: 'urn:unit:x', Key: 'urn:parameter:mystery',
  });
  const result = extractIsa88CapabilitySteps(recipe, { capabilityMappings: mapping });
  assert.equal(result.status, 'review_required');
  assert.equal(result.steps.length, 0);
  assert.equal(result.reviewRequired[0].reason, 'parameter_review_required');
});

test('invalid recipe flow fails closed on unknown endpoints and cycles', () => {
  const unknown = publicRecipe(150, 30, 'unknown-endpoint');
  unknown.DirectedLinks[1].ToID = 'missing-node';
  assert.equal(extractIsa88CapabilitySteps(unknown, { capabilityMappings: mapping }).reason, 'directed_link_unknown_endpoint');

  const cyclic = publicRecipe(150, 30, 'cycle');
  cyclic.DirectedLinks.push({ ID: 'cycle-back', FromID: cyclic.Outputs[0].ID, ToID: cyclic.Inputs[0].ID });
  assert.equal(extractIsa88CapabilitySteps(cyclic, { capabilityMappings: mapping }).reason, 'recipe_flow_cycle_detected');
});
