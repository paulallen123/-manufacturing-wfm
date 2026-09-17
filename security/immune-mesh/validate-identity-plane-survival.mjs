import assert from 'node:assert/strict';
import fs from 'node:fs';

const p = JSON.parse(fs.readFileSync(new URL('./identity-plane-survival-policy.json', import.meta.url), 'utf8'));

assert.equal(p.status, 'staged');
assert.equal(p.threat_model.assume_identity_controller_authentication_bypass, true);
assert.equal(p.threat_model.assume_identity_admin_session_theft, true);
assert.equal(p.threat_model.assume_identity_controller_remote_code_execution, true);
assert.equal(p.threat_model.central_identity_decision_is_not_sufficient_authority, true);

const s = p.service_boundary_authorization;
assert.equal(s.every_privileged_request_must_be_authorized_at_resource_service, true);
assert.equal(s.authentication_success_must_not_imply_authorization, true);
assert.equal(s.tenant_scope_required, true);
assert.equal(s.wildcard_tenant_scope_forbidden, true);
assert.equal(s.audience_binding_required, true);
assert.equal(s.issuer_binding_required, true);
assert.equal(s.policy_version_binding_required, true);
assert.equal(s.session_epoch_or_revocation_version_required, true);
assert.equal(s.privileged_capability_single_use_nonce_required, true);
assert.ok(s.maximum_privileged_capability_ttl_seconds > 0 && s.maximum_privileged_capability_ttl_seconds <= 300);
assert.equal(s.resource_service_must_deny_unknown_or_stale_policy, true);

const t = p.trust_split;
assert.equal(t.identity_issuer_cannot_modify_resource_authorization_policy, true);
assert.equal(t.identity_issuer_cannot_modify_security_policy_root, true);
assert.equal(t.resource_authorization_policy_has_independent_trust_anchor, true);
assert.equal(t.recovery_identity_is_independent_from_normal_identity_plane, true);
assert.equal(t.security_evidence_witness_is_independent_from_identity_plane, true);

const r = p.identity_plane_compromise_response;
for (const key of [
  'affected_issuer_or_customer_cell_scope_required',
  'freeze_new_privileged_session_issuance',
  'revoke_evidenced_suspicious_sessions',
  'disable_exposed_identity_credentials',
  'preserve_identity_and_resource_access_evidence',
  'deny_new_cross_cell_privilege',
  'require_independent_verification_before_identity_plane_rejoin'
]) assert.equal(r[key], true, `${key} must remain fail-closed`);
for (const key of ['automatic_global_shutdown','automatic_mass_disable_identities','automatic_production_wide_credential_rotation']) {
  assert.equal(r[key], false, `${key} must not become autonomous`);
}

const forbidden = new Set(p.forbidden_automatic_actions || []);
for (const action of [
  'hack_back',
  'external_retaliation',
  'global_shutdown',
  'mass_disable_identities',
  'delete_customer_data',
  'production_wide_credential_rotation',
  'alter_payroll_or_workforce_records',
  'cross_tenant_wildcard_containment'
]) assert.ok(forbidden.has(action), `missing forbidden action ${action}`);

console.log('Identity-plane survival invariants validated.');
