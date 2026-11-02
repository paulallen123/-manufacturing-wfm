# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
# Discarded Railway build stage: prove T0-T4 zero-engineer support and bounded recovery
# against the exact candidate sources. Nothing from this stage is copied into runtime.
FROM node:22.23.2-bookworm-slim@sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96 AS autonomy-proof
ARG RAILWAY_GIT_COMMIT_SHA
WORKDIR /proof
COPY . ./
RUN node integration/runtime/nango-credential-provider.test.cjs \
 && node integration/runtime/nango-metadata-broker.test.cjs \
 && node scripts/nango-metadata-wiring.test.cjs \
 && node integration/runtime/provider-metadata-review.test.cjs \
 && node ux-overlay/vector-provider-metadata.test.cjs
RUN node --test integration/runtime/gusto-webhook-receiver.test.mjs
RUN node --test verification/provider-recovery-correction/autonomy-correction/tests/independent-authority-restore.test.cjs verification/provider-recovery-correction/autonomy-correction/tests/independent-historical-acceptance.test.cjs verification/provider-recovery-correction/autonomy-correction/tests/authority-witness-loss.test.cjs
RUN node --test verification/provider-recovery-correction/autonomy-correction/tests/independent-detector-outage.test.cjs
RUN node --test implementation/ui/implementation-observer.test.cjs
RUN node --test implementation/ui/workspace-setup.test.cjs implementation/runtime/workspace-setup.test.cjs implementation/runtime/customer-workspace.test.cjs implementation/runtime/organisation-access-setup.test.cjs
RUN node --test implementation/runtime/setup-only-policy.test.cjs implementation/runtime/clean-customer-state.test.cjs implementation/runtime/setup-customer-state.test.cjs
RUN node --test implementation/runtime/customer-workspace-adoption.test.cjs implementation/runtime/one-day-enterprise-engine.test.cjs verification/first-use-regressions-20261012/deferred-connections.test.cjs
# Admit the cumulative setup-containment, recovery and advisory-helper regressions.
RUN node --test --test-concurrency=1 verification/vector-v014-setup-containment/heldout.test.cjs integration/runtime/gusto-http-process-recovery.test.cjs operations/runtime/training-shift-collision.test.cjs operations/runtime/maintenance-permit-evidence.test.cjs
RUN node --test scripts/patch-payroll-money.test.mjs tests/payroll-money-factor-admission.test.cjs resilience/support-selfhelp.test.cjs resilience/support-selfhelp-service.test.cjs resilience/support-selfhelp-root.test.cjs ux-overlay/vector-help.test.cjs ux-overlay/vector-help-root.test.cjs
RUN node --test ux-overlay/vector-three-min.test.cjs ux-overlay/vector-gusto.test.cjs ux-overlay/vector-staffology-controls.test.cjs ux-overlay/vector-settings-navigation.test.cjs
RUN --mount=type=secret,id=proxy_ca \
 if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
 npm ci --prefix security/runtime --omit=dev --ignore-scripts --no-audit --no-fund \
 && node --test security/runtime/federated-auth.test.cjs security/runtime/federated-session-boundary.test.cjs security/runtime/federated-ui.test.cjs security/runtime/passkey-auth.test.cjs security/runtime/sign-workspace-journey.test.cjs security/runtime/passkey-session-ui.test.cjs security/runtime/bootstrap-passkey-assets.test.cjs
# Recovery help is part of the passkey boundary, not an optional navigation fixture.
RUN node --test security/runtime/owner-access-recovery.test.cjs security/runtime/owner-access-recovery-help.test.cjs
RUN node --test operations/runtime/workflow-action-evidence-sources.test.cjs scripts/workflow-action-evidence.composed.test.mjs
RUN node --test scripts/three-min-feed.composed.test.mjs
RUN node --test integrations/staffology/configured-site-authority.test.cjs integrations/staffology/configured-site-source-writer.test.cjs integrations/staffology/employee-import-previews.test.cjs integrations/staffology/employee-preview-consumer.test.cjs scripts/staffology-preview-route.test.mjs scripts/staffology-preview-active-route.test.mjs
RUN node --test reporting/runtime/vector-report-interchange.test.cjs scripts/attendance-correction-proof-oracle.test.mjs integration-fabric/runtime/workforce-population-reconciliation.test.mjs implementation/runtime/clean-customer-state.test.cjs operations/runtime/manufacturing-scheduling-engine.test.cjs test/frontier/cash-to-capacity-outcome.test.mjs operations/runtime/capacity-rescue-shadow.current-base.test.cjs operations/runtime/capacity-rescue-frozen-simulation.test.cjs scripts/operational-period-ingestion-proof-oracle.test.mjs integration-fabric/runtime/workforce-constraint-evidence-bridge.test.mjs frontier/water-resilience-orchestration/water-resilience-orchestration.test.mjs frontier/controlled-environment-flow/intervention-transition-ledger.test.mjs adaptive-intelligence/engine.test.mjs adaptive-intelligence/durable-outcome-ledger.test.mjs adaptive-intelligence/durable-outcome-ledger-heldouts.test.mjs adaptive-intelligence/durable-outcome-ledger-inert-input.test.mjs adaptive-intelligence/durable-incident-memory.test.mjs adaptive-intelligence/durable-incident-memory-freshness.test.mjs adaptive-intelligence/durable-incident-memory-process.test.mjs scripts/dated-leave-balance.current-base.test.cjs integrations/staffology/configured-site-import.test.cjs learning/runtime/training-quality-gate.test.cjs operations/runtime/workflow-action-evidence-contract.test.cjs operations/runtime/workflow-action-evidence-bridge.test.cjs operations/runtime/quality-workforce-shadow.test.cjs operations/runtime/hybrid-resource-shadow.test.cjs
# Exact Staffology review admission: exercise the reviewed bridge, persisted employee
# readback/restart guard, tenant denial, audit immutability and runtime composition.
RUN node --test verification/provider-recovery-correction/autonomy-correction/tests/durable-autonomy.test.cjs verification/provider-recovery-correction/autonomy-correction/tests/independent-support-durability.test.cjs verification/provider-recovery-correction/autonomy-correction/tests/support-evidence-transaction.test.cjs verification/provider-recovery-correction/autonomy-correction/tests/independent-durable-autonomy.test.cjs verification/provider-recovery-correction/autonomy-correction/tests/independent-verification-signature.test.cjs verification/provider-recovery-correction/autonomy-correction/tests/authority-transaction-boundary.test.cjs verification/provider-recovery-correction/autonomy-correction/tests/independent-authority-isolation.test.cjs verification/provider-recovery-correction/autonomy-correction/tests/independent-retained-receipt-integrity.test.cjs verification/provider-recovery-correction/autonomy-correction/tests/retained-receipt-boundary.test.cjs verification/provider-recovery-correction/autonomy-correction/tests/independent-signed-tier-recovery.test.cjs verification/provider-recovery-correction/autonomy-correction/tests/retained-tier-integrity.test.cjs
RUN VECTOR_SEALED_PROOF_ROOT=/proof node --test verification/provider-recovery-correction/tests/*.test.cjs \
 && node scripts/validate-canary-rollback-controller.mjs
RUN node scripts/compose-vector-local-runtime.mjs /proof/staffology-full-runtime \
 && VECTOR_SETUP_POLICY_RUNTIME_ROOT=/proof/staffology-full-runtime/implementation-runtime node --test implementation/runtime/setup-only-policy.test.cjs implementation/runtime/customer-workspace.test.cjs \
 && mkdir -p /proof/staffology-private-artifacts \
 && cp /proof/staffology-full-runtime/STAFFOLOGY_ASSEMBLY.json /proof/staffology-full-runtime/LOCAL_PROOF_PROVENANCE.json /proof/staffology-private-artifacts/ \
 && printf '%s\n' "$RAILWAY_GIT_COMMIT_SHA" > /proof/staffology-private-artifacts/source-sha.txt \
 && (set +e; printf 'STAFFOLOGY_ADMISSION stage=start\n' >&2; CANONICAL_SOURCE_DIR=/proof \
    WFM_RUNTIME=/proof/staffology-full-runtime \
    STAFFOLOGY_RUNTIME_MODE=full \
    WFM_BUILD_SOURCE_SHA="$RAILWAY_GIT_COMMIT_SHA" \
    STAFFOLOGY_PRIVATE_EVIDENCE_DIR=/proof/staffology-private-artifacts \
    node --test --test-concurrency=1 \
      --test-reporter=tap --test-reporter-destination=/proof/staffology-private-artifacts/staffology-full.tap \
      --test-reporter=./scripts/staffology-build-diagnostics.cjs --test-reporter-destination=stdout \
      integrations/staffology/*.test.cjs \
      integrations/staffology/independent/succession-regressions.test.cjs \
      integrations/staffology/independent/current-authority-recovery-held-out.test.cjs \
      integrations/staffology/independent/docker-admission-contract.test.cjs \
      integrations/staffology/independent/generated-provider-preload.test.cjs \
      integrations/staffology/independent/full-http-employee-journey.test.cjs \
      3>&2 > /proof/staffology-private-artifacts/staffology-runner-private.log 2>&1; status=$?; \
    printf 'STAFFOLOGY_ADMISSION stage=exit status=%s\n' "$status" >&2; exit "$status") \
 && node --test scripts/compose-vector-local-runtime.contract.test.cjs scripts/workspace-compiler-composition.test.cjs verification/first-use-regressions-20261012/existing-output-compiler.test.cjs
RUN WFM_SUPPORT_HTTP_RUNTIME=/proof/staffology-full-runtime \
    WFM_SUPPORT_HTTP_HARNESS=/proof/verification/vector-repair-20260921/attendance-runtime-harness.mjs \
    node --test verification/provider-recovery-correction/tests/support-recovery-http.test.cjs
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
 && node --test scripts/validate-staffology-canonical-assembly.test.mjs scripts/runtime-artifact-manifest.test.mjs scripts/proof-access-preflight.test.cjs operations/runtime/order-start-variance.test.cjs operations/runtime/order-start-variance-inert.test.cjs operations/runtime/order-start-variance-inert-heldouts.test.cjs operations/runtime/order-start-variance-service.test.cjs operations/runtime/order-start-variance-bootstrap.test.cjs operations/runtime/production-output-gap.test.cjs operations/runtime/order-material-availability.test.cjs operations/runtime/factory-assessment-scenarios-service.test.cjs operations/runtime/factory-assessment-scenarios-bootstrap.test.cjs resilience/research-convergence-theory-simulator.test.cjs policy/runtime/country-policy-pack-registry.test.cjs policy/runtime/jurisdiction-policy-graph.test.cjs policy/runtime/global-site-policy-preflight.test.cjs policy/runtime/authoritative-policy-source-registry.test.cjs policy/runtime/regulatory-change-candidate.test.cjs policy/runtime/v026-tenant-policy-scope.test.cjs security/runtime/runtime-identity.test.cjs \
 && node scripts/validate-product-factory.mjs \
 && node scripts/prove-adaptive-intelligence-engine.mjs \
 && node scripts/validate-self-evolution.mjs \
 && node scripts/validate-vector-only-ui.mjs \
 && node --check learning/video-worker/runner.mjs \
 && node integration-fabric/scripts/validate.mjs \
 && node scripts/run-critical-attendance-assault.mjs \
 && node --test tests/critical-proof-gates.test.cjs tests/runtime-process-uid.test.cjs tests/vector-payroll-release-proof.test.mjs tests/vector-consolidation.test.cjs tests/vector-runtime-packaging.test.cjs tests/vector-http-verifier.test.cjs tests/vector-release-proof-binding.test.cjs tests/vector-source-guard.test.cjs ux-overlay/vector-action-queue.test.cjs ux-overlay/vector-civil-date.test.cjs ux-overlay/vector-leave-balance-display.test.cjs ux-overlay/vector-demand-intelligence.test.cjs ux-overlay/vector-workflows.test.cjs ux-overlay/vector-scheduling-simplicity-contract.test.cjs operations/runtime/tenant-calendar.test.cjs operations/runtime/workflow-action-evidence-contract.test.cjs operations/runtime/manufacturing-scheduling-engine.test.cjs operations/runtime/scheduling-intelligence-service.test.cjs operations/runtime/manufacturing-demand-forecast.test.cjs operations/runtime/schedule-attendance-reconciliation.test.cjs operations/runtime/scheduling-forecast-reconciliation-service.test.cjs operations/runtime/decision-episode.test.cjs operations/runtime/customer-demand-intelligence.test.cjs operations/runtime/absence-recovery-shadow.test.cjs operations/runtime/demand-decision-service.test.cjs operations/runtime/decision-outcome-proof.test.cjs scripts/compose-vector-presentation.regression.test.mjs scripts/patch-customer-runtime-assets.test.mjs scripts/sanitize-customer-public-bundle.test.mjs scripts/validate-customer-public-bundle.test.mjs scripts/signed-role-harness-contract.test.mjs scripts/prove-vector-built-asset-provenance.test.mjs test/frontier/cash-to-capacity-engine.test.mjs test/frontier/cash-to-capacity-evidence.test.mjs test/frontier/cash-to-capacity-decision.test.mjs test/frontier/cash-to-capacity-outcome.test.mjs test/frontier/energy-bill-evidence.test.mjs test/frontier/energy-coordination-sensitivity.test.mjs test/frontier/energy-data-reconciliation.test.mjs test/frontier/energy-flexibility.test.mjs test/frontier/energy-input-hardening.test.mjs test/frontier/energy-profile-benchmark.test.mjs test/frontier/energy-profile-binding.test.mjs $(find test/frontier -maxdepth 1 -name 'agency-*.test.mjs' ! -name '*postgres*' -print) $(find clocking-security-v2 -maxdepth 1 -name '*.test.mjs' ! -name '*soak*' ! -name '*live*' ! -name '*enterprise-scale*' -print) integration-fabric/runtime/*.test.mjs operations/runtime/realtime-event-service.test.cjs operations/runtime/autopilot-execution-engine.test.cjs operations/runtime/autopilot-expiry-readback.regression.test.cjs operations/runtime/autopilot-ingress.security.test.cjs operations/runtime/autopilot-replay.regression.test.cjs implementation/runtime/zero-touch-customer-factory.test.cjs implementation/runtime/zero-touch-customer-factory.boundaries.test.cjs implementation/runtime/implementation-work-controller.test.cjs implementation/runtime/implementation-work-fencing.test.cjs implementation/runtime/implementation-active-controller.integration.test.cjs operations/runtime/t9-customer-guardian.test.cjs reporting/runtime/vector-reporting-service.test.cjs reporting/ui/vector-reporting-ui.test.cjs reporting/ui/vector-reporting-export-safety.test.cjs reporting/ui/vector-reporting-export-heldout.test.cjs reporting/ui/vector-reporting-multirow-export.test.cjs reporting/ui/vector-reporting-mapping-integrity.test.cjs reporting/ui/vector-reporting-lifecycle.test.cjs trust/runtime/vector-trust-spine.test.cjs security/runtime/identity-survival-guard.test.cjs security/runtime/proof-runner-auth.test.cjs security/runtime/bootstrap-proof-runner-wiring.test.cjs security/runtime/owner-access-recovery.test.cjs security/runtime/durable-state-guard.test.cjs learning/runtime/training-workflow-manifest.test.cjs learning/runtime/training-twin.test.cjs learning/runtime/training-scenario-engine.test.cjs learning/runtime/training-delivery-service.test.cjs learning/runtime/training-video-contract.test.cjs learning/runtime/training-artifact-registry.test.cjs learning/runtime/training-regeneration-planner.test.cjs \
 && node scripts/run-local-vector-proof.mjs /proof-vector-integrated \
 && cat /proof-vector-integrated/summary.json \
 && rm -f scripts/validate-deployment.mjs \
 && node scripts/run-portable-autonomy-proof.mjs --strict-runtime

# Private proof export target. CircleCI extracts this discarded-stage receipt without
# placing employee/provider evidence in the runnable image.
FROM scratch AS staffology-proof-evidence
COPY --from=autonomy-proof /proof/staffology-private-artifacts/ /

# Customer-proof staging build: sealed 0.6.76 runtime
FROM node:22.23.2-bookworm-slim@sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96 AS hardened-runtime
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
COPY ux-overlay/kiosk-client.js /workspace/ux-overlay/
COPY integrations/staffology/staffology-adapter.cjs integrations/staffology/canonical-runtime-bridge.cjs integrations/staffology/canonical-production-boundaries.cjs integrations/staffology/canonical-operations.cjs integrations/staffology/configured-site-authority.cjs integrations/staffology/employee-import-previews.cjs /workspace/integrations/staffology/
COPY verification/provider-recovery-correction/operations/runtime/ /workspace/verification/provider-recovery-correction/operations/runtime/
COPY verification/provider-recovery-correction/ui/ /workspace/verification/provider-recovery-correction/ui/
COPY operations/runtime/tenant-calendar.cjs operations/runtime/workflow-action-evidence-contract.cjs operations/runtime/workflow-action-evidence-bridge.cjs operations/runtime/workflow-action-evidence-sources.cjs operations/runtime/payroll-money.cjs /workspace/operations/runtime/
COPY scripts/compose-vector-local-runtime.mjs scripts/patch-payroll-money.mjs scripts/patch-workspace-compiler.mjs /workspace/scripts/
COPY integration/runtime/nango-credential-provider.cjs /workspace/integration/runtime/
COPY integration/runtime/provider-metadata-review.cjs /workspace/integration/runtime/
RUN node /workspace/scripts/compose-vector-local-runtime.mjs /app \
 && rm -rf /workspace
COPY scripts/retire-legacy-presentation.mjs scripts/harden-attendance-integrity.mjs scripts/patch-customer-runtime-assets.mjs /tmp/
RUN node /tmp/retire-legacy-presentation.mjs /app/public \
 && node /tmp/harden-attendance-integrity.mjs /app/public \
 && node /tmp/patch-customer-runtime-assets.mjs /app/public \
 && node -e "const fs=require('fs');const source=fs.readFileSync('/app/public/onboarding-ui.js','utf8');const forbidden=/development only|development build|Jordan New|jordan\\.new@example\\.test/i.exec(source);if(forbidden){const at=forbidden.index,snippet=source.slice(Math.max(0,at-120),Math.min(source.length,at+240)).replace(/[\\r\\n]+/g,' ');throw new Error('ONBOARDING_CUSTOMER_SAMPLE_COPY_REMAINS:'+forbidden[0]+':'+snippet)}if(!source.includes('VECTOR_CUSTOMER_ONBOARDING_COPY_V2'))throw new Error('ONBOARDING_CUSTOMER_SAMPLE_COPY_MARKER_MISSING');console.log('ONBOARDING_CUSTOMER_SAMPLE_COPY_GUARD=PASS')" \
 && rm -f /tmp/retire-legacy-presentation.mjs /tmp/harden-attendance-integrity.mjs /tmp/patch-customer-runtime-assets.mjs

# Resource-side identity survival overlay. Keep the original sealed artifact intact and
# add the defence overlay as a separately reviewable layer.
RUN mkdir -p /app/security-runtime
COPY security/runtime/package.json security/runtime/package-lock.json /app/security-runtime/
RUN --mount=type=secret,id=proxy_ca \
 if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
 npm ci --prefix /app/security-runtime --omit=dev --ignore-scripts --no-audit --no-fund
COPY security/runtime/passkey-schema.cjs security/runtime/passkey-auth.cjs security/runtime/federated-auth.cjs security/runtime/federated-ui.js /app/security-runtime/
COPY security/runtime/passkey-entry.html security/runtime/passkey-ui.js security/runtime/passkey-ui.css /app/security-runtime/
COPY security/runtime/passkey-session-ui.js /app/public/passkey-session-ui.js
COPY security/runtime/identity-survival-guard.cjs security/runtime/proof-runner-auth.cjs security/runtime/hosted-listen-guard.cjs security/runtime/hosted-application-user-guard.cjs security/runtime/bootstrap.cjs security/runtime/owner-access-recovery.cjs security/runtime/durable-state-guard.cjs security/runtime/runtime-identity.cjs security/runtime/retired-presentation.cjs /app/security-runtime/
# Test the exact installed recovery module; keep the fixture outside the application.
COPY security/runtime/owner-access-recovery-help.test.cjs /tmp/wfm-recovery-help/owner-access-recovery-help.test.cjs
RUN WFM_RECOVERY_MODULE=/app/security-runtime/owner-access-recovery.cjs node --test /tmp/wfm-recovery-help/owner-access-recovery-help.test.cjs \
 && rm -rf /tmp/wfm-recovery-help
RUN node -e "const fs=require('fs');const p='/app/public/index.html';let s=fs.readFileSync(p,'utf8');s=s.replace('</head>','<script src=\"/passkey-session-ui.js\" defer></script></head>');fs.writeFileSync(p,s);" \
 && node --check /app/security-runtime/passkey-auth.cjs

# Railway supplies the triggering Git SHA to builds and deployments. Seal the build-time
# value into the read-only image so runtime proof cannot be manufactured by echoing the
# independently configured expected SHA.
RUN node -e "const fs=require('fs');const sha=String(process.env.RAILWAY_GIT_COMMIT_SHA||'').trim().toLowerCase();if(!/^[0-9a-f]{40}$/.test(sha))throw new Error('WFM_BUILD_SOURCE_SHA_INVALID');fs.writeFileSync('/app/.wfm-build-source-sha',sha+'\\n',{mode:0o444});console.log('WFM_BUILD_SOURCE_SHA=SEALED')"

# Autonomous integration fabric. The control plane is separately reviewable and
# uses only Node built-ins plus the existing per-tenant SQLite runtime.
RUN mkdir -p /app/integration-runtime
COPY integration/runtime/three-min-feed.cjs integration/runtime/autonomous-integration-hub.cjs integration/runtime/gusto-company-connector.cjs integration/runtime/gusto-oauth-landing.cjs integration/runtime/gusto-webhook-receiver.mjs integration/runtime/gusto-webhook-preload.mjs /app/integration-runtime/
RUN mkdir -p /app/integration-fabric-runtime /app/integration-fabric-catalog
COPY integration-fabric/runtime/api-version-routing.mjs integration-fabric/runtime/batch-reconciliation.mjs integration-fabric/runtime/connection-test-plan.mjs integration-fabric/runtime/connector-registry.mjs integration-fabric/runtime/dataset-coverage.mjs integration-fabric/runtime/evidence-provenance.mjs integration-fabric/runtime/governed-read-projection-registry.mjs integration-fabric/runtime/governed-read-projection.mjs integration-fabric/runtime/privileged-bootstrap-guard.mjs integration-fabric/runtime/regional-route-authority.mjs integration-fabric/runtime/rpc-read-authority.mjs integration-fabric/runtime/schema-negotiation.mjs integration-fabric/runtime/scope-partition.mjs integration-fabric/runtime/semantic-envelope.mjs integration-fabric/runtime/session-broker.mjs integration-fabric/runtime/session-read-authority.mjs integration-fabric/runtime/static-credential-authority.mjs /app/integration-fabric-runtime/
COPY integration-fabric/systems.json integration-fabric/protocol-profiles.json integration-fabric/opportunity-profiles.json integration-fabric/openapi.yaml /app/integration-fabric-catalog/

# Preserve the Integration Fabric source-relative module layout as a runtime-verifiable tree.
# Existing compatibility copies above remain in place until every consumer is migrated.
RUN mkdir -p /app/integration-fabric/runtime /app/integration-fabric/scripts /app/integration-fabric/research-overlays
COPY integration-fabric/runtime/ /app/integration-fabric/runtime/
COPY integration-fabric/scripts/load-catalog.mjs /app/integration-fabric/scripts/load-catalog.mjs
COPY integration-fabric/systems.json integration-fabric/systems-research.json /app/integration-fabric/
COPY integration-fabric/research-overlays/ /app/integration-fabric/research-overlays/
COPY integration-fabric/protocol-profiles.json integration-fabric/opportunity-profiles.json integration-fabric/openapi.yaml /app/integration-fabric/

# One-day implementation and adaptive learning overlays. These remain additive,
# tenant-scoped, fail-closed control planes using Node built-ins and the existing SQLite state.
RUN mkdir -p /app/implementation-runtime /app/learning-runtime /app/operations-runtime /tmp/wfm-learning-ui /tmp/wfm-implementation-ui
COPY implementation/runtime/workspace-setup.cjs implementation/runtime/organisation-access-setup.cjs implementation/runtime/customer-workspace.cjs implementation/runtime/setup-only-policy.cjs implementation/runtime/organisation-access-lifecycle.cjs /app/implementation-runtime/
COPY scripts/patch-workspace-compiler.mjs /tmp/patch-workspace-compiler.mjs
RUN node /tmp/patch-workspace-compiler.mjs /app/lib/configuration-compiler.cjs && rm /tmp/patch-workspace-compiler.mjs
COPY implementation/runtime/one-day-enterprise-engine.cjs implementation/runtime/one-day-enterprise-engine-core.cjs implementation/runtime/agents-api-adapter.cjs implementation/runtime/agents-api-bootstrap-route.cjs implementation/runtime/implementation-work-controller.cjs implementation/runtime/readiness-evidence-contract.cjs implementation/runtime/configuration-inference-engine.cjs implementation/runtime/implementation-digital-twin.cjs implementation/runtime/tenant-environment-provisioner.cjs /app/implementation-runtime/
COPY learning/runtime/adaptive-learning-engine.cjs learning/runtime/training-workflow-manifest.cjs learning/runtime/training-twin.cjs learning/runtime/training-scenario-engine.cjs learning/runtime/training-delivery-service.cjs learning/runtime/training-video-contract.cjs learning/runtime/training-artifact-registry.cjs learning/runtime/training-regeneration-planner.cjs /app/learning-runtime/
RUN mkdir -p /app/learning-runtime/evolution /app/product-factory/features
COPY adaptive-intelligence/engine.mjs /app/learning-runtime/evolution/engine.mjs
COPY product-factory/adaptive-intelligence-manifest.json product-factory/learning-receipt-schema.json /app/product-factory/
COPY product-factory/features/self-evolving-customer-intelligence.json product-factory/features/verified-value-ledger.json /app/product-factory/features/
COPY operations/runtime/workforce-lifecycle-guard.cjs /app/operations-runtime/workforce-lifecycle-core.cjs
COPY operations/runtime/tenant-calendar.cjs operations/runtime/workflow-action-evidence-contract.cjs operations/runtime/workflow-action-evidence-bridge.cjs operations/runtime/workflow-action-evidence-sources.cjs operations/runtime/decision-episode.cjs operations/runtime/manufacturing-scheduling-engine.cjs operations/runtime/scheduling-intelligence-service.cjs operations/runtime/scheduling-authority.cjs operations/runtime/manufacturing-demand-forecast.cjs operations/runtime/schedule-attendance-reconciliation.cjs operations/runtime/customer-demand-intelligence.cjs operations/runtime/absence-recovery-shadow.cjs operations/runtime/demand-decision-service.cjs operations/runtime/decision-outcome-proof.cjs operations/runtime/realtime-event-service.cjs operations/runtime/autopilot-execution-engine.cjs operations/runtime/t9-customer-guardian.cjs operations/runtime/order-start-variance.cjs operations/runtime/production-output-gap.cjs operations/runtime/order-material-availability.cjs /app/operations-runtime/
RUN mkdir -p /app/reporting-runtime /app/policy-runtime
COPY reporting/runtime/vector-reporting-service.cjs /app/reporting-runtime/vector-reporting-service.cjs
COPY resilience/support-selfhelp.cjs resilience/support-selfhelp-service.cjs /app/support-runtime/
COPY policy/runtime/country-policy-pack-registry.cjs policy/runtime/jurisdiction-policy-graph.cjs policy/runtime/global-site-policy-preflight.cjs policy/runtime/authoritative-policy-source-registry.cjs policy/runtime/regulatory-change-candidate.cjs /app/policy-runtime/
RUN mkdir -p /app/trust-runtime
COPY trust/runtime/vector-trust-spine.cjs /app/trust-runtime/vector-trust-spine.cjs
COPY src/frontier/cash-to-capacity-engine.mjs src/frontier/cash-to-capacity-evidence.mjs src/frontier/cash-to-capacity-decision.mjs src/frontier/cash-to-capacity-outcome.mjs src/frontier/energy-bill-evidence.mjs src/frontier/energy-data-reconciliation.mjs src/frontier/energy-flexibility.mjs src/frontier/energy-input-hardening.mjs src/frontier/energy-profile-benchmark.mjs src/frontier/energy-profile-binding.mjs /app/operations-runtime/
RUN mkdir -p /app/operations-runtime/agency /app/operations-runtime/attendance
COPY src/frontier/agency-*.mjs /app/operations-runtime/agency/
COPY clocking-security-v2/access-control-evidence.mjs clocking-security-v2/access-feed-supervisor.mjs clocking-security-v2/access-onboarding-autopilot.mjs clocking-security-v2/access-push-adapters.mjs clocking-security-v2/attendance-certification.mjs clocking-security-v2/attendance-coverage-assurance.mjs clocking-security-v2/attendance-coverage-planner.mjs clocking-security-v2/attendance-payroll-gate.mjs clocking-security-v2/attendance-release-control.mjs clocking-security-v2/attendance-source-supervisor.mjs clocking-security-v2/durable-attendance-journal.mjs clocking-security-v2/durable-source-supervisor.mjs clocking-security-v2/invisible-attendance-engine.mjs clocking-security-v2/signed-rollback-anchor.mjs clocking-security-v2/sqlite-attendance-runtime.mjs clocking-security-v2/sqlite-attendance-worker.mjs clocking-security-v2/telemetry-continuity-guard.mjs clocking-security-v2/trust-root-recovery-controller.mjs clocking-security-v2/trust-root-recovery.mjs clocking-security-v2/wifi-evidence-adapters.mjs clocking-security-v2/windows-wef-evidence.mjs /app/operations-runtime/attendance/
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
COPY implementation/runtime/workspace-setup.cjs implementation/runtime/organisation-access-setup.cjs implementation/runtime/customer-workspace.cjs implementation/runtime/setup-only-policy.cjs implementation/runtime/organisation-access-lifecycle.cjs /tmp/wfm-tests/implementation/runtime/
COPY implementation/runtime/setup-only-policy.test.cjs implementation/runtime/customer-workspace.test.cjs /tmp/wfm-tests/implementation/runtime/
COPY implementation/runtime/test-support/sealed-compiler.cjs /tmp/wfm-tests/implementation/runtime/test-support/sealed-compiler.cjs
COPY implementation/runtime/one-day-enterprise-engine.cjs implementation/runtime/one-day-enterprise-engine-core.cjs implementation/runtime/agents-api-adapter.cjs implementation/runtime/agents-api-adapter.test.cjs implementation/runtime/agents-api-bootstrap-route.cjs implementation/runtime/agents-api-bootstrap-route.test.cjs implementation/runtime/implementation-work-controller.cjs implementation/runtime/implementation-work-controller.test.cjs implementation/runtime/implementation-work-fencing.test.cjs implementation/runtime/implementation-active-controller.integration.test.cjs implementation/runtime/readiness-evidence-contract.cjs implementation/runtime/readiness-evidence-contract.test.cjs implementation/runtime/readiness-evidence-wrapper.test.cjs implementation/runtime/configuration-inference-engine.cjs implementation/runtime/implementation-digital-twin.cjs implementation/runtime/implementation-digital-twin.test.cjs implementation/runtime/tenant-environment-provisioner.cjs implementation/runtime/tenant-environment-provisioner.test.cjs implementation/runtime/one-day-enterprise-engine.test.cjs implementation/runtime/configuration-inference-engine.test.cjs implementation/runtime/implementation-learning-integration.test.cjs /tmp/wfm-tests/implementation/runtime/
COPY learning/runtime/adaptive-learning-engine.cjs learning/runtime/adaptive-learning-engine.test.cjs learning/runtime/training-workflow-manifest.cjs learning/runtime/training-workflow-manifest.test.cjs learning/runtime/training-twin.cjs learning/runtime/training-twin.test.cjs learning/runtime/training-scenario-engine.cjs learning/runtime/training-scenario-engine.test.cjs learning/runtime/training-delivery-service.cjs learning/runtime/training-delivery-service.test.cjs learning/runtime/training-video-contract.cjs learning/runtime/training-video-contract.test.cjs learning/runtime/training-artifact-registry.cjs learning/runtime/training-artifact-registry.test.cjs learning/runtime/training-regeneration-planner.cjs learning/runtime/training-regeneration-planner.test.cjs /tmp/wfm-tests/learning/runtime/
COPY operations/runtime/decision-episode.cjs operations/runtime/capacity-rescue-shadow.cjs operations/runtime/capacity-rescue-frozen-simulation.cjs operations/runtime/capacity-rescue-frozen-simulation.test.cjs operations/runtime/manufacturing-scheduling-engine.cjs operations/runtime/manufacturing-scheduling-engine.test.cjs operations/runtime/manufacturing-demand-forecast.cjs operations/runtime/manufacturing-demand-forecast.test.cjs operations/runtime/schedule-attendance-reconciliation.cjs operations/runtime/schedule-attendance-reconciliation.test.cjs operations/runtime/scheduling-intelligence-service.cjs operations/runtime/scheduling-authority.cjs operations/runtime/scheduling-authority.test.cjs operations/runtime/scheduling-intelligence-service.test.cjs operations/runtime/scheduling-forecast-reconciliation-service.test.cjs operations/runtime/order-start-variance.cjs operations/runtime/order-start-variance-service.test.cjs operations/runtime/order-start-variance-bootstrap.test.cjs operations/runtime/order-start-variance.test.cjs operations/runtime/order-start-variance-inert.test.cjs operations/runtime/order-start-variance-inert-heldouts.test.cjs operations/runtime/production-output-gap.cjs operations/runtime/production-output-gap.test.cjs operations/runtime/order-material-availability.cjs operations/runtime/order-material-availability.test.cjs operations/runtime/factory-assessment-scenarios-service.test.cjs operations/runtime/factory-assessment-scenarios-bootstrap.test.cjs /tmp/wfm-tests/operations/runtime/
COPY security/runtime/hosted-listen-guard.cjs security/runtime/hosted-listen-guard.test.cjs security/runtime/hosted-application-user-guard.cjs security/runtime/hosted-application-user-guard.test.cjs /tmp/wfm-tests/security/runtime/
COPY integration/runtime/three-min-feed.cjs integration/runtime/three-min-feed.test.cjs integration/runtime/autonomous-integration-hub.cjs integration/runtime/autonomous-integration-hub.test.cjs integration/runtime/autonomous-integration-hub.identity-consumer.test.cjs integration/runtime/gusto-company-connector.cjs integration/runtime/gusto-company-connector.test.cjs integration/runtime/gusto-oauth-landing.cjs integration/runtime/gusto-oauth-landing.test.cjs integration/runtime/gusto-integration-hub.test.cjs integration/runtime/directory-oauth-broker.cjs integration/runtime/directory-oauth-broker.test.cjs /tmp/wfm-tests/integration/runtime/
COPY integration-fabric/runtime/batch-reconciliation.mjs integration-fabric/runtime/scope-partition.mjs integration-fabric/runtime/dataset-coverage.mjs /tmp/wfm-tests/integration-fabric/runtime/
COPY integration/worker/directory-discovery-worker.cjs integration/worker/directory-discovery-worker.test.cjs /tmp/wfm-tests/integration/worker/
COPY integration/runtime/nango-credential-provider.test.cjs integration/runtime/nango-metadata-broker.test.cjs /tmp/wfm-nango/integration/runtime/
COPY test-support/sealed-nango-broker.cjs /tmp/wfm-nango/test-support/sealed-nango-broker.cjs
COPY integration/runtime/provider-metadata-review.test.cjs /tmp/wfm-nango/integration/runtime/
RUN VECTOR_NANGO_RUNTIME_ROOT=/app/integration-runtime node /tmp/wfm-nango/integration/runtime/nango-credential-provider.test.cjs \
 && VECTOR_NANGO_RUNTIME_ROOT=/app/integration-runtime VECTOR_NANGO_BROKER_ROOT=/app/lib node /tmp/wfm-nango/integration/runtime/nango-metadata-broker.test.cjs \
 && VECTOR_NANGO_RUNTIME_ROOT=/app/integration-runtime node /tmp/wfm-nango/integration/runtime/provider-metadata-review.test.cjs \
 && rm -rf /tmp/wfm-nango
COPY operations/runtime/workforce-lifecycle-guard.cjs /tmp/wfm-tests/operations/runtime/workforce-lifecycle-core.cjs
COPY operations/runtime/workforce-lifecycle-router.cjs /tmp/wfm-tests/operations/runtime/workforce-lifecycle-guard.cjs
COPY operations/runtime/tenant-calendar.cjs operations/runtime/tenant-calendar.test.cjs operations/runtime/workforce-lifecycle-guard.test.cjs operations/runtime/workflow-action-evidence-contract.cjs operations/runtime/workflow-action-evidence-contract.test.cjs operations/runtime/workflow-action-evidence-bridge.cjs operations/runtime/workflow-action-evidence-bridge.test.cjs operations/runtime/workflow-action-evidence-sources.cjs operations/runtime/workflow-action-evidence-sources.test.cjs operations/runtime/decision-episode.cjs operations/runtime/decision-episode.test.cjs operations/runtime/customer-demand-intelligence.cjs operations/runtime/customer-demand-intelligence.test.cjs operations/runtime/absence-recovery-shadow.cjs operations/runtime/absence-recovery-shadow.test.cjs operations/runtime/demand-decision-service.cjs operations/runtime/demand-decision-service.test.cjs operations/runtime/decision-outcome-proof.cjs operations/runtime/decision-outcome-proof.test.cjs operations/runtime/realtime-event-service.cjs operations/runtime/realtime-event-service.test.cjs operations/runtime/autopilot-execution-engine.cjs operations/runtime/autopilot-execution-engine.test.cjs operations/runtime/autopilot-expiry-readback.regression.test.cjs operations/runtime/t9-customer-guardian.cjs operations/runtime/t9-customer-guardian.test.cjs /tmp/wfm-tests/operations/runtime/
COPY reporting/runtime/vector-reporting-service.cjs reporting/runtime/vector-reporting-service.test.cjs /tmp/wfm-tests/reporting/runtime/
COPY trust/runtime/vector-trust-spine.cjs trust/runtime/vector-trust-spine.test.cjs /tmp/wfm-tests/trust/runtime/
COPY implementation/simulation/one-day-enterprise-simulation.mjs /tmp/wfm-tests/one-day-enterprise-simulation.mjs
RUN node /tmp/wfm-tests/one-day-enterprise-simulation.mjs --assert-target \
 && VECTOR_SETUP_POLICY_RUNTIME_ROOT=/app/implementation-runtime node --test /tmp/wfm-tests/implementation/runtime/setup-only-policy.test.cjs /tmp/wfm-tests/implementation/runtime/customer-workspace.test.cjs \
 && node --test \
      /tmp/wfm-tests/implementation/runtime/readiness-evidence-contract.test.cjs \
      /tmp/wfm-tests/implementation/runtime/readiness-evidence-wrapper.test.cjs \
      /tmp/wfm-tests/implementation/runtime/agents-api-adapter.test.cjs \
      /tmp/wfm-tests/implementation/runtime/agents-api-bootstrap-route.test.cjs \
      /tmp/wfm-tests/implementation/runtime/one-day-enterprise-engine.test.cjs \
      /tmp/wfm-tests/implementation/runtime/implementation-work-controller.test.cjs \
      /tmp/wfm-tests/implementation/runtime/implementation-work-fencing.test.cjs \
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
      /tmp/wfm-tests/security/runtime/hosted-application-user-guard.test.cjs \
      /tmp/wfm-tests/integration/runtime/three-min-feed.test.cjs \
      /tmp/wfm-tests/integration/runtime/autonomous-integration-hub.test.cjs \
      /tmp/wfm-tests/integration/runtime/autonomous-integration-hub.identity-consumer.test.cjs \
      /tmp/wfm-tests/integration/runtime/gusto-company-connector.test.cjs \
      /tmp/wfm-tests/integration/runtime/gusto-oauth-landing.test.cjs \
      /tmp/wfm-tests/integration/runtime/gusto-integration-hub.test.cjs \
      /tmp/wfm-tests/integration/runtime/directory-oauth-broker.test.cjs \
      /tmp/wfm-tests/integration/worker/directory-discovery-worker.test.cjs \
      /tmp/wfm-tests/operations/runtime/tenant-calendar.test.cjs \
      /tmp/wfm-tests/operations/runtime/workflow-action-evidence-contract.test.cjs \
      /tmp/wfm-tests/operations/runtime/workflow-action-evidence-sources.test.cjs \
      /tmp/wfm-tests/operations/runtime/workflow-action-evidence-bridge.test.cjs \
      /tmp/wfm-tests/operations/runtime/workforce-lifecycle-guard.test.cjs \
      /tmp/wfm-tests/operations/runtime/manufacturing-scheduling-engine.test.cjs \
      /tmp/wfm-tests/operations/runtime/scheduling-intelligence-service.test.cjs \
      /tmp/wfm-tests/operations/runtime/scheduling-authority.test.cjs \
      /tmp/wfm-tests/operations/runtime/order-start-variance-service.test.cjs \
      /tmp/wfm-tests/operations/runtime/order-start-variance-bootstrap.test.cjs \
      /tmp/wfm-tests/operations/runtime/production-output-gap.test.cjs \
      /tmp/wfm-tests/operations/runtime/order-material-availability.test.cjs \
      /tmp/wfm-tests/operations/runtime/factory-assessment-scenarios-service.test.cjs \
      /tmp/wfm-tests/operations/runtime/factory-assessment-scenarios-bootstrap.test.cjs \
      /tmp/wfm-tests/operations/runtime/order-start-variance.test.cjs \
      /tmp/wfm-tests/operations/runtime/order-start-variance-inert.test.cjs \
      /tmp/wfm-tests/operations/runtime/order-start-variance-inert-heldouts.test.cjs \
      /tmp/wfm-tests/operations/runtime/manufacturing-demand-forecast.test.cjs \
      /tmp/wfm-tests/operations/runtime/schedule-attendance-reconciliation.test.cjs \
      /tmp/wfm-tests/operations/runtime/scheduling-forecast-reconciliation-service.test.cjs \
      /tmp/wfm-tests/operations/runtime/decision-episode.test.cjs \
      /tmp/wfm-tests/operations/runtime/capacity-rescue-frozen-simulation.test.cjs \
      /tmp/wfm-tests/operations/runtime/customer-demand-intelligence.test.cjs \
      /tmp/wfm-tests/operations/runtime/absence-recovery-shadow.test.cjs \
      /tmp/wfm-tests/operations/runtime/demand-decision-service.test.cjs \
      /tmp/wfm-tests/operations/runtime/decision-outcome-proof.test.cjs \
      /tmp/wfm-tests/operations/runtime/realtime-event-service.test.cjs \
      /tmp/wfm-tests/operations/runtime/autopilot-execution-engine.test.cjs \
      /tmp/wfm-tests/operations/runtime/autopilot-expiry-readback.regression.test.cjs \
      /tmp/wfm-tests/reporting/runtime/vector-reporting-service.test.cjs \
 && rm -rf /tmp/wfm-tests

# Exercise installed integration modules, without a source-tree fallback. Test-only
# HTTP fixtures use synthetic provider I/O and disposable SQLite state, then leave the image.
COPY verification/vector-v014-setup-containment/heldout.test.cjs /tmp/vector-integration-admission/verification/vector-v014-setup-containment/heldout.test.cjs
COPY integration/runtime/gusto-http-process-recovery.test.cjs /tmp/vector-integration-admission/integration/runtime/gusto-http-process-recovery.test.cjs
COPY integration/runtime/fixtures/gusto-http-child.cjs /tmp/vector-integration-admission/integration/runtime/fixtures/gusto-http-child.cjs
RUN VECTOR_IMAGE_ADMISSION_ROOT=/app node --test --test-concurrency=1 /tmp/vector-integration-admission/verification/vector-v014-setup-containment/heldout.test.cjs /tmp/vector-integration-admission/integration/runtime/gusto-http-process-recovery.test.cjs \
 && rm -rf /tmp/vector-integration-admission

# Railway cloud-build admission: execute the exact 10,000-employee / 50-site
# configuration and independent payroll reconciliation proof without starting a server.
RUN WFM_PROOF_ONESHOT=true \
    WFM_CONFIG_ENGINE_PATH=/app/implementation-runtime/configuration-inference-engine.cjs \
    WFM_CONFIG_ENGINE_GIT_BLOB_SHA=c83aae130a0016e0577c8bf7f4bfff56b1d018b2 \
    node /app/proof-runtime/cloud-scale-proof-runner.cjs

# Vector-only presentation composition.
# The active image has one presentation entry point only: vector-ui.css + vector-ui.js.
# Retired shell entry points are physically removed from the runtime image, not hidden.
COPY ux-overlay/ /tmp/wfm-ux-overlay/
COPY reporting/ui/ /tmp/wfm-reporting-ui/
COPY scripts/compose-vector-presentation.mjs scripts/prove-vector-built-asset-provenance.mjs scripts/sanitize-customer-public-bundle.mjs scripts/validate-customer-public-bundle.mjs /tmp/
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
 && node /tmp/sanitize-customer-public-bundle.mjs /app/public \
 && node /tmp/validate-customer-public-bundle.mjs /app/public \
 && mkdir -p /tmp/vector-provenance/learning /tmp/vector-provenance/implementation /tmp/vector-provenance/reporting \
 && cp -r /tmp/wfm-ux-overlay /tmp/vector-provenance/ux-overlay \
 && cp -r /tmp/wfm-learning-ui /tmp/vector-provenance/learning/ui \
 && cp -r /tmp/wfm-implementation-ui /tmp/vector-provenance/implementation/ui \
 && cp -r /tmp/wfm-reporting-ui /tmp/vector-provenance/reporting/ui \
 && test -f /tmp/vector-provenance/reporting/ui/vector-reporting-ui.js \
 && test -f /tmp/vector-provenance/reporting/ui/vector-reporting-ui.css \
 && node /tmp/prove-vector-built-asset-provenance.mjs /tmp/vector-provenance /app/public /tmp/vector-sealed-base.css \
 && rm -rf /tmp/vector-provenance \
 && rm -f /tmp/vector-sealed-base.css /tmp/prove-vector-built-asset-provenance.mjs /tmp/compose-vector-presentation.mjs /tmp/sanitize-customer-public-bundle.mjs /tmp/validate-customer-public-bundle.mjs \
 && rm -rf /tmp/wfm-ux-overlay /tmp/wfm-reporting-ui /tmp/wfm-learning-ui /tmp/wfm-implementation-ui

COPY ux-overlay/vector-provider-metadata.test.cjs /tmp/vector-metadata/ux-overlay/
COPY test-support/sealed-nango-broker.cjs /tmp/vector-metadata/test-support/
RUN VECTOR_METADATA_UI_SOURCE=/app/public/vector-ui.js VECTOR_NANGO_RUNTIME_ROOT=/app/integration-runtime VECTOR_NANGO_BROKER_ROOT=/app/lib node /tmp/vector-metadata/ux-overlay/vector-provider-metadata.test.cjs \
 && rm -rf /tmp/vector-metadata

# Consequential attendance admission against the exact final runtime. Reject an
# overlapping correction before mutation, then prove valid reconciliation/export.
COPY verification/vector-repair-20260921/attendance-overlap-regression.mjs verification/vector-repair-20260921/attendance-payroll-acceptance.mjs verification/vector-repair-20260921/attendance-guardrails.test.cjs /tmp/wfm-attendance-tests/
COPY verification/vector-repair-20260921/attendance-runtime-harness.mjs verification/vector-repair-20260921/attendance-runtime-harness.test.mjs /tmp/wfm-attendance-tests/
RUN WFM_RUNTIME=/app node --test /tmp/wfm-attendance-tests/attendance-guardrails.test.cjs /tmp/wfm-attendance-tests/attendance-runtime-harness.test.mjs \
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

# Proof-only descendant: fixtures never enter the final runtime lineage.
FROM hardened-runtime AS installed-archive-proof
ARG RAILWAY_GIT_COMMIT_SHA
COPY operations/runtime/tenant-calendar.cjs operations/runtime/workflow-action-evidence-contract.cjs operations/runtime/workflow-action-evidence-bridge.cjs operations/runtime/workflow-action-evidence-contract.test.cjs operations/runtime/workflow-action-evidence-bridge.test.cjs /proof/source/
COPY artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz /proof/sealed-runtime.tgz
COPY verification/vector-repair-20260921/verify-installed-workflow-archive.sh /proof/verify-installed-workflow-archive.sh
RUN chown -R root:root /proof \
 && find /proof -type d -exec chmod 0555 {} + \
 && find /proof -type f -exec chmod 0444 {} + \
 && gosu node env EXPECTED_SOURCE_SHA="$RAILWAY_GIT_COMMIT_SHA" \
      WFM_EVIDENCE_SEALED_ARCHIVE=/proof/sealed-runtime.tgz \
      /bin/sh /proof/verify-installed-workflow-archive.sh \
 && printf '%s\n' "$RAILWAY_GIT_COMMIT_SHA" > /installed-archive-admitted-source-sha

# Inherit the same hardened application, not the proof fixture layers.
FROM hardened-runtime
ARG RAILWAY_GIT_COMMIT_SHA
COPY --from=installed-archive-proof /installed-archive-admitted-source-sha /tmp/installed-archive-admitted-source-sha
RUN test "$(cat /tmp/installed-archive-admitted-source-sha)" = "$RAILWAY_GIT_COMMIT_SHA" \
 && test "$(cat /app/.wfm-build-source-sha)" = "$RAILWAY_GIT_COMMIT_SHA" \
 && test ! -e /proof \
 && rm /tmp/installed-archive-admitted-source-sha
