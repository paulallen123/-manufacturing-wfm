from security.policies.credential_bearing_runtime import (
    CredentialRuntimeEvidence,
    authorize_credential_runtime,
)


def decision(**overrides):
    values = {
        "sensitive_secret_present": True,
        "image_digest_pinned": True,
        "runtime_network_install": False,
        "dependency_artifacts_preverified": True,
        "provenance_verified": True,
        "pre_execution_egress_denied": True,
        "telemetry_available": True,
    }
    values.update(overrides)
    return authorize_credential_runtime(CredentialRuntimeEvidence(**values))


def test_mutable_image_blocks_secret_runtime():
    result = decision(image_digest_pinned=False)
    assert result.allow_secret_bearing_runtime is False
    assert "mutable image" in result.reason


def test_network_dependency_install_blocks_secret_runtime():
    result = decision(runtime_network_install=True)
    assert result.allow_secret_bearing_runtime is False
    assert "fetches executable dependencies" in result.reason


def test_unverified_dependency_artifacts_block_secret_runtime():
    result = decision(dependency_artifacts_preverified=False)
    assert result.allow_secret_bearing_runtime is False
    assert "not independently verified" in result.reason


def test_unverified_provenance_blocks_secret_runtime():
    result = decision(provenance_verified=False)
    assert result.allow_secret_bearing_runtime is False
    assert "provenance" in result.reason


def test_pre_execution_egress_must_be_denied():
    result = decision(pre_execution_egress_denied=False)
    assert result.allow_secret_bearing_runtime is False
    assert "outbound execution" in result.reason


def test_telemetry_loss_blocks_secret_runtime():
    result = decision(telemetry_available=False)
    assert result.allow_secret_bearing_runtime is False
    assert "telemetry" in result.reason


def test_removing_sensitive_secret_allows_isolated_proof_surface():
    result = decision(
        sensitive_secret_present=False,
        image_digest_pinned=False,
        runtime_network_install=True,
        dependency_artifacts_preverified=False,
        provenance_verified=False,
        pre_execution_egress_denied=False,
    )
    assert result.allow_secret_bearing_runtime is True
    assert "no sensitive secret" in result.reason


def test_fully_verified_secret_runtime_can_proceed():
    result = decision()
    assert result.allow_secret_bearing_runtime is True
