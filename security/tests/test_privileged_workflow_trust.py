from security.policies.privileged_workflow_trust import (
    PrivilegedWorkflowEvidence,
    authorize_privileged_workflow,
)


def decision(**overrides):
    values = {
        "repository_private": True,
        "github_malicious_workflow_hold_applies": False,
        "protected_release_branch": True,
        "server_ruleset_present": True,
        "workflow_execution_policy_enforced": True,
        "owner_bypass_disabled": True,
        "exact_source_tree_attested": True,
        "independent_release_approval": True,
        "short_lived_or_environment_gated_credential": True,
        "telemetry_available": True,
        "workflow_is_allowlisted": True,
    }
    values.update(overrides)
    return authorize_privileged_workflow(PrivilegedWorkflowEvidence(**values))


def test_private_repo_without_independent_execution_policy_blocks_secrets():
    result = decision(workflow_execution_policy_enforced=False)
    assert result.allow_secret_bearing_release is False
    assert "workflow execution policy" in result.reason


def test_verified_or_allowlisted_workflow_cannot_override_unprotected_branch():
    result = decision(protected_release_branch=False)
    assert result.allow_secret_bearing_release is False
    assert "not server-side protected" in result.reason


def test_zero_rulesets_blocks_release_even_with_owner_actor():
    result = decision(server_ruleset_present=False)
    assert result.allow_secret_bearing_release is False
    assert "no independent repository ruleset" in result.reason


def test_owner_bypass_path_is_denied():
    result = decision(owner_bypass_disabled=False)
    assert result.allow_secret_bearing_release is False
    assert "owner can bypass" in result.reason


def test_new_unapproved_privileged_workflow_is_denied():
    result = decision(workflow_is_allowlisted=False)
    assert result.allow_secret_bearing_release is False
    assert "outside the approved allowlist" in result.reason


def test_telemetry_loss_is_incident_and_blocks_secret_release():
    result = decision(telemetry_available=False)
    assert result.allow_secret_bearing_release is False
    assert "telemetry is unavailable" in result.reason


def test_long_lived_repository_secret_is_denied():
    result = decision(short_lived_or_environment_gated_credential=False)
    assert result.allow_secret_bearing_release is False
    assert "long-lived repository credential" in result.reason


def test_full_independent_boundary_can_release():
    result = decision()
    assert result.allow_secret_bearing_release is True
