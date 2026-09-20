from dataclasses import dataclass


@dataclass(frozen=True)
class DeploymentTelemetryEvidence:
    credential_bearing_service: bool
    containment_hold_configured: bool
    deployment_terminal: bool
    deployment_succeeded: bool
    build_log_entries: int
    deploy_log_entries: int
    builder_scheduled_observed: bool
    terminal_reason_observed: bool
    log_query_succeeded: bool
    repeated_query_count: int
    unexpected_source_execution_observed: bool
    prior_successful_runtime_present: bool = False
    prior_runtime_publicly_reachable: bool = False
    prior_runtime_sensitive_secret_present: bool = False
    prior_runtime_access_after_containment_attempt: bool = False


@dataclass(frozen=True)
class DeploymentTelemetryDecision:
    allow_release: bool
    keep_containment: bool
    telemetry_incident: bool
    reason: str


def assess_deployment_telemetry(
    evidence: DeploymentTelemetryEvidence,
) -> DeploymentTelemetryDecision:
    """Treat missing defender evidence or surviving prior runtime as release-blocking.

    The gate does not attempt to infer why Railway telemetry is absent. It preserves
    the bounded build hold and requires an observable terminal reason before a
    credential-bearing deployment can be trusted. A failed/held replacement also
    does not count as containment if the prior successful credential-bearing runtime
    remains publicly reachable or continues receiving authenticated access.
    """
    if evidence.unexpected_source_execution_observed:
        return DeploymentTelemetryDecision(
            False,
            True,
            True,
            "unexpected source execution observed during containment",
        )

    if not evidence.log_query_succeeded:
        return DeploymentTelemetryDecision(
            False,
            True,
            True,
            "deployment telemetry query failed",
        )

    if evidence.credential_bearing_service and not evidence.containment_hold_configured:
        return DeploymentTelemetryDecision(
            False,
            True,
            False,
            "credential-bearing service lacks bounded build containment",
        )

    if (
        evidence.credential_bearing_service
        and evidence.prior_successful_runtime_present
        and evidence.prior_runtime_sensitive_secret_present
        and (
            evidence.prior_runtime_publicly_reachable
            or evidence.prior_runtime_access_after_containment_attempt
        )
    ):
        return DeploymentTelemetryDecision(
            False,
            True,
            False,
            "failed/held replacement did not contain the prior credential-bearing runtime",
        )

    if evidence.deployment_terminal and evidence.build_log_entries == 0:
        return DeploymentTelemetryDecision(
            False,
            True,
            True,
            "terminal deployment has no build telemetry",
        )

    if (
        evidence.deployment_terminal
        and evidence.builder_scheduled_observed
        and not evidence.terminal_reason_observed
        and evidence.repeated_query_count >= 2
    ):
        return DeploymentTelemetryDecision(
            False,
            True,
            True,
            "terminal deployment lacks an observable terminal build reason after repeated queries",
        )

    if evidence.deployment_succeeded and evidence.deploy_log_entries == 0:
        return DeploymentTelemetryDecision(
            False,
            True,
            True,
            "successful deployment has no runtime telemetry",
        )

    return DeploymentTelemetryDecision(
        True,
        False,
        False,
        "deployment telemetry and runtime containment are sufficient for this gate",
    )
