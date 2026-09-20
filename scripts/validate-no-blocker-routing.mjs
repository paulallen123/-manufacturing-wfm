#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const registry = JSON.parse(readFileSync(new URL('../resilience/no-blocker-routing.json', import.meta.url), 'utf8'));

assert.equal(registry.schemaVersion, 1);
assert.equal(registry.policy, 'blocker-triggers-safe-alternate-route');
assert.equal(registry.invariants?.deliveryWorkContinues, true);
assert.equal(registry.invariants?.safetyControlsMayNotBeDisabledToMakeProgress, true);
assert.equal(registry.invariants?.nonEquivalentFallbackMayNotSatisfyOriginalEvidenceGate, true);
assert.equal(registry.invariants?.unknownFailuresFailClosedForMutationButContinueDiagnosis, true);

assert.ok(Array.isArray(registry.routes) && registry.routes.length >= 6, 'critical continuity routes are missing');
const ids = new Set();
for (const route of registry.routes) {
  assert.ok(route.id && typeof route.id === 'string', 'route.id is required');
  assert.ok(!ids.has(route.id), `duplicate continuity route: ${route.id}`);
  ids.add(route.id);
  assert.ok(route.primary && route.fallback, `${route.id} requires primary and fallback paths`);
  assert.notEqual(route.primary, route.fallback, `${route.id} fallback must be independent from the primary label`);
  assert.equal(route.preserveSafety, true, `${route.id} may not bypass safety controls`);
  assert.ok(route.continuation && route.continuation.length > 20, `${route.id} requires an explicit continuation mode`);
  if (!route.equivalentForGate) {
    assert.match(route.continuation, /(without claiming|gate remains|containment closed|while .* gate remains)/i,
      `${route.id} non-equivalent fallback must keep the original evidence gate explicit`);
  }
}

for (const required of [
  'hosted-ci',
  'runtime-health',
  'private-browser-proof',
  'security-canary',
  'deployment-provider',
  'external-provider-integration'
]) {
  assert.ok(ids.has(required), `missing critical continuity route: ${required}`);
}

console.log(JSON.stringify({
  proof: 'no-blocker-safe-continuity-routing',
  status: 'PASS',
  routes: registry.routes.length,
  invariant: 'A blocker may stop an unsafe action or evidence claim, but it may not stop safe development, diagnosis, testing or alternate-path proof.',
  safetyBoundary: 'Fallbacks never convert unavailable real-world evidence into a PASS.'
}));
