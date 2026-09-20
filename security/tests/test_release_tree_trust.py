from security.policies.release_tree_trust import ReleaseEvidence, authorize_release


def decision(**overrides):
    values = {
        "candidate_sha": "candidate",
        "artifact_sha": "candidate",
        "candidate_commit_verified": True,
        "parent_tree_attested": True,
        "branch_protected": True,
        "independent_approval": True,
        "workflow_self_change_only": False,
    }
    values.update(overrides)
    return authorize_release(ReleaseEvidence(**values))


def test_signed_workflow_merge_cannot_bootstrap_untrusted_parent():
    result = decision(
        parent_tree_attested=False,
        branch_protected=False,
        workflow_self_change_only=True,
    )
    assert result.allow is False
    assert "cannot bootstrap trust" in result.reason


def test_exact_artifact_from_mutable_release_branch_is_blocked():
    result = decision(branch_protected=False)
    assert result.allow is False
    assert "unprotected mutable release branch" in result.reason


def test_signed_release_authority_is_invalidated_by_later_unsigned_head_commit():
    result = decision(candidate_commit_verified=False)
    assert result.allow is False
    assert "not cryptographically verified" in result.reason


def test_artifact_must_match_exact_candidate():
    result = decision(artifact_sha="different")
    assert result.allow is False


def test_independent_approval_is_mandatory():
    result = decision(independent_approval=False)
    assert result.allow is False


def test_fully_attested_exact_candidate_can_proceed():
    result = decision()
    assert result.allow is True
