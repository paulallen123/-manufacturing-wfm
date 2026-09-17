import fs from 'node:fs';
import assert from 'node:assert/strict';

const cfg = JSON.parse(fs.readFileSync(new URL('./scenarios.json', import.meta.url), 'utf8'));
assert.equal(cfg.production_execution, false);
assert.equal(cfg.real_customer_data, false);
assert.equal(cfg.outbound_attack_traffic, false);
assert.ok(Array.isArray(cfg.scenarios) && cfg.scenarios.length >= 6);

const allowed = new Set(cfg.allowed_reflexes || []);
const forbidden = new Set(cfg.forbidden_automatic_actions || []);
const ids = new Set();

for (const s of cfg.scenarios) {
  assert.ok(!ids.has(s.id));
  ids.add(s.id);
  assert.ok(['sandbox','staging'].includes(s.environment));
  assert.ok(typeof s.objective === 'string' && s.objective.length >= 40);
  assert.ok(typeof s.inject === 'string' && s.inject.startsWith('synthetic_'));
  assert.ok(Array.isArray(s.expected_reflexes) && s.expected_reflexes.length > 0);
  assert.ok(typeof s.scope === 'string' && s.scope.length > 10);
  assert.ok(Number.isInteger(s.ttl_seconds) && s.ttl_seconds > 0 && s.ttl_seconds <= 300);
  assert.ok(typeof s.rollback === 'string' && s.rollback.length > 20);
  for (const action of s.expected_reflexes) {
    assert.ok(allowed.has(action));
    assert.ok(!forbidden.has(action));
  }
}

for (const action of forbidden) assert.ok(!allowed.has(action));
console.log(`PASS: ${cfg.scenarios.length} bounded resilience scenarios validated`);
