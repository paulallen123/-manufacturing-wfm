# Discarded Railway build stage: prove T0-T4 zero-engineer support and bounded recovery
# against the exact candidate sources. Nothing from this stage is copied into runtime.
FROM node:22.23.2-bookworm-slim@sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96 AS autonomy-proof
WORKDIR /proof
COPY . ./
RUN node scripts/validate-deployment.mjs \
 && node scripts/validate-vector-only-ui.mjs \
 && node --test tests/vector-consolidation.test.cjs tests/vector-runtime-packaging.test.cjs tests/vector-source-guard.test.cjs ux-overlay/vector-action-queue.test.cjs operations/runtime/workflow-action-evidence-contract.test.cjs scripts/compose-vector-presentation.regression.test.mjs scripts/prove-vector-built-asset-provenance.test.mjs \
 && node scripts/run-local-vector-proof.mjs /proof-vector-integrated \
 && cat /proof-vector-integrated/summary.json \
 && rm -f scripts/validate-deployment.mjs \
 && node scripts/run-portable-autonomy-proof.mjs --strict-runtime

# Customer-proof staging build: sealed 0.6.76 runtime
FROM node:22.23.2-bookworm-slim@sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96
WORKDIR /app

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
COPY security/runtime/hosted-listen-guard.cjs /app/security-runtime/hosted-listen-guard.cjs
COPY security/runtime/bootstrap.cjs /app/security-runtime/bootstrap.cjs
COPY security/runtime/owner-access-recovery.cjs /app/security-runtime/owner-access-recovery.cjs
COPY security/runtime/retired-presentation.cjs /app/security-runtime/retired-presentation.cjs

# Autonomous integration fabric. The control plane is separately reviewable and
# uses only Node built-ins plus the existing per-tenant SQLite runtime.
RUN mkdir -p /app/integration-runtime
COPY integration/runtime/autonomous-integration-hub.cjs /app/integration-runtime/autonomous-integration-hub.cjs

# One-day implementation and adaptive learning overlays. These remain additive,
# tenant-scoped, fail-closed control planes using Node built-ins and the existing SQLite state.
RUN mkdir -p /app/implementation-runtime /app/learning-runtime /app/operations-runtime /tmp/wfm-learning-ui /tmp/wfm-implementation-ui
COPY implementation/runtime/one-day-enterprise-engine.cjs /app/implementation-runtime/one-day-enterprise-engine.cjs
COPY implementation/runtime/one-day-enterprise-engine-core.cjs /app/implementation-runtime/one-day-enterprise-engine-core.cjs
COPY implementation/runtime/readiness-evidence-contract.cjs /app/implementation-runtime/readiness-evidence-contract.cjs
COPY implementation/runtime/configuration-inference-engine.cjs /app/implementation-runtime/configuration-inference-engine.cjs
COPY learning/runtime/adaptive-learning-engine.cjs /app/learning-runtime/adaptive-learning-engine.cjs
COPY operations/runtime/workforce-lifecycle-guard.cjs /app/operations-runtime/workforce-lifecycle-core.cjs
COPY operations/runtime/workflow-action-evidence-contract.cjs /app/operations-runtime/workflow-action-evidence-contract.cjs
COPY operations/runtime/workflow-action-evidence-bridge.cjs /app/operations-runtime/workflow-action-evidence-bridge.cjs
COPY operations/runtime/workforce-lifecycle-router.cjs /app/operations-runtime/workforce-lifecycle-guard.cjs
COPY learning/ui/ /tmp/wfm-learning-ui/
COPY implementation/ui/ /tmp/wfm-implementation-ui/

# Exact cloud-scale proof runtime. Kept read-only with the application and executable only when explicitly selected.
RUN mkdir -p /app/proof-runtime
COPY implementation/proof/cloud-scale-proof-runner.cjs /app/proof-runtime/cloud-scale-proof-runner.cjs

# Deterministic build admission for the new implementation and learning control planes.
# Tests execute against the exact files copied into this image; test sources are removed
# afterwards so they do not expand the runtime attack surface.
RUN mkdir -p /tmp/wfm-tests/implementation/runtime /tmp/wfm-tests/learning/runtime /tmp/wfm-tests/security/runtime /tmp/wfm-tests/integration/runtime /tmp/wfm-tests/integration/worker /tmp/wfm-tests/operations/runtime
COPY implementation/runtime/one-day-enterprise-engine.cjs /tmp/wfm-tests/implementation/runtime/one-day-enterprise-engine.cjs
COPY implementation/runtime/one-day-enterprise-engine-core.cjs /tmp/wfm-tests/implementation/runtime/one-day-enterprise-engine-core.cjs
COPY implementation/runtime/readiness-evidence-contract.cjs /tmp/wfm-tests/implementation/runtime/readiness-evidence-contract.cjs
COPY implementation/runtime/readiness-evidence-contract.test.cjs /tmp/wfm-tests/implementation/runtime/readiness-evidence-contract.test.cjs
COPY implementation/runtime/readiness-evidence-wrapper.test.cjs /tmp/wfm-tests/implementation/runtime/readiness-evidence-wrapper.test.cjs
COPY implementation/runtime/configuration-inference-engine.cjs /tmp/wfm-tests/implementation/runtime/configuration-inference-engine.cjs
COPY implementation/runtime/one-day-enterprise-engine.test.cjs /tmp/wfm-tests/implementation/runtime/one-day-enterprise-engine.test.cjs
COPY implementation/runtime/configuration-inference-engine.test.cjs /tmp/wfm-tests/implementation/runtime/configuration-inference-engine.test.cjs
COPY implementation/runtime/implementation-learning-integration.test.cjs /tmp/wfm-tests/implementation/runtime/implementation-learning-integration.test.cjs
COPY learning/runtime/adaptive-learning-engine.cjs /tmp/wfm-tests/learning/runtime/adaptive-learning-engine.cjs
COPY learning/runtime/adaptive-learning-engine.test.cjs /tmp/wfm-tests/learning/runtime/adaptive-learning-engine.test.cjs
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
COPY implementation/simulation/one-day-enterprise-simulation.mjs /tmp/wfm-tests/one-day-enterprise-simulation.mjs
RUN node /tmp/wfm-tests/one-day-enterprise-simulation.mjs --assert-target \
 && node --test \
      /tmp/wfm-tests/implementation/runtime/readiness-evidence-contract.test.cjs \
      /tmp/wfm-tests/implementation/runtime/readiness-evidence-wrapper.test.cjs \
      /tmp/wfm-tests/implementation/runtime/one-day-enterprise-engine.test.cjs \
      /tmp/wfm-tests/implementation/runtime/configuration-inference-engine.test.cjs \
      /tmp/wfm-tests/learning/runtime/adaptive-learning-engine.test.cjs \
      /tmp/wfm-tests/implementation/runtime/implementation-learning-integration.test.cjs \
      /tmp/wfm-tests/security/runtime/hosted-listen-guard.test.cjs \
      /tmp/wfm-tests/integration/runtime/autonomous-integration-hub.test.cjs \
      /tmp/wfm-tests/integration/runtime/directory-oauth-broker.test.cjs \
      /tmp/wfm-tests/integration/worker/directory-discovery-worker.test.cjs \
      /tmp/wfm-tests/operations/runtime/workflow-action-evidence-contract.test.cjs \
      /tmp/wfm-tests/operations/runtime/workflow-action-evidence-bridge.test.cjs \
      /tmp/wfm-tests/operations/runtime/workforce-lifecycle-guard.test.cjs \
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
COPY scripts/compose-vector-presentation.mjs /tmp/compose-vector-presentation.mjs
COPY scripts/prove-vector-built-asset-provenance.mjs /tmp/prove-vector-built-asset-provenance.mjs
RUN cp /app/public/factory-control-ui.css /tmp/vector-sealed-base.css \
 && node --check /app/security-runtime/bootstrap.cjs \
 && node --check /tmp/wfm-implementation-ui/implementation-journey.js \
 && node --check /tmp/wfm-ux-overlay/vector-shell.js \
 && printf '/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */\n' > /app/public/vector-ui.css \
 && cat /app/public/factory-control-ui.css >> /app/public/vector-ui.css \
 && printf '\n/* WFM_ADAPTIVE_COACH_BEGIN */\n' >> /app/public/vector-ui.css \
 && cat /tmp/wfm-learning-ui/adaptive-coach.css >> /app/public/vector-ui.css \
 && printf '\n/* WFM_IMPLEMENTATION_JOURNEY_VERSION_D_BEGIN */\n' >> /app/public/vector-ui.css \
 && cat /tmp/wfm-implementation-ui/implementation-journey.css >> /app/public/vector-ui.css \
 && printf '\n/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */\n' >> /app/public/vector-ui.css \
 && cat /tmp/wfm-ux-overlay/vector-shell.css >> /app/public/vector-ui.css \
 && cat /tmp/wfm-ux-overlay/vector-workflows.css >> /app/public/vector-ui.css \
 && cp /tmp/wfm-ux-overlay/vector-workflows.js /app/public/vector-workflows.js \
 && node --check /app/public/vector-workflows.js \
 && printf "'use strict';\n/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */\n" > /app/public/vector-ui.js \
 && printf '\n;/* WFM_ADAPTIVE_COACH_BEGIN */\n' >> /app/public/vector-ui.js \
 && cat /tmp/wfm-learning-ui/adaptive-coach.js >> /app/public/vector-ui.js \
 && printf '\n;/* WFM_IMPLEMENTATION_JOURNEY_VERSION_D_BEGIN */\n' >> /app/public/vector-ui.js \
 && cat /tmp/wfm-implementation-ui/implementation-journey.js >> /app/public/vector-ui.js \
 && printf '\n;/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */\n' >> /app/public/vector-ui.js \
 && cat /tmp/wfm-ux-overlay/vector-shell.js >> /app/public/vector-ui.js \
 && node --check /app/public/vector-ui.js \
 && node /tmp/compose-vector-presentation.mjs /app/public \
 && rm -f /app/public/factory-control-ui.js /app/public/factory-control-ui.css \
          /app/public/value-cockpit-ui.js \
          /app/public/value-cockpit-ui.css \
          /app/public/review-ui.js \
          /app/public/review-ui.css \
          /app/public/ui-evolution.css \
          /app/public/vector-shell.js \
 && node -e "const fs=require('fs');const h=fs.readFileSync('/app/public/index.html','utf8');const forbidden=['factory-control-ui.js','factory-control-ui.css','value-cockpit-ui.js','value-cockpit-ui.css','review-ui.js','review-ui.css','ui-evolution.css','vector-shell.js'];for(const name of forbidden){if(h.includes(name)||fs.existsSync('/app/public/'+name))throw new Error('Retired presentation remains: '+name)}const css=fs.readFileSync('/app/public/vector-ui.css','utf8');const js=fs.readFileSync('/app/public/vector-ui.js','utf8');if(!h.includes('/vector-ui.css')||!h.includes('/vector-ui.js')||!css.includes('VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1')||!js.includes('VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1'))throw new Error('Vector-only presentation admission failed');console.log('VECTOR_SINGLE_PRESENTATION_ENTRYPOINT=PASS')" \
 && mkdir -p /tmp/vector-provenance/learning /tmp/vector-provenance/implementation \
 && cp -r /tmp/wfm-ux-overlay /tmp/vector-provenance/ux-overlay \
 && cp -r /tmp/wfm-learning-ui /tmp/vector-provenance/learning/ui \
 && cp -r /tmp/wfm-implementation-ui /tmp/vector-provenance/implementation/ui \
 && node /tmp/prove-vector-built-asset-provenance.mjs /tmp/vector-provenance /app/public /tmp/vector-sealed-base.css \
 && rm -rf /tmp/vector-provenance \
 && rm -f /tmp/vector-sealed-base.css /tmp/prove-vector-built-asset-provenance.mjs /tmp/compose-vector-presentation.mjs \
 && rm -rf /tmp/wfm-ux-overlay /tmp/wfm-learning-ui /tmp/wfm-implementation-ui

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
RUN chown -R root:root /app \
 && find /app -type d -exec chmod 0555 {} + \
 && find /app -type f -exec chmod 0444 {} +

USER node
ENV NODE_ENV=staging
ENV WFM_IDENTITY_SURVIVAL_GUARD=enforce
EXPOSE 3000
CMD ["node","security-runtime/bootstrap.cjs"]

# VECTOR_CANONICAL_REDEPLOY_20260920
