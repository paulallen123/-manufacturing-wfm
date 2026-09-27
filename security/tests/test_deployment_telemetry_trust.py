import unittest

from security.policies.deployment_telemetry_trust import (
    DeploymentTelemetryEvidence,
    assess_deployment_telemetry,
)


class TestDeploymentTelemetryTrust(unittest.TestCase):
    def evidence(self, **overrides):
        base = {
            "credential_bearing_service": True,
            "containment_hold_configured": True,
            "deployment_terminal": True,
            "deployment_succeeded": False,
            "build_log_entries": 4,
            "deploy_log_entries": 0,
            "builder_scheduled_observed": True,
            "terminal_reason_observed": True,
            "log_query_succeeded": True,
            "repeated_query_count": 2,
            "unexpected_source_execution_observed": False,
            "prior_successful_runtime_present": False,
            "prior_runtime_publicly_reachable": False,
            "prior_runtime_sensitive_secret_present": False,
            "prior_runtime_access_after_containment_attempt": False,
        }
        base.update(overrides)
        return DeploymentTelemetryEvidence(**base)

    def test_repeated_missing_terminal_reason_is_incident(self):
        decision = assess_deployment_telemetry(
            self.evidence(build_log_entries=1, terminal_reason_observed=False)
        )
        self.assertFalse(decision.allow_release)
        self.assertTrue(decision.keep_containment)
        self.assertTrue(decision.telemetry_incident)

    def test_missing_all_build_telemetry_is_incident(self):
        decision = assess_deployment_telemetry(
            self.evidence(
                build_log_entries=0,
                builder_scheduled_observed=False,
                terminal_reason_observed=False,
            )
        )
        self.assertFalse(decision.allow_release)
        self.assertTrue(decision.telemetry_incident)

    def test_log_query_failure_is_incident(self):
        decision = assess_deployment_telemetry(
            self.evidence(log_query_succeeded=False)
        )
        self.assertFalse(decision.allow_release)
        self.assertTrue(decision.telemetry_incident)

    def test_unexpected_execution_is_incident(self):
        decision = assess_deployment_telemetry(
            self.evidence(unexpected_source_execution_observed=True)
        )
        self.assertFalse(decision.allow_release)
        self.assertTrue(decision.keep_containment)

    def test_credential_bearing_service_without_hold_fails_closed(self):
        decision = assess_deployment_telemetry(
            self.evidence(containment_hold_configured=False)
        )
        self.assertFalse(decision.allow_release)
        self.assertTrue(decision.keep_containment)
        self.assertFalse(decision.telemetry_incident)

    def test_success_without_runtime_telemetry_fails_closed(self):
        decision = assess_deployment_telemetry(
            self.evidence(deployment_succeeded=True, deploy_log_entries=0)
        )
        self.assertFalse(decision.allow_release)
        self.assertTrue(decision.telemetry_incident)

    def test_prior_secret_bearing_runtime_still_public_fails_closed(self):
        decision = assess_deployment_telemetry(
            self.evidence(
                prior_successful_runtime_present=True,
                prior_runtime_publicly_reachable=True,
                prior_runtime_sensitive_secret_present=True,
            )
        )
        self.assertFalse(decision.allow_release)
        self.assertTrue(decision.keep_containment)
        self.assertFalse(decision.telemetry_incident)

    def test_authenticated_access_after_hold_fails_closed(self):
        decision = assess_deployment_telemetry(
            self.evidence(
                prior_successful_runtime_present=True,
                prior_runtime_sensitive_secret_present=True,
                prior_runtime_access_after_containment_attempt=True,
            )
        )
        self.assertFalse(decision.allow_release)
        self.assertTrue(decision.keep_containment)

    def test_secretless_prior_runtime_does_not_fail_runtime_gate(self):
        decision = assess_deployment_telemetry(
            self.evidence(
                prior_successful_runtime_present=True,
                prior_runtime_publicly_reachable=True,
                prior_runtime_sensitive_secret_present=False,
            )
        )
        self.assertTrue(decision.allow_release)

    def test_complete_failed_build_evidence_passes_this_gate(self):
        decision = assess_deployment_telemetry(self.evidence())
        self.assertTrue(decision.allow_release)
        self.assertFalse(decision.telemetry_incident)


if __name__ == "__main__":
    unittest.main()
