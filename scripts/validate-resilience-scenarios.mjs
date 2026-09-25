import fs from 'node:fs';
import assert from 'node:assert/strict';

const catalogue = JSON.parse(fs.readFileSync('resilience/failure-scenarios.json', 'utf8'));
const baseline = JSON.parse(fs.readFileSync('resilience/security-baseline.json', 'utf8'));

assert.equal(catalogue.schema_version, 1, 'Unsupported failure-scenario schema.');
assert.equal(catalogue.principles.unknown_means_protect_first, true);
assert.equal(catalogue.principles.production_experimentation_for_unknown_faults, false);
assert.equal(catalogue.principles.language_model_direct_execution, false);
assert.equal(catalogue.principles.every_resolved_incident_becomes_prevention, true);
assert.ok(Array.isArray(catalogue.scenarios) && catalogue.scenarios.length >= 25, 'Catalogue must cover a broad minimum failure surface.');

const allowedSeverity = new Set(['medium','high','critical']);
const allowedContainment = new Set(Object.keys(catalogue.containment_classes));
const ids = new Set();
const categories = new Set();
const requiredCategories = new Set(['integration','runtime','data','security','ai-security','supply-chain','release','experience','clocking','time','payroll','identity','governance','observability','infrastructure','support']);
const requiredExtremeScenarioIds = new Set(['multi-integration-outage','provider-schema-or-api-drift','site-offline-mass-reconnect','global-policy-conflict','security-control-plane-compromise','extreme-load-surge','contradictory-source-data','payroll-critical-data-corruption','compound-critical-incident']);

for (const s of catalogue.scenarios) {
  assert.match(s.id, /^[a-z0-9-]+$/, `Invalid scenario id: ${s.id}`);
  assert.ok(!ids.has(s.id), `Duplicate scenario id: ${s.id}`); ids.add(s.id);
  assert.ok(typeof s.category === 'string' && s.category.length > 0, `${s.id}: category missing`); categories.add(s.category);
  assert.ok(allowedSeverity.has(s.severity), `${s.id}: invalid severity`);
  assert.ok(Array.isArray(s.signals) && s.signals.length > 0, `${s.id}: detection signals required`);
  assert.ok(allowedContainment.has(s.containment_class), `${s.id}: invalid containment class`);
  assert.ok(Array.isArray(s.verification) && s.verification.length > 0, `${s.id}: verification required`);
  assert.ok(typeof s.learning === 'string' && s.learning.length > 20, `${s.id}: learning rule required`);
  if (s.autonomous_action == null) {
    assert.ok(Array.isArray(s.safe_state) && s.safe_state.length > 0, `${s.id}: non-runbook scenario needs a safe containment state`);
  } else {
    assert.match(s.autonomous_action, /^[a-z0-9.-]+$/, `${s.id}: invalid action name`);
    assert.ok(Array.isArray(s.preconditions) && s.preconditions.length >= 3, `${s.id}: autonomous action needs explicit preconditions`);
    for (const prohibited of baseline.autonomy.prohibited_action_prefixes) {
      assert.ok(!(s.autonomous_action === prohibited || s.autonomous_action.startsWith(`${prohibited}.`)), `${s.id}: action intersects prohibited authority ${prohibited}`);
    }
  }
}
for (const required of requiredCategories) assert.ok(categories.has(required), `Missing required failure category: ${required}`);
for (const required of requiredExtremeScenarioIds) assert.ok(ids.has(required), `Missing required extreme failure scenario: ${required}`);

const critical = catalogue.scenarios.filter(s => s.severity === 'critical');
assert.ok(critical.length >= 10, 'Critical failure surface is too narrow.');
const unknown = catalogue.scenarios.find(s => s.id === 'unknown-customer-reported-issue');
assert.ok(unknown && unknown.containment_class === 'isolate' && unknown.autonomous_action == null, 'Unknown customer issues must protect/isolate first.');
const payroll = catalogue.scenarios.find(s => s.category === 'payroll');
assert.ok(payroll && payroll.autonomous_action == null, 'Payroll anomaly must not receive autonomous write authority.');
const prompt = catalogue.scenarios.find(s => s.id === 'prompt-injection-or-untrusted-influence');
assert.ok(prompt && prompt.autonomous_action == null, 'Untrusted AI influence must never map directly to a mutation.');

console.log(JSON.stringify({ok:true, scenarios: catalogue.scenarios.length, categories:[...categories].sort(), critical:critical.length}, null, 2));
