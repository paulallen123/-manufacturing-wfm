from dataclasses import dataclass


@dataclass(frozen=True)
class CredentialRuntimeEvidence:
    sensitive_secret_present: bool
    image_digest_pinned: bool
    runtime_network_install: bool
    dependency_artifacts_preverified: bool
    provenance_verified: bool
    pre_execution_egress_denied: bool
    telemetry_available: bool


@dataclass(frozen=True)
class CredentialRuntimeDecision:
    allow_secret_bearing_runtime: bool
    reason: str


def authorize_credential_runtime(evidence: CredentialRuntimeEvidence) -> CredentialRuntimeDecision:
    """Fail closed before a credential-bearing proof/runtime can execute untrusted code.

    A secret-bearing runtime must not depend on mutable image tags, network-fetched
    executable dependencies, or unverified artifacts. If the sensitive secret is
    removed from the runtime, the policy permits the isolated proof surface even if
    those supply-chain assurances are not yet present.
    """
    if not evidence.telemetry_available:
        return CredentialRuntimeDecision(False, "defender telemetry unavailable")

    if not evidence.sensitive_secret_present:
        return CredentialRuntimeDecision(True, "no sensitive secret exposed to runtime")

    if not evidence.image_digest_pinned:
        return CredentialRuntimeDecision(False, "credential-bearing runtime uses mutable image reference")

    if evidence.runtime_network_install:
        return CredentialRuntimeDecision(False, "credential-bearing runtime fetches executable dependencies at start")

    if not evidence.dependency_artifacts_preverified:
        return CredentialRuntimeDecision(False, "runtime dependency artifacts are not independently verified")

    if not evidence.provenance_verified:
        return CredentialRuntimeDecision(False, "runtime image/dependency provenance is not independently verified")

    if not evidence.pre_execution_egress_denied:
        return CredentialRuntimeDecision(False, "secret is reachable before outbound execution is constrained")

    return CredentialRuntimeDecision(True, "credential-bearing runtime meets immutable/offline/verified boundary")
