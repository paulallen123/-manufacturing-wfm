# Discarded Railway build stage: prove T0-T4 zero-engineer support and bounded recovery
# against the exact candidate sources. Nothing from this stage is copied into runtime.
FROM node:22.23.2-bookworm-slim@sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96 AS autonomy-proof
WORKDIR /proof
COPY . ./
RUN node scripts/validate-development-proof-readiness.mjs \
 && node scripts/validate-proof-blocker-classifier.mjs \
 && node scripts/validate-proof-stage-router.mjs \
 && node scripts/validate-completion-rehearsal.mjs \
 && node scripts/validate-t9-customer-guardian.mjs \
 && node scripts/run-completion-rehearsal.mjs --assert-orchestration \
 && node scripts/validate-deployment.mjs \
 && node scripts/validate-proof-lane-policy.mjs \
 && node --test resilience/pre-freeze-simulator.test.cjs resilience/no-idle-wait-orchestrator.test.cjs \
 && node scripts/validate-isolated-environment-provisioning-plan.mjs \
 && node scripts/validate-capability-superset.mjs \
 && node scripts/validate-research-convergence-ledger.mjs \
 && node --test resilience/research-convergence-theory-simulator.test.cjs policy/runtime/country-policy-pack-registry.test.cjs policy/runtime/jurisdiction-policy-graph.test.cjs policy/runtime/global-site-policy-preflight.test.cjs policy/runtime/authoritative-policy-source-registry.test.cjs policy/runtime/regulatory-change-candidate.test.cjs security/runtime/runtime-identity.test.cjs \
 && node scripts/validate-product-factory.mjs \
 && node scripts/prove-adaptive-intelligence-engine.mjs \
 && node scripts/validate-self-evolution.mjs \
 && node scripts/validate-vector-only-ui.mjs \
 && node --check learning/video-worker/runner.mjs \
 && node integration-fabric/scripts/validate.mjs \
 && node scripts/run-critical-attendance-assault.mjs \
 && node --test tests/critical-proof-gates.test.cjs tests/vector-payroll-release-proof.test.mjs tests/vector-consolidation.test.cjs tests/vector-runtime-packaging.test.cjs tests/vector-http-verifier.test.cjs tests/vector-release-proof-binding.test.cjs tests/vector-source-guard.test.cjs ux-overlay/vector-action-queue.test.cjs ux-overlay/vector-workflows.test.cjs ux-overlay/vector-scheduling-simplicity-contract.test.cjs operations/runtime/workflow-action-evidence-contract.test.cjs operations/runtime/manufacturing-scheduling-engine.test.cjs operations/runtime/scheduling-intelligence-service.test.cjs operations/runtime/manufacturing-demand-forecast.test.cjs operations/runtime/schedule-attendance-reconciliation.test.cjs operations/runtime/scheduling-forecast-reconciliation-service.test.cjs operations/runtime/decision-episode.test.cjs operations/runtime/customer-demand-intelligence.test.cjs operations/runtime/absence-recovery-shadow.test.cjs operations/runtime/demand-decision-service.test.cjs operations/runtime/decision-outcome-proof.test.cjs scripts/compose-vector-presentation.regression.test.mjs scripts/prove-vector-built-asset-provenance.test.mjs test/frontier/cash-to-capacity-engine.test.mjs test/frontier/cash-to-capacity-evidence.test.mjs test/frontier/cash-to-capacity-decision.test.mjs test/frontier/cash-to-capacity-outcome.test.mjs test/frontier/energy-bill-evidence.test.mjs test/frontier/energy-coordination-sensitivity.test.mjs test/frontier/energy-data-reconciliation.test.mjs test/frontier/energy-flexibility.test.mjs test/frontier/energy-input-hardening.test.mjs test/frontier/energy-profile-benchmark.test.mjs test/frontier/energy-profile-binding.test.mjs $(find test/frontier -maxdepth 1 -name 'agency-*.test.mjs' ! -name '*postgres*' -print) $(find clocking-security-v2 -maxdepth 1 -name '*.test.mjs' ! -name '*soak*' ! -name '*live*' ! -name '*enterprise-scale*' -print) integration-fabric/runtime/*.test.mjs operations/runtime/realtime-event-service.test.cjs operations/runtime/autopilot-execution-engine.test.cjs operations/runtime/autopilot-ingress.security.test.cjs operations/runtime/autopilot-replay.regression.test.cjs implementation/runtime/zero-touch-customer-factory.test.cjs implementation/runtime/zero-touch-customer-factory.boundaries.test.cjs implementation/runtime/implementation-work-controller.test.cjs implementation/runtime/implementation-active-controller.integration.test.cjs operations/runtime/t9-customer-guardian.test.cjs reporting/runtime/vector-reporting-service.test.cjs trust/runtime/vector-trust-spine.test.cjs security/runtime/identity-survival-guard.test.cjs security/runtime/proof-runner-auth.test.cjs security/runtime/bootstrap-proof-runner-wiring.test.cjs security/runtime/owner-access-recovery.test.cjs security/runtime/durable-state-guard.test.cjs learning/runtime/training-workflow-manifest.test.cjs learning/runtime/training-twin.test.cjs learning/runtime/training-scenario-engine.test.cjs learning/runtime/training-delivery-service.test.cjs learning/runtime/training-video-contract.test.cjs learning/runtime/training-artifact-registry.test.cjs learning/runtime/training-regeneration-planner.test.cjs \
 && node scripts/run-local-vector-proof.mjs /proof-vector-integrated \
 && cat /proof-vector-integrated/summary.json \
 && rm -f scripts/validate-deployment.mjs \
 && node scripts/run-portable-autonomy-proof.mjs --strict-runtime

# Customer-proof staging build: sealed 0.6.76 runtime
FROM node:22.23.2-bookworm-slim@sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96
ARG RAILWAY_GIT_COMMIT_SHA
WORKDIR /app

# Railway volumes are mounted root-owned. gosu is used only by the init wrapper
# to repair ownership on the isolated volume and then permanently drop to node.
RUN apt-get update \
 && apt-get install -y --no-install-recommends gosu \
 && rm -rf /var/lib/apt/lists/*

# Force the discarded T0-T4 proof stage to execute and admit only its non-secret PASS receipt.
# No support/repair source code is copied into the runtime stage; the receipt is verified then removed.
COPY --from=autonomy-proof /proof/portable-autonomy-proof.json /tmp/portable-autonomy-proof.json
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('/tmp/portable-autonomy-proof.json','utf8'));if(p.status!=='PASS'||p.strictRuntime!==true||p.productionMutation!==false||p.customerMutation!==false)process.exit(1);console.log('WFM_T0_T4_AUTONOMY_ADMISSION=PASS')" \
 && rm -f /tmp/portable-autonomy-proof.json

COPY artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz /tmp/runtime.tgz
RUN echo "3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d  /tmp/runtime.tgz" | sha256sum -c - \
 && tar -xzf /tmp/runtime.tgz -C /app \
 && rm -f /tmp/runtime.tgz
COPY scripts/retire-legacy-presentation.mjs /tmp/retire-legacy-presentation.mjs
COPY scripts/harden-attendance-integrity.mjs /tmp/harden-attendance-integrity.mjs
RUN node /tmp/retire-legacy-presentation.mjs /app/public \
 && node /tmp/harden-attendance-integrity.mjs /app/public \
 && rm -f /tmp/retire-legacy-presentation.mjs /tmp/harden-attendance-integrity.mjs

# Resource-side identity survival overlay. Keep the original sealed artifact intact and
# add the defence overlay as a separately reviewable layer.
RUN mkdir -p /app/security-runtime
COPY security/runtime/identity-survival-guard.cjs /app/security-runtime/identity-survival-guard.cjs
COPY security/runtime/proof-runner-auth.cjs /app/security-runtime/proof-runner-auth.cjs
COPY security/runtime/hosted-listen-guard.cjs /app/security-runtime/hosted-listen-guard.cjs
COPY security/runtime/bootstrap.cjs /app/security-runtime/bootstrap.cjs
COPY security/runtime/owner-access-recovery.cjs /app/security-runtime/owner-access-recovery.cjs
COPY security/runtime/durable-state-guard.cjs /app/security-runtime/durable-state-guard.cjs
COPY security/runtime/runtime-identity.cjs /app/security-runtime/runtime-identity.cjs
COPY security/runtime/retired-presentation.cjs /app/security-runtime/retired-presentation.cjs

# Railway supplies the triggering Git SHA to builds and deployments. Seal the build-time
# value into the read-only image so runtime proof cannot be manufactured by echoing the
# independently configured expected SHA.
RUN node -e "const fs=require('fs');const sha=String(process.env.RAILWAY_GIT_COMMIT_SHA||'').trim().toLowerCase();if(!/^[0-9a-f]{40}$/.test(sha))throw new Error('WFM_BUILD_SOURCE_SHA_INVALID');fs.writeFileSync('/app/.wfm-build-source-sha',sha+'\\n',{mode:0o444});console.log('WFM_BUILD_SOURCE_SHA=SEALED')"

# Autonomous integration fabric. The control plane is separately reviewable and
# uses only Node built-ins plus the existing per-tenant SQLite runtime.
RUN mkdir -p /app/integration-runtime /app/worker
COPY integration/runtime/autonomous-integration-hub.cjs /app/integration-runtime/autonomous-integration-hub.cjs
COPY integration/runtime/directory-oauth-broker.cjs /app/integration-runtime/directory-oauth-broker.cjs
COPY integration/worker/directory-discovery-worker.cjs /app/worker/directory-discovery-worker.cjs
RUN mkdir -p /app/integration-fabric-runtime /app/integration-fabric-catalog
COPY integration-fabric/runtime/api-version-routing.mjs /app/integration-fabric-runtime/api-version-routing.mjs
COPY integration-fabric/runtime/batch-reconciliation.mjs /app/integration-fabric-runtime/batch-reconciliation.mjs
COPY integration-fabric/runtime/connection-test-plan.mjs /app/integration-fabric-runtime/connection-test-plan.mjs
COPY integration-fabric/runtime/connector-registry.mjs /app/integration-fabric-runtime/connector-registry.mjs
COPY integration-fabric/runtime/dataset-coverage.mjs /app/integration-fabric-runtime/dataset-coverage.mjs
COPY integration-fabric/runtime/evidence-provenance.mjs /app/integration-fabric-runtime/evidence-provenance.mjs
COPY integration-fabric/runtime/governed-read-projection-registry.mjs /app/integration-fabric-runtime/governed-read-projection-registry.mjs
COPY integration-fabric/runtime/governed-read-projection.mjs /app/integration-fabric-runtime/governed-read-projection.mjs
COPY integration-fabric/runtime/privileged-bootstrap-guard.mjs /app/integration-fabric-runtime/privileged-bootstrap-guard.mjs
COPY integration-fabric/runtime/regional-route-authority.mjs /app/integration-fabric-runtime/regional-route-authority.mjs
COPY integration-fabric/runtime/rpc-read-authority.mjs /app/integration-fabric-runtime/rpc-read-authority.mjs
COPY integration-fabric/runtime/schema-negotiation.mjs /app/integration-fabric-runtime/schema-negotiation.mjs
COPY integration-fabric/runtime/scope-partition.mjs /app/integration-fabric-runtime/scope-partition.mjs
COPY integration-fabric/runtime/semantic-envelope.mjs /app/integration-fabric-runtime/semantic-envelope.mjs
COPY integration-fabric/runtime/session-broker.mjs /app/integration-fabric-runtime/session-broker.mjs
COPY integration-fabric/runtime/session-read-authority.mjs /app/integration-fabric-runtime/session-read-authority.mjs
COPY integration-fabric/runtime/static-credential-authority.mjs /app/integration-fabric-runtime/static-credential-authority.mjs
COPY integration-fabric/systems.json /app/integration-fabric-catalog/systems.json
COPY integration-fabric/protocol-profiles.json /app/integration-fabric-catalog/protocol-profiles.json
COPY integration-fabric/opportunity-profiles.json /app/integration-fabric-catalog/opportunity-profiles.json
COPY integration-fabric/openapi.yaml /app/integration-fabric-catalog/openapi.yaml

# Preserve the Integration Fabric source-relative module layout as a runtime-verifiable tree.
# Existing compatibility copies above remain in place until every consumer is migrated.
RUN mkdir -p /app/integration-fabric/runtime /app/integration-fabric/scripts /app/integration-fabric/research-overlays
COPY integration-fabric/runtime/ /app/integration-fabric/runtime/
COPY integration-fabric/scripts/load-catalog.mjs /app/integration-fabric/scripts/load-catalog.mjs
COPY integration-fabric/systems.json /app/integration-fabric/systems.json
COPY integration-fabric/systems-research.json /app/integration-fabric/systems-research.json
COPY integration-fabric/research-overlays/ /app/integration-fabric/research-overlays/
COPY integration-fabric/protocol-profiles.json /app/integration-fabric/protocol-profiles.json
COPY integration-fabric/opportunity-profiles.json /app/integration-fabric/opportunity-profiles.json
COPY integration-fabric/openapi.yaml /app/integration-fabric/openapi.yaml

# One-day implementation and adaptive learning overlays. These remain additive,
# tenant-scoped, fail-closed control planes using Node built-ins and the existing SQLite state.
RUN mkdir -p /app/implementation-runtime /app/learning-runtime /app/operations-runtime /tmp/wfm-learning-ui /tmp/wfm-implementation-ui
COPY implementation/runtime/one-day-enterprise-engine.cjs /app/implementation-runtime/one-day-enterprise-engine.cjs
COPY implementation/runtime/one-day-enterprise-engine-core.cjs /app/implementation-runtime/one-day-enterprise-engine-core.cjs
COPY implementation/runtime/implementation-work-controller.cjs /app/implementation-runtime/implementation-work-controller.cjs
COPY implementation/runtime/readiness-evidence-contract.cjs /app/implementation-runtime/readiness-evidence-contract.cjs
COPY implementation/runtime/configuration-inference-engine.cjs /app/implementation-runtime/configuration-inference-engine.cjs
COPY implementation/runtime/implementation-digital-twin.cjs /app/implementation-runtime/implementation-digital-twin.cjs
COPY implementation/runtime/tenant-environment-provisioner.cjs /app/implementation-runtime/tenant-environment-provisioner.cjs
COPY learning/runtime/adaptive-learning-engine.cjs /app/learning-runtime/adaptive-learning-engine.cjs
COPY learning/runtime/training-workflow-manifest.cjs /app/learning-runtime/training-workflow-manifest.cjs
COPY learning/runtime/training-twin.cjs /app/learning-runtime/training-twin.cjs
COPY learning/runtime/training-scenario-engine.cjs /app/learning-runtime/training-scenario-engine.cjs
COPY learning/runtime/training-delivery-service.cjs /app/learning-runtime/training-delivery-service.cjs
COPY learning/runtime/training-video-contract.cjs /app/learning-runtime/training-video-contract.cjs
COPY learning/runtime/training-artifact-registry.cjs /app/learning-runtime/training-artifact-registry.cjs
COPY learning/runtime/training-regeneration-planner.cjs /app/learning-runtime/training-regeneration-planner.cjs
RUN mkdir -p /app/learning-runtime/evolution /app/product-factory/features
COPY adaptive-intelligence/engine.mjs /app/learning-runtime/evolution/engine.mjs
COPY product-factory/adaptive-intelligence-manifest.json /app/product-factory/adaptive-intelligence-manifest.json
COPY product-factory/learning-receipt-schema.json /app/product-factory/learning-receipt-schema.json
COPY product-factory/features/self-evolving-customer-intelligence.json /app/product-factory/features/self-evolving-customer-intelligence.json
COPY product-factory/features/verified-value-ledger.json /app/product-factory/features/verified-value-ledger.json
COPY operations/runtime/workforce-lifecycle-guard.cjs /app/operations-runtime/workforce-lifecycle-core.cjs
COPY operations/runtime/workflow-action-evidence-contract.cjs /app/operations-runtime/workflow-action-evidence-contract.cjs
COPY operations/runtime/workflow-action-evidence-bridge.cjs /app/operations-runtime/workflow-action-evidence-bridge.cjs
COPY operations/runtime/decision-episode.cjs /app/operations-runtime/decision-episode.cjs
COPY operations/runtime/manufacturing-scheduling-engine.cjs /app/operations-runtime/manufacturing-scheduling-engine.cjs
COPY operations/runtime/scheduling-intelligence-service.cjs /app/operations-runtime/scheduling-intelligence-service.cjs
COPY operations/runtime/manufacturing-demand-forecast.cjs /app/operations-runtime/manufacturing-demand-forecast.cjs
COPY operations/runtime/schedule-attendance-reconciliation.cjs /app/operations-runtime/schedule-attendance-reconciliation.cjs
COPY operations/runtime/customer-demand-intelligence.cjs /app/operations-runtime/customer-demand-intelligence.cjs
COPY operations/runtime/absence-recovery-shadow.cjs /app/operations-runtime/absence-recovery-shadow.cjs
COPY operations/runtime/demand-decision-service.cjs /app/operations-runtime/demand-decision-service.cjs
COPY operations/runtime/decision-outcome-proof.cjs /app/operations-runtime/decision-outcome-proof.cjs
COPY operations/runtime/realtime-event-service.cjs /app/operations-runtime/realtime-event-service.cjs
COPY operations/runtime/autopilot-execution-engine.cjs /app/operations-runtime/autopilot-execution-engine.cjs
COPY operations/runtime/t9-customer-guardian.cjs /app/operations-runtime/t9-customer-guardian.cjs
RUN mkdir -p /app/reporting-runtime /app/policy-runtime
COPY reporting/runtime/vector-reporting-service.cjs /app/reporting-runtime/vector-reporting-service.cjs
COPY policy/runtime/country-policy-pack-registry.cjs /app/policy-runtime/country-policy-pack-registry.cjs
COPY policy/runtime/jurisdiction-policy-graph.cjs /app/policy-runtime/jurisdiction-policy-graph.cjs
COPY policy/runtime/global-site-policy-preflight.cjs /app/policy-runtime/global-site-policy-preflight.cjs
COPY policy/runtime/authoritative-policy-source-registry.cjs /app/policy-runtime/authoritative-policy-source-registry.cjs
COPY policy/runtime/regulatory-change-candidate.cjs /app/policy-runtime/regulatory-change-candidate.cjs
RUN mkdir -p /app/trust-runtime
COPY trust/runtime/vector-trust-spine.cjs /app/trust-runtime/vector-trust-spine.cjs
COPY src/frontier/cash-to-capacity-engine.mjs /app/operations-runtime/cash-to-capacity-engine.mjs
COPY src/frontier/cash-to-capacity-evidence.mjs /app/operations-runtime/cash-to-capacity-evidence.mjs
COPY src/frontier/cash-to-capacity-decision.mjs /app/operations-runtime/cash-to-capacity-decision.mjs
COPY src/frontier/cash-to-capacity-outcome.mjs /app/operations-runtime/cash-to-capacity-outcome.mjs
COPY src/frontier/energy-bill-evidence.mjs /app/operations-runtime/energy-bill-evidence.mjs
COPY src/frontier/energy-data-reconciliation.mjs /app/operations-runtime/energy-data-reconciliation.mjs
COPY src/frontier/energy-flexibility.mjs /app/operations-runtime/energy-flexibility.mjs
COPY src/frontier/energy-input-hardening.mjs /app/operations-runtime/energy-input-hardening.mjs
COPY src/frontier/energy-profile-benchmark.mjs /app/operations-runtime/energy-profile-benchmark.mjs
COPY src/frontier/energy-profile-binding.mjs /app/operations-runtime/energy-profile-binding.mjs
RUN mkdir -p /app/operations-runtime/agency
COPY src/frontier/agency-*.mjs /app/operations-runtime/agency/
RUN mkdir -p /app/operations-runtime/attendance
COPY clocking-security-v2/access-control-evidence.mjs /app/operations-runtime/attendance/access-control-evidence.mjs
COPY clocking-security-v2/access-feed-supervisor.mjs /app/operations-runtime/attendance/access-feed-supervisor.mjs
COPY clocking-security-v2/access-onboarding-autopilot.mjs /app/operations-runtime/attendance/access-onboarding-autopilot.mjs
COPY clocking-security-v2/access-push-adapters.mjs /app/operations-runtime/attendance/access-push-adapters.mjs
COPY clocking-security-v2/attendance-certification.mjs /app/operations-runtime/attendance/attendance-certification.mjs
COPY clocking-security-v2/attendance-coverage-assurance.mjs /app/operations-runtime/attendance/attendance-coverage-assurance.mjs
COPY clocking-security-v2/attendance-coverage-planner.mjs /app/operations-runtime/attendance/attendance-coverage-planner.mjs
COPY clocking-security-v2/attendance-payroll-gate.mjs /app/operations-runtime/attendance/attendance-payroll-gate.mjs
COPY clocking-security-v2/attendance-release-control.mjs /app/operations-runtime/attendance/attendance-release-control.mjs
COPY clocking-security-v2/attendance-source-supervisor.mjs /app/operations-runtime/attendance/attendance-source-supervisor.mjs
COPY clocking-security-v2/durable-attendance-journal.mjs /app/operations-runtime/attendance/durable-attendance-journal.mjs
COPY clocking-security-v2/durable-source-supervisor.mjs /app/operations-runtime/attendance/durable-source-supervisor.mjs
COPY clocking-security-v2/invisible-attendance-engine.mjs /app/operations-runtime/attendance/invisible-attendance-engine.mjs
COPY clocking-security-v2/signed-rollback-anchor.mjs /app/operations-runtime/attendance/signed-rollback-anchor.mjs
COPY clocking-security-v2/sqlite-attendance-runtime.mjs /app/operations-runtime/attendance/sqlite-attendance-runtime.mjs
COPY clocking-security-v2/sqlite-attendance-worker.mjs /app/operations-runtime/attendance/sqlite-attendance-worker.mjs
COPY clocking-security-v2/telemetry-continuity-guard.mjs /app/operations-runtime/attendance/telemetry-continuity-guard.mjs
COPY clocking-security-v2/trust-root-recovery-controller.mjs /app/operations-runtime/attendance/trust-root-recovery-controller.mjs
COPY clocking-security-v2/trust-root-recovery.mjs /app/operations-runtime/attendance/trust-root-recovery.mjs
COPY clocking-security-v2/wifi-evidence-adapters.mjs /app/operations-runtime/attendance/wifi-evidence-adapters.mjs
COPY clocking-security-v2/windows-wef-evidence.mjs /app/operations-runtime/attendance/windows-wef-evidence.mjs
COPY operations/runtime/workforce-lifecycle-router.cjs /app/operations-runtime/workforce-lifecycle-guard.cjs
COPY learning/ui/ /tmp/wfm-learning-ui/
COPY implementation/ui/ /tmp/wfm-implementation-ui/

# Exact cloud-scale proof runtime. Kept read-only with the application and executable only when explicitly selected.
RUN mkdir -p /app/proof-runtime
COPY implementation/proof/cloud-scale-proof-runner.cjs /app/proof-runtime/cloud-scale-proof-runner.cjs

# Deterministic build admission for the new implementation and learning control planes.
# Tests execute against the exact files copied into this image; test sources are removed
# afterwards so they do not expand the runtime attack surface.
RUN mkdir -p /tmp/wfm-tests/implementation/runtime /tmp/wfm-tests/learning/runtime /tmp/wfm-tests/security/runtime /tmp/wfm-tests/integration/runtime /tmp/wfm-tests/integration/worker /tmp/wfm-tests/operations/runtime /tmp/wfm-tests/reporting/runtime /tmp/wfm-tests/trust/runtime
COPY implementation/runtime/one-day-enterprise-engine.cjs /tmp/wfm-tests/implementation/runtime/one-day-enterprise-engine.cjs
COPY implementation/runtime/one-day-enterprise-engine-core.cjs /tmp/wfm-tests/implementation/runtime/one-day-enterprise-engine-core.cjs
COPY implementation/runtime/implementation-work-controller.cjs /tmp/wfm-tests/implementation/runtime/implementation-work-controller.cjs
COPY implementation/runtime/implementation-work-controller.test.cjs /tmp/wfm-tests/implementation/runtime/implementation-work-controller.test.cjs
COPY implementation/runtime/implementation-active-controller.integration.test.cjs /tmp/wfm-tests/implementation/runtime/implementation-active-controller.integration.test.cjs
COPY implementation/runtime/readiness-evidence-contract.cjs /tmp/wfm-tests/implementation/runtime/readiness-evidence-contract.cjs
COPY implementation/runtime/readiness-evidence-contract.test.cjs /tmp/wfm-tests/implementation/runtime/readiness-evidence-contract.test.cjs
COPY implementation/runtime/readiness-evidence-wrapper.test.cjs /tmp/wfm-tests/implementation/runtime/readiness-evidence-wrapper.test.cjs
COPY implementation/runtime/configuration-inference-engine.cjs /tmp/wfm-tests/implementation/runtime/configuration-inference-engine.cjs
COPY implementation/runtime/implementation-digital-twin.cjs /tmp/wfm-tests/implementation/runtime/implementation-digital-twin.cjs
COPY implementation/runtime/implementation-digital-twin.test.cjs /tmp/wfm-tests/implementation/runtime/implementation-digital-twin.test.cjs
COPY implementation/runtime/tenant-environment-provisioner.cjs /tmp/wfm-tests/implementation/runtime/tenant-environment-provisioner.cjs
COPY implementation/runtime/tenant-environment-provisioner.test.cjs /tmp/wfm-tests/implementation/runtime/tenant-environment-provisioner.test.cjs
COPY implementation/runtime/one-day-enterprise-engine.test.cjs /tmp/wfm-tests/implementation/runtime/one-day-enterprise-engine.test.cjs
COPY implementation/runtime/configuration-inference-engine.test.cjs /tmp/wfm-tests/implementation/runtime/configuration-inference-engine.test.cjs
COPY implementation/runtime/implementation-learning-integration.test.cjs /tmp/wfm-tests/implementation/runtime/implementation-learning-integration.test.cjs
COPY learning/runtime/adaptive-learning-engine.cjs /tmp/wfm-tests/learning/runtime/adaptive-learning-engine.cjs
COPY learning/runtime/adaptive-learning-engine.test.cjs /tmp/wfm-tests/learning/runtime/adaptive-learning-engine.test.cjs
COPY learning/runtime/training-workflow-manifest.cjs /tmp/wfm-tests/learning/runtime/training-workflow-manifest.cjs
COPY learning/runtime/training-workflow-manifest.test.cjs /tmp/wfm-tests/learning/runtime/training-workflow-manifest.test.cjs
COPY learning/runtime/training-twin.cjs /tmp/wfm-tests/learning/runtime/training-twin.cjs
COPY learning/runtime/training-twin.test.cjs /tmp/wfm-tests/learning/runtime/training-twin.test.cjs
COPY learning/runtime/training-scenario-engine.cjs /tmp/wfm-tests/learning/runtime/training-scenario-engine.cjs
COPY learning/runtime/training-scenario-engine.test.cjs /tmp/wfm-tests/learning/runtime/training-scenario-engine.test.cjs
COPY learning/runtime/training-delivery-service.cjs /tmp/wfm-tests/learning/runtime/training-delivery-service.cjs
COPY learning/runtime/training-delivery-service.test.cjs /tmp/wfm-tests/learning/runtime/training-delivery-service.test.cjs
COPY learning/runtime/training-video-contract.cjs /tmp/wfm-tests/learning/runtime/training-video-contract.cjs
COPY learning/runtime/training-video-contract.test.cjs /tmp/wfm-tests/learning/runtime/training-video-contract.test.cjs
COPY learning/runtime/training-artifact-registry.cjs /tmp/wfm-tests/learning/runtime/training-artifact-registry.cjs
COPY learning/runtime/training-artifact-registry.test.cjs /tmp/wfm-tests/learning/runtime/training-artifact-registry.test.cjs
COPY learning/runtime/training-regeneration-planner.cjs /tmp/wfm-tests/learning/runtime/training-regeneration-planner.cjs
COPY learning/runtime/training-regeneration-planner.test.cjs /tmp/wfm-tests/learning/runtime/training-regeneration-planner.test.cjs
COPY operations/runtime/decision-episode.cjs /tmp/wfm-tests/operations/runtime/decision-episode.cjs
COPY operations/runtime/manufacturing-scheduling-engine.cjs /tmp/wfm-tests/operations/runtime/manufacturing-scheduling-engine.cjs
COPY operations/runtime/manufacturing-scheduling-engine.test.cjs /tmp/wfm-tests/operations/runtime/manufacturing-scheduling-engine.test.cjs
COPY operations/runtime/manufacturing-demand-forecast.cjs /tmp/wfm-tests/operations/runtime/manufacturing-demand-forecast.cjs
COPY operations/runtime/manufacturing-demand-forecast.test.cjs /tmp/wfm-tests/operations/runtime/manufacturing-demand-forecast.test.cjs
COPY operations/runtime/schedule-attendance-reconciliation.cjs /tmp/wfm-tests/operations/runtime/schedule-attendance-reconciliation.cjs
COPY operations/runtime/schedule-attendance-reconciliation.test.cjs /tmp/wfm-tests/operations/runtime/schedule-attendance-reconciliation.test.cjs
COPY operations/runtime/scheduling-intelligence-service.cjs /tmp/wfm-tests/operations/runtime/scheduling-intelligence-service.cjs
COPY operations/runtime/scheduling-intelligence-service.test.cjs /tmp/wfm-tests/operations/runtime/scheduling-intelligence-service.test.cjs
COPY operations/runtime/scheduling-forecast-reconciliation-service.test.cjs /tmp/wfm-tests/operations/runtime/scheduling-forecast-reconciliation-service.test.cjs
COPY security/runtime/hosted-listen-guard.cjs /tmp/wfm-tests/security/runtime/hosted-listen-guard.cjs
COPY security/runtime/hosted-listen-guard.test.cjs /tmp/wfm-tests/security/runtime/hosted-listen-guard.test.cjs
COPY integration/runtime/autonomous-integration-hub.cjs /tmp/wfm-tests/integration/runtime/autonomous-integration-hub.cjs
COPY integration/runtime/autonomous-integration-hub.test.cjs /tmp/wfm-tests/integration/runtime/autonomous-integration-hub.test.cjs
COPY integration/runtime/directory-oauth-broker.cjs /tmp/wfm-tests/integration/runtime/directory-oauth-broker.cjs
COPY integration/runtime/directory-oauth-broker.test.cjs /tmp/wfm-tests/integration/runtime/directory-oauth-broker.test.cjs
COPY integration/worker/directory-discovery-worker.cjs /tmp/wfm-tests/integration/worker/directory-discovery-worker.cjs
COPY integration/worker/directory-discovery-worker.test.cjs /tmp/wfm-tests/integration/worker/directory-discovery-worker.test.cjs
COPY operations/runtime/workforce-lifecycle-guard.cjs /tmp/wfm-tests/operations/runtime/workforce-lifecycle-core.cjs
COPY operations/runtime/workforce-lifecycle-router.cjs /tmp/wfm-tests/operations/runtime/workforce-lifecycle-guard.cjs
COPY operations/runtime/workforce-lifecycle-guard.test.cjs /tmp/wfm-tests/operations/runtime/workforce-lifecycle-guard.test.cjs
COPY operations/runtime/workflow-action-evidence-contract.cjs /tmp/wfm-tests/operations/runtime/workflow-action-evidence-contract.cjs
COPY operations/runtime/workflow-action-evidence-contract.test.cjs /tmp/wfm-tests/operations/runtime/workflow-action-evidence-contract.test.cjs
COPY operations/runtime/workflow-action-evidence-bridge.cjs /tmp/wfm-tests/operations/runtime/workflow-action-evidence-bridge.cjs
COPY operations/runtime/workflow-action-evidence-bridge.test.cjs /tmp/wfm-tests/operations/runtime/workflow-action-evidence-bridge.test.cjs
COPY operations/runtime/decision-episode.cjs /tmp/wfm-tests/operations/runtime/decision-episode.cjs
COPY operations/runtime/decision-episode.test.cjs /tmp/wfm-tests/operations/runtime/decision-episode.test.cjs
COPY operations/runtime/customer-demand-intelligence.cjs /tmp/wfm-tests/operations/runtime/customer-demand-intelligence.cjs
COPY operations/runtime/customer-demand-intelligence.test.cjs /tmp/wfm-tests/operations/runtime/customer-demand-intelligence.test.cjs
COPY operations/runtime/absence-recovery-shadow.cjs /tmp/wfm-tests/operations/runtime/absence-recovery-shadow.cjs
COPY operations/runtime/absence-recovery-shadow.test.cjs /tmp/wfm-tests/operations/runtime/absence-recovery-shadow.test.cjs
COPY operations/runtime/demand-decision-service.cjs /tmp/wfm-tests/operations/runtime/demand-decision-service.cjs
COPY operations/runtime/demand-decision-service.test.cjs /tmp/wfm-tests/operations/runtime/demand-decision-service.test.cjs
COPY operations/runtime/decision-outcome-proof.cjs /tmp/wfm-tests/operations/runtime/decision-outcome-proof.cjs
COPY operations/runtime/decision-outcome-proof.test.cjs /tmp/wfm-tests/operations/runtime/decision-outcome-proof.test.cjs
COPY operations/runtime/realtime-event-service.cjs /tmp/wfm-tests/operations/runtime/realtime-event-service.cjs
COPY operations/runtime/realtime-event-service.test.cjs /tmp/wfm-tests/operations/runtime/realtime-event-service.test.cjs
COPY operations/runtime/autopilot-execution-engine.cjs /tmp/wfm-tests/operations/runtime/autopilot-execution-engine.cjs
COPY operations/runtime/autopilot-execution-engine.test.cjs /tmp/wfm-tests/operations/runtime/autopilot-execution-engine.test.cjs
COPY operations/runtime/t9-customer-guardian.cjs /tmp/wfm-tests/operations/runtime/t9-customer-guardian.cjs
COPY operations/runtime/t9-customer-guardian.test.cjs /tmp/wfm-tests/operations/runtime/t9-customer-guardian.test.cjs
COPY reporting/runtime/vector-reporting-service.cjs /tmp/wfm-tests/reporting/runtime/vector-reporting-service.cjs
COPY reporting/runtime/vector-reporting-service.test.cjs /tmp/wfm-tests/reporting/runtime/vector-reporting-service.test.cjs
COPY trust/runtime/vector-trust-spine.cjs /tmp/wfm-tests/trust/runtime/vector-trust-spine.cjs
COPY trust/runtime/vector-trust-spine.test.cjs /tmp/wfm-tests/trust/runtime/vector-trust-spine.test.cjs
COPY implementation/simulation/one-day-enterprise-simulation.mjs /tmp/wfm-tests/one-day-enterprise-simulation.mjs
RUN node /tmp/wfm-tests/one-day-enterprise-simulation.mjs --assert-target \
 && node --test \
      /tmp/wfm-tests/implementation/runtime/readiness-evidence-contract.test.cjs \
      /tmp/wfm-tests/implementation/runtime/readiness-evidence-wrapper.test.cjs \
      /tmp/wfm-tests/implementation/runtime/one-day-enterprise-engine.test.cjs \
      /tmp/wfm-tests/implementation/runtime/implementation-work-controller.test.cjs \
      /tmp/wfm-tests/implementation/runtime/implementation-active-controller.integration.test.cjs \
      /tmp/wfm-tests/implementation/runtime/configuration-inference-engine.test.cjs \
      /tmp/wfm-tests/implementation/runtime/implementation-digital-twin.test.cjs \
      /tmp/wfm-tests/implementation/runtime/tenant-environment-provisioner.test.cjs \
      /tmp/wfm-tests/learning/runtime/adaptive-learning-engine.test.cjs \
      /tmp/wfm-tests/learning/runtime/training-workflow-manifest.test.cjs \
      /tmp/wfm-tests/learning/runtime/training-twin.test.cjs \
      /tmp/wfm-tests/learning/runtime/training-scenario-engine.test.cjs \
      /tmp/wfm-tests/learning/runtime/training-delivery-service.test.cjs \
      /tmp/wfm-tests/learning/runtime/training-video-contract.test.cjs \
      /tmp/wfm-tests/learning/runtime/training-artifact-registry.test.cjs \
      /tmp/wfm-tests/learning/runtime/training-regeneration-planner.test.cjs \
      /tmp/wfm-tests/implementation/runtime/implementation-learning-integration.test.cjs \
      /tmp/wfm-tests/security/runtime/hosted-listen-guard.test.cjs \
      /tmp/wfm-tests/integration/runtime/autonomous-integration-hub.test.cjs \
      /tmp/wfm-tests/integration/runtime/directory-oauth-broker.test.cjs \
      /tmp/wfm-tests/integration/worker/directory-discovery-worker.test.cjs \
      /tmp/wfm-tests/operations/runtime/workflow-action-evidence-contract.test.cjs \
      /tmp/wfm-tests/operations/runtime/workflow-action-evidence-bridge.test.cjs \
      /tmp/wfm-tests/operations/runtime/workforce-lifecycle-guard.test.cjs \
      /tmp/wfm-tests/operations/runtime/manufacturing-scheduling-engine.test.cjs \
      /tmp/wfm-tests/operations/runtime/scheduling-intelligence-service.test.cjs \
      /tmp/wfm-tests/operations/runtime/manufacturing-demand-forecast.test.cjs \
      /tmp/wfm-tests/operations/runtime/schedule-attendance-reconciliation.test.cjs \
      /tmp/wfm-tests/operations/runtime/scheduling-forecast-reconciliation-service.test.cjs \
      /tmp/wfm-tests/operations/runtime/decision-episode.test.cjs \
      /tmp/wfm-tests/operations/runtime/customer-demand-intelligence.test.cjs \
      /tmp/wfm-tests/operations/runtime/absence-recovery-shadow.test.cjs \
      /tmp/wfm-tests/operations/runtime/demand-decision-service.test.cjs \
      /tmp/wfm-tests/operations/runtime/decision-outcome-proof.test.cjs \
      /tmp/wfm-tests/operations/runtime/realtime-event-service.test.cjs \
      /tmp/wfm-tests/operations/runtime/autopilot-execution-engine.test.cjs \
      /tmp/wfm-tests/reporting/runtime/vector-reporting-service.test.cjs \
 && rm -rf /tmp/wfm-tests

# Railway cloud-build admission: execute the exact 10,000-employee / 50-site
# configuration and independent payroll reconciliation proof without starting a server.
RUN WFM_PROOF_ONESHOT=true \
    WFM_CONFIG_ENGINE_PATH=/app/implementation-runtime/configuration-inference-engine.cjs \
    WFM_CONFIG_ENGINE_GIT_BLOB_SHA=d3688d27841a28d3b8801b7d4c63f254e8bf7edd \
    node /app/proof-runtime/cloud-scale-proof-runner.cjs

# Vector-only presentation composition.
# The active image has one presentation entry point only: vector-ui.css + vector-ui.js.
# Retired shell entry points are physically removed from the runtime image, not hidden.
COPY ux-overlay/ /tmp/wfm-ux-overlay/
COPY reporting/ui/ /tmp/wfm-reporting-ui/
COPY scripts/compose-vector-presentation.mjs /tmp/compose-vector-presentation.mjs
COPY scripts/prove-vector-built-asset-provenance.mjs /tmp/prove-vector-built-asset-provenance.mjs
RUN cp /app/public/factory-control-ui.css /tmp/vector-sealed-base.css \
 && node --check /app/security-runtime/bootstrap.cjs \
 && node --check /app/security-runtime/proof-runner-auth.cjs \
 && node --check /tmp/wfm-implementation-ui/implementation-journey.js \
 && node --check /tmp/wfm-ux-overlay/vector-shell.js \
 && node --check /tmp/wfm-ux-overlay/vector-realtime.js \
 && node --check /tmp/wfm-reporting-ui/vector-reporting-ui.js \
 && node --check /app/reporting-runtime/vector-reporting-service.cjs \
 && printf '/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */\n' > /app/public/vector-ui.css \
 && cat /app/public/factory-control-ui.css >> /app/public/vector-ui.css \
 && printf '\n/* WFM_ADAPTIVE_COACH_BEGIN */\n' >> /app/public/vector-ui.css \
 && cat /tmp/wfm-learning-ui/adaptive-coach.css >> /app/public/vector-ui.css \
 && printf '\n/* WFM_IMPLEMENTATION_JOURNEY_VERSION_D_BEGIN */\n' >> /app/public/vector-ui.css \
 && cat /tmp/wfm-implementation-ui/implementation-journey.css >> /app/public/vector-ui.css \
 && printf '\n/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */\n' >> /app/public/vector-ui.css \
 && cat /tmp/wfm-ux-overlay/vector-shell.css >> /app/public/vector-ui.css \
 && cat /tmp/wfm-ux-overlay/vector-workflows.css >> /app/public/vector-ui.css \
 && printf '\n/* VECTOR_DEMAND_DECISION_INTELLIGENCE_BEGIN */\n' >> /app/public/vector-ui.css \
 && cat /tmp/wfm-ux-overlay/vector-demand-intelligence.css >> /app/public/vector-ui.css \
 && printf '\n/* VECTOR_REPORTING_UI_V1 */\n' >> /app/public/vector-ui.css \
 && cat /tmp/wfm-reporting-ui/vector-reporting-ui.css >> /app/public/vector-ui.css \
 && cp /tmp/wfm-ux-overlay/vector-workflows.js /app/public/vector-workflows.js \
 && node --check /app/public/vector-workflows.js \
 && printf "'use strict';\n/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */\n" > /app/public/vector-ui.js \
 && printf '\n;/* WFM_ADAPTIVE_COACH_BEGIN */\n' >> /app/public/vector-ui.js \
 && cat /tmp/wfm-learning-ui/adaptive-coach.js >> /app/public/vector-ui.js \
 && printf '\n;/* WFM_IMPLEMENTATION_JOURNEY_VERSION_D_BEGIN */\n' >> /app/public/vector-ui.js \
 && cat /tmp/wfm-implementation-ui/implementation-journey.js >> /app/public/vector-ui.js \
 && printf '\n;/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */\n' >> /app/public/vector-ui.js \
 && cat /tmp/wfm-ux-overlay/vector-shell.js >> /app/public/vector-ui.js \
 && printf '\n;/* VECTOR_DEMAND_DECISION_INTELLIGENCE_BEGIN */\n' >> /app/public/vector-ui.js \
 && cat /tmp/wfm-ux-overlay/vector-demand-intelligence.js >> /app/public/vector-ui.js \
 && printf '\n;/* VECTOR_REALTIME_BEGIN */\n' >> /app/public/vector-ui.js \
 && cat /tmp/wfm-ux-overlay/vector-realtime.js >> /app/public/vector-ui.js \
 && printf '\n;/* VECTOR_REPORTING_UI_V1 */\n' >> /app/public/vector-ui.js \
 && cat /tmp/wfm-reporting-ui/vector-reporting-ui.js >> /app/public/vector-ui.js \
 && node --check /app/public/vector-ui.js \
 && node /tmp/compose-vector-presentation.mjs /app/public \
 && rm -f /app/public/factory-control-ui.js /app/public/factory-control-ui.css \
          /app/public/value-cockpit-ui.js \
          /app/public/value-cockpit-ui.css \
          /app/public/review-ui.js \
          /app/public/review-ui.css \
          /app/public/ui-evolution.css \
          /app/public/vector-shell.js \
 && node -e "const fs=require('fs');const h=fs.readFileSync('/app/public/index.html','utf8');const forbidden=['factory-control-ui.js','factory-control-ui.css','value-cockpit-ui.js','value-cockpit-ui.css','review-ui.js','review-ui.css','ui-evolution.css','vector-shell.js'];for(const name of forbidden){if(h.includes(name)||fs.existsSync('/app/public/'+name))throw new Error('Retired presentation remains: '+name)}const css=fs.readFileSync('/app/public/vector-ui.css','utf8');const js=fs.readFileSync('/app/public/vector-ui.js','utf8');if(!h.includes('/vector-ui.css')||!h.includes('/vector-ui.js')||!css.includes('VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1')||!js.includes('VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1')||!css.includes('VECTOR_REPORTING_UI_V1')||!js.includes('VECTOR_REPORTING_UI_V1'))throw new Error('Vector-only presentation admission failed');console.log('VECTOR_SINGLE_PRESENTATION_ENTRYPOINT=PASS');console.log('VECTOR_REPORTING_PRESENTATION_ADMISSION=PASS')" \
 && mkdir -p /tmp/vector-provenance/learning /tmp/vector-provenance/implementation /tmp/vector-provenance/reporting \
 && cp -r /tmp/wfm-ux-overlay /tmp/vector-provenance/ux-overlay \
 && cp -r /tmp/wfm-learning-ui /tmp/vector-provenance/learning/ui \
 && cp -r /tmp/wfm-implementation-ui /tmp/vector-provenance/implementation/ui \
 && cp -r /tmp/wfm-reporting-ui /tmp/vector-provenance/reporting/ui \
 && test -f /tmp/vector-provenance/reporting/ui/vector-reporting-ui.js \
 && test -f /tmp/vector-provenance/reporting/ui/vector-reporting-ui.css \
 && node /tmp/prove-vector-built-asset-provenance.mjs /tmp/vector-provenance /app/public /tmp/vector-sealed-base.css \
 && rm -rf /tmp/vector-provenance \
 && rm -f /tmp/vector-sealed-base.css /tmp/prove-vector-built-asset-provenance.mjs /tmp/compose-vector-presentation.mjs \
 && rm -rf /tmp/wfm-ux-overlay /tmp/wfm-reporting-ui /tmp/wfm-learning-ui /tmp/wfm-implementation-ui

# Consequential attendance admission against the exact final runtime. Reject an
# overlapping correction before mutation, then prove valid reconciliation/export.
COPY verification/vector-repair-20260921/attendance-overlap-regression.mjs /tmp/wfm-attendance-tests/attendance-overlap-regression.mjs
COPY verification/vector-repair-20260921/attendance-payroll-acceptance.mjs /tmp/wfm-attendance-tests/attendance-payroll-acceptance.mjs
COPY verification/vector-repair-20260921/attendance-guardrails.test.cjs /tmp/wfm-attendance-tests/attendance-guardrails.test.cjs
RUN WFM_RUNTIME=/app node --test /tmp/wfm-attendance-tests/attendance-guardrails.test.cjs \
 && WFM_RUNTIME=/app node /tmp/wfm-attendance-tests/attendance-overlap-regression.mjs \
 && WFM_RUNTIME=/app node /tmp/wfm-attendance-tests/attendance-payroll-acceptance.mjs \
 && rm -rf /tmp/wfm-attendance-tests

# The staged application is self-contained and uses Node built-ins only. Remove package
# managers from the final runtime so npm-bundled libraries are not an exposed attack surface.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
 && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
          /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx

# A compromised Node process must not be able to rewrite the application or its own guard.
# Runtime state lives outside /app (for staging, WFM_DB is an explicit writable path).
RUN mkdir -p /tmp/vector-local-data \
 && chown node:node /tmp/vector-local-data \
 && chmod 0700 /tmp/vector-local-data \
 && rm -rf /app/local-data \
 && ln -s /tmp/vector-local-data /app/local-data \
 && chown -R root:root /app \
 && find /app -type d -exec chmod 0555 {} + \
 && find /app -type f -exec chmod 0444 {} +

# Volume bootstrap is privileged only long enough to make /data writable by node.
# The application itself always executes as the unprivileged node user.
RUN printf '%s\n' \
 '#!/bin/sh' \
 'set -eu' \
 'if [ "${WFM_REQUIRE_DURABLE_STATE:-false}" = "true" ]; then' \
 '  [ "${RAILWAY_VOLUME_MOUNT_PATH:-}" = "/data" ] || { echo "VECTOR_VOLUME_CONTRACT=FAIL mount=${RAILWAY_VOLUME_MOUNT_PATH:-missing}" >&2; exit 73; }' \
 '  chown node:node /data' \
 '  chmod 0700 /data' \
 '  gosu node /usr/bin/test -w /data || { echo "VECTOR_VOLUME_WRITABLE=FAIL" >&2; exit 74; }' \
 '  echo "VECTOR_VOLUME_WRITABLE=PASS mount=/data owner=node"' \
 'fi' \
 'echo "VECTOR_RUNTIME_UID_DROP=PASS target=node"' \
 'exec gosu node "$@"' \
 > /usr/local/bin/vector-entrypoint.sh \
 && chmod 0555 /usr/local/bin/vector-entrypoint.sh

USER root
ENTRYPOINT ["/usr/local/bin/vector-entrypoint.sh"]
ENV NODE_ENV=staging
ENV WFM_IDENTITY_SURVIVAL_GUARD=enforce
EXPOSE 3000
CMD ["node","security-runtime/bootstrap.cjs"]

# VECTOR_CANONICAL_REDEPLOY_20260920
