'use strict';

function getPath(value, path) {
  return String(path || '').split('.').filter(Boolean).reduce((current, key) => {
    if (current == null || typeof current !== 'object') return undefined;
    return current[key];
  }, value);
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function registerCoreEngineeringTools(foundry) {
  foundry.registerTool({
    id: 'vector.contract.check',
    version: '1.0.0',
    purpose: 'Validate deterministic repository and release contracts without mutating any runtime.',
    owner: 'vector-engineering',
    lifecycle: 'SHADOW',
    mutationClass: 'NONE',
    allowedEnvironments: ['LOCAL', 'CI', 'PROOF', 'STAGING'],
    handler: async (input) => {
      const document = input.document && typeof input.document === 'object' ? input.document : {};
      const requiredPaths = Array.isArray(input.requiredPaths) ? input.requiredPaths : [];
      const equals = input.equals && typeof input.equals === 'object' ? input.equals : {};
      const missing = requiredPaths.filter((path) => getPath(document, path) === undefined);
      const mismatches = Object.entries(equals)
        .filter(([path, expected]) => !same(getPath(document, path), expected))
        .map(([path, expected]) => ({ path, expected, actual: getPath(document, path) }));
      return { pass: missing.length === 0 && mismatches.length === 0, missing, mismatches };
    },
  });

  foundry.registerTool({
    id: 'vector.regression.compare',
    version: '1.0.0',
    purpose: 'Compare candidate engineering metrics with a baseline and explicit tolerances.',
    owner: 'vector-engineering',
    lifecycle: 'SHADOW',
    mutationClass: 'NONE',
    allowedEnvironments: ['LOCAL', 'CI', 'PROOF', 'STAGING'],
    handler: async (input) => {
      const baseline = input.baseline && typeof input.baseline === 'object' ? input.baseline : {};
      const candidate = input.candidate && typeof input.candidate === 'object' ? input.candidate : {};
      const tolerances = input.tolerances && typeof input.tolerances === 'object' ? input.tolerances : {};
      const regressions = [];
      for (const [metric, baselineValue] of Object.entries(baseline)) {
        const candidateValue = candidate[metric];
        const tolerance = Number(tolerances[metric] ?? 0);
        if (!Number.isFinite(Number(baselineValue)) || !Number.isFinite(Number(candidateValue)) || !Number.isFinite(tolerance)) {
          regressions.push({ metric, reason: 'NON_NUMERIC_OR_MISSING', baseline: baselineValue, candidate: candidateValue });
          continue;
        }
        if (Number(candidateValue) < Number(baselineValue) - tolerance) {
          regressions.push({ metric, reason: 'BELOW_ALLOWED_FLOOR', baseline: Number(baselineValue), candidate: Number(candidateValue), tolerance });
        }
      }
      return { pass: regressions.length === 0, regressions };
    },
  });

  foundry.registerTool({
    id: 'vector.scenario.assert',
    version: '1.0.0',
    purpose: 'Run deterministic scenario assertions for isolation, safety and release invariants.',
    owner: 'vector-engineering',
    lifecycle: 'SHADOW',
    mutationClass: 'NONE',
    allowedEnvironments: ['LOCAL', 'CI', 'PROOF', 'STAGING'],
    handler: async (input) => {
      const scenarios = Array.isArray(input.scenarios) ? input.scenarios : [];
      const results = scenarios.map((scenario, index) => {
        const id = String(scenario?.id || `scenario-\${index + 1}`);
        const pass = same(scenario?.actual, scenario?.expected);
        return { id, pass, expected: scenario?.expected, actual: scenario?.actual };
      });
      return { pass: results.length > 0 && results.every((result) => result.pass), results };
    },
  });

  return foundry.inventory();
}

module.exports = Object.freeze({ registerCoreEngineeringTools, getPath });
