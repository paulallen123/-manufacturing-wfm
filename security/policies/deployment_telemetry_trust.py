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


@dataclass(frozen=True)
class DeploymentTelemetryDecision:
    allow_release: bool
    keep_containment: bool
    telemetry_incident: bool
    reason: str


def assess_deployment_telemetry(
    evidence: DeploymentTelemetryEvidence,
) -> DeploymentTelemetryDecision:
    """Treat missing defender evidence as a release-blocking security condition.

    The gate does not attempt to infer why Railway telemetry is absent. It preserves
    the bounded build hold and requires an observable terminal reason before a
    credential-bearing deployment can be trusted. This keeps containment narrow and
    reversible while avoiding a false 'safe' conclusion from missing logs.
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
        "deployment telemetry is sufficient for this gate",
    )
