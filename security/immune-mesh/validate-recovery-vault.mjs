import fs from 'node:fs';
import assert from 'node:assert/strict';

const path = new URL('./recovery-vault-policy.json', import.meta.url);
const policy = JSON.parse(fs.readFileSync(path, 'utf8'));

assert.equal(policy.version, 1);
assert.equal(policy.status, 'staged_contract');
assert.equal(policy.threat_intelligence?.reference, 'CVE-2026-87886');
assert.equal(policy.threat_intelligence?.observed_in_the_wild, true);

const t = policy.trust_boundaries;
for (const key of [
  'recovery_plane_independent_from_application_plane',
  'recovery_plane_independent_from_security_control_plane',
  'separate_recovery_identity_required'
]) assert.equal(t[key], true, `${key} must be true`);
for (const key of [
  'application_runtime_credentials_may_delete_recovery_points',
  'production_admin_can_destroy_final_recovery_path',
  'security_agent_can_destroy_final_recovery_path',
  'ai_agent_can_destroy_or_rewrite_recovery_points'
]) assert.equal(t[key], false, `${key} must be false`);

const i = policy.immutability;
assert.equal(i.immutable_or_object_lock_required, true);
assert.equal(i.version_history_required, true);
assert.ok(i.minimum_protected_generations >= 3, 'At least three protected generations are required');
assert.equal(i.delete_requires_delayed_tombstone, true);
assert.ok(i.minimum_delete_delay_hours >= 24, 'Recovery deletion delay must be at least 24 hours');
assert.equal(i.final_generation_delete_requires_two_independent_authorities, true);

const integrity = policy.integrity;
for (const key of [
  'manifest_hash_required',
  'independent_witness_hash_required',
  'witness_must_be_outside_production_trust_boundary',
  'restore_rejects_hash_mismatch',
  'audit_chain_must_record_backup_create_delete_restore'
]) assert.equal(integrity[key], true, `${key} must be true`);

const r = policy.restore;
assert.equal(r.routine_restore_test_required, true);
assert.ok(r.maximum_days_between_isolated_restore_tests <= 30, 'Isolated restore proof must run at least monthly');
assert.equal(r.restore_test_target_must_be_isolated, true);
assert.equal(r.restore_test_must_not_use_live_customer_data_without_authorisation, true);
assert.equal(r.automatic_bulk_restore_allowed, false);
assert.equal(r.production_restore_requires_explicit_scope, true);
assert.equal(r.production_restore_requires_independent_verification, true);
assert.equal(r.customer_wide_restore_requires_two_independent_authorities, true);

const response = policy.compromise_response;
assert.equal(response.loss_of_recovery_telemetry_is_security_incident, true);
assert.equal(response.unexpected_backup_permission_change_is_security_incident, true);
assert.equal(response.unexpected_delete_or_retention_change_is_security_incident, true);
assert.equal(response.maximum_automatic_scope, 'single_customer_cell');
assert.equal(response.destructive_automatic_actions_forbidden, true);

const approved = new Set([
  'freeze_recovery_policy_changes',
  'revoke_suspicious_recovery_session',
  'disable_exposed_recovery_credential',
  'preserve_recovery_audit_evidence',
  'pause_suspect_restore_job'
]);
assert.ok(Array.isArray(response.safe_automatic_actions) && response.safe_automatic_actions.length > 0);
for (const action of response.safe_automatic_actions) {
  assert.ok(approved.has(action), `Unapproved recovery reflex: ${action}`);
}

const forbiddenFragments = [
  'delete_customer_data',
  'delete_backup',
  'mass_disable',
  'production_wide_credential_rotation',
  'customer_wide_shutdown',
  'bulk_restore'
];
for (const action of response.safe_automatic_actions) {
  for (const fragment of forbiddenFragments) {
    assert.equal(action.includes(fragment), false, `Destructive/high-blast action entered automatic allowlist: ${action}`);
  }
}

assert.ok(Array.isArray(policy.survival_invariants) && policy.survival_invariants.length >= 6);
console.log('Recovery Vault Survival Contract: PASS');
