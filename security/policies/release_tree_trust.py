from dataclasses import dataclass


@dataclass(frozen=True)
class ReleaseEvidence:
    candidate_sha: str
    artifact_sha: str
    candidate_commit_verified: bool
    parent_tree_attested: bool
    branch_protected: bool
    independent_approval: bool
    workflow_self_change_only: bool = False


@dataclass(frozen=True)
class ReleaseDecision:
    allow: bool
    reason: str


def authorize_release(evidence: ReleaseEvidence) -> ReleaseDecision:
    """Fail closed unless the exact release tree has independent trust evidence.

    A signed workflow-only merge must never bootstrap trust for an untrusted
    mutable parent tree. Evidence inputs are expected to be produced by the
    deterministic release executor from independent control-plane sources.
    """
    if not evidence.candidate_sha or evidence.artifact_sha != evidence.candidate_sha:
        return ReleaseDecision(False, "artifact is not the exact approved candidate")

    if not evidence.candidate_commit_verified:
        return ReleaseDecision(False, "candidate commit is not cryptographically verified")

    if evidence.workflow_self_change_only and not evidence.parent_tree_attested:
        return ReleaseDecision(
            False,
            "workflow-only merge cannot bootstrap trust for an untrusted parent tree",
        )

    if not evidence.parent_tree_attested:
        return ReleaseDecision(False, "candidate source tree lacks independent attestation")

    if not evidence.branch_protected:
        return ReleaseDecision(False, "candidate came from an unprotected mutable release branch")

    if not evidence.independent_approval:
        return ReleaseDecision(False, "release lacks independent approval")

    return ReleaseDecision(True, "independently attested exact candidate may proceed")
