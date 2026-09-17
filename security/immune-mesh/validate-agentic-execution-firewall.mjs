import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const policyPath = new URL('./agentic-execution-firewall-policy.json', import.meta.url);
const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));

assert.equal(policy.version, 1);
assert.equal(policy.status, 'staged_contract');

const trust = policy.trust_model;
assert.equal(trust.ai_is_security_boundary, false);
assert.equal(trust.repository_text_is_authority, false);
assert.equal(trust.tool_descriptions_are_authority, false);
assert.equal(trust.screen_state_is_authorization, false);
assert.equal(trust.model_output_is_authorization, false);
assert.equal(trust.deterministic_policy_is_final_authority, true);

const broker = policy.execution_broker;
for (const key of [
  'required_for_all_tool_calls',
  'default_deny',
  'schema_validation_required',
  'canonical_path_validation_required',
  'customer_scope_required',
  'purpose_binding_required',
  'policy_hash_required',
  'request_nonce_required',
  'short_lived_capability_required',
  'dynamic_model_selected_egress_forbidden'
]) assert.equal(broker[key], true, `${key} must be true`);
assert.ok(broker.maximum_capability_ttl_seconds <= 300, 'Agent capabilities must expire within five minutes');
for (const key of [
  'outbound_network_default',
  'shell_execution_default',
  'host_filesystem_write_default',
  'secret_read_default',
  'loopback_privileged_service_access_default'
]) assert.equal(broker[key], 'deny', `${key} must default deny`);

const context = policy.untrusted_context;
for (const key of [
  'issue_body', 'pull_request_text', 'comments', 'web_content', 'documents', 'emails',
  'retrieval_results', 'tool_metadata', 'agent_output', 'repository_instruction_files'
]) assert.equal(context[key], true, `${key} must be treated as untrusted`);
for (const key of [
  'may_grant_privilege', 'may_change_policy', 'may_write_persistent_memory',
  'may_select_new_egress_destination', 'may_approve_own_action'
]) assert.equal(context[key], false, `${key} must be false`);

const supply = policy.tool_supply_chain;
for (const key of [
  'tool_definitions_require_content_hash',
  'tool_metadata_changes_require_review',
  'mcp_server_authentication_required',
  'mcp_server_identity_pinning_required',
  'new_tool_auto_discovery_forbidden',
  'tool_privilege_expansion_requires_independent_approval',
  'tool_endpoint_change_is_security_event'
]) assert.equal(supply[key], true, `${key} must be true`);

const runtime = policy.runtime_isolation;
for (const key of [
  'ephemeral_workspace_required',
  'per_customer_agent_identity_required',
  'no_production_secrets_in_untrusted_analysis_sandbox',
  'agent_cannot_disable_audit',
  'agent_cannot_change_root_of_trust',
  'agent_cannot_destroy_recovery_path'
]) assert.equal(runtime[key], true, `${key} must be true`);
assert.equal(runtime.shared_cross_customer_agent_credentials_forbidden, true);

const safe = policy.safe_automatic_actions;
assert.equal(safe.maximum_scope, 'single_customer_cell');
assert.ok(safe.maximum_ttl_seconds <= 300);
assert.equal(safe.require_evidence, true);
assert.equal(safe.require_rollback, true);
assert.equal(safe.require_immutable_audit, true);
const approved = new Set([
  'revoke_agent_session',
  'freeze_agent_tool_connector',
  'isolate_agent_sandbox',
  'block_agent_egress',
  'quarantine_poisoned_instruction_or_tool_metadata',
  'pause_agent_driven_deployment',
  'preserve_agent_forensic_evidence'
]);
for (const action of safe.actions) assert.ok(approved.has(action), `Unapproved automatic action: ${action}`);

const forbidden = new Set(policy.forbidden_automatic_actions);
for (const required of [
  'mass_disable_identities', 'delete_customer_data', 'delete_recovery_data',
  'production_wide_credential_rotation', 'customer_wide_shutdown', 'organisation_wide_shutdown',
  'bulk_restore', 'alter_payroll_or_workforce_records', 'hack_back',
  'access_unauthorised_third_party_system'
]) assert.ok(forbidden.has(required), `Missing forbidden action: ${required}`);
for (const action of safe.actions) assert.equal(forbidden.has(action), false, `Action is both safe and forbidden: ${action}`);

assert.ok(Array.isArray(policy.survival_invariants) && policy.survival_invariants.length >= 10);

// Repository instruction files are executable context for coding agents. They are not trusted
// merely because they live in Git. Until a reviewed content-hash allowlist exists, fail closed
// on the common agent instruction/control paths implicated in repository-poisoning attacks.
const guard = policy.repository_guard;
assert.equal(guard.agent_instruction_files_require_explicit_hash_allowlist, true);
assert.equal(guard.ci_agent_execution_mode, 'disabled_until_brokered');
assert.equal(guard.untrusted_event_to_agent_execution_forbidden, true);
assert.equal(guard.workflow_secret_access_with_untrusted_ai_context_forbidden, true);
const allowlist = new Map((guard.default_allowlisted_instruction_files || []).map(x => [x.path, x.sha256]));

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p.replaceAll('\\', '/'));
  }
  return out;
}
const files = walk('.');
const sensitive = files.filter(file => {
  const base = path.posix.basename(file);
  return base === 'AGENTS.md' ||
    file === '.github/copilot-instructions.md' ||
    file.startsWith('.claude/') || file === '.claude' ||
    file.startsWith('.cursor/') || file === '.cursor' ||
    file.startsWith('.windsurf/') || file === '.windsurf' ||
    ['mcp.json', 'mcp-config.json', '.mcp.json'].includes(base);
});
for (const file of sensitive) {
  const expected = allowlist.get(file);
  assert.ok(expected, `Unreviewed agent instruction/control file detected: ${file}`);
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.equal(actual, expected, `Agent instruction/control file hash changed: ${file}`);
}

// Do not allow CI to invoke an AI coding/agent action until it is routed through the
// deterministic execution broker. This test intentionally examines only uses: entries.
for (const file of files.filter(f => f.startsWith('.github/workflows/') && /\.ya?ml$/.test(f))) {
  const text = fs.readFileSync(file, 'utf8');
  const uses = text.split(/\r?\n/).filter(line => /^\s*uses\s*:/.test(line));
  for (const line of uses) {
    assert.equal(/(anthropic|claude|openai|copilot|gemini|mcp)/i.test(line), false,
      `AI/agent workflow action requires broker review: ${file}: ${line.trim()}`);
  }
}

console.log('Agentic Execution Firewall Contract: PASS');
