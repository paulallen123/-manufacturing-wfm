from dataclasses import dataclass


@dataclass(frozen=True)
class PrivilegedWorkflowEvidence:
    repository_private: bool
    github_malicious_workflow_hold_applies: bool
    protected_release_branch: bool
    server_ruleset_present: bool
    workflow_execution_policy_enforced: bool
    owner_bypass_disabled: bool
    exact_source_tree_attested: bool
    independent_release_approval: bool
    short_lived_or_environment_gated_credential: bool
    telemetry_available: bool
    workflow_is_allowlisted: bool


@dataclass(frozen=True)
class PrivilegedWorkflowDecision:
    allow_secret_bearing_release: bool
    reason: str


def authorize_privileged_workflow(evidence: PrivilegedWorkflowEvidence) -> PrivilegedWorkflowDecision:
    """Fail closed before a privileged workflow can reach deployment credentials.

    This policy is deliberately stricter for a private repository because GitHub's
    automatic potentially-malicious workflow hold is documented as applying to
    public repositories only. Repository-local checks cannot be treated as an
    independent trust boundary against a compromised repository owner.
    """
    if not evidence.telemetry_available:
        return PrivilegedWorkflowDecision(False, "defender telemetry is unavailable")

    if evidence.repository_private and not evidence.github_malicious_workflow_hold_applies:
        if not evidence.workflow_execution_policy_enforced:
            return PrivilegedWorkflowDecision(
                False,
                "private repository lacks an independently enforced workflow execution policy",
            )

    if not evidence.protected_release_branch:
        return PrivilegedWorkflowDecision(False, "release branch is not server-side protected")

    if not evidence.server_ruleset_present:
        return PrivilegedWorkflowDecision(False, "no independent repository ruleset is present")

    if not evidence.owner_bypass_disabled:
        return PrivilegedWorkflowDecision(False, "repository owner can bypass the release trust boundary")

    if not evidence.workflow_is_allowlisted:
        return PrivilegedWorkflowDecision(False, "privileged workflow is outside the approved allowlist")

    if not evidence.exact_source_tree_attested:
        return PrivilegedWorkflowDecision(False, "exact source tree lacks independent attestation")

    if not evidence.independent_release_approval:
        return PrivilegedWorkflowDecision(False, "release lacks independent approval")

    if not evidence.short_lived_or_environment_gated_credential:
        return PrivilegedWorkflowDecision(
            False,
            "release still depends on a broadly exposed long-lived repository credential",
        )

    return PrivilegedWorkflowDecision(True, "privileged workflow trust boundary is independently enforced")
