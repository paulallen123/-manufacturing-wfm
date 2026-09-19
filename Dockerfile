# Discarded Railway build stage: prove T0-T4 zero-engineer support and bounded recovery
# against the exact candidate sources. Nothing from this stage is copied into runtime.
FROM node:22.23.2-bookworm-slim@sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96 AS autonomy-proof
WORKDIR /proof
COPY resilience/ ./resilience/
COPY scripts/ ./scripts/
COPY .github/workflows/ ./.github/workflows/
RUN rm -f scripts/validate-deployment.mjs \
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
RUN node /tmp/retire-legacy-presentation.mjs /app/public \
 && rm -f /tmp/retire-legacy-presentation.mjs

# Resource-side identity survival overlay. Keep the original sealed artifact intact and
# add the defence overlay as a separately reviewable layer.
RUN mkdir -p /app/security-runtime
COPY security/runtime/identity-survival-guard.cjs /app/security-runtime/identity-survival-guard.cjs
COPY security/runtime/hosted-listen-guard.cjs /app/security-runtime/hosted-listen-guard.cjs
COPY security/runtime/bootstrap.cjs /app/security-runtime/bootstrap.cjs

# Autonomous integration fabric. The control plane is separately reviewable and
# uses only Node built-ins plus the existing per-tenant SQLite runtime.
RUN mkdir -p /app/integration-runtime
COPY integration/runtime/autonomous-integration-hub.cjs /app/integration-runtime/autonomous-integration-hub.cjs

# One-day implementation and adaptive learning overlays. These remain additive,
# tenant-scoped, fail-closed control planes using Node built-ins and the existing SQLite state.
RUN mkdir -p /app/implementation-runtime /app/learning-runtime /app/operations-runtime /tmp/wfm-learning-ui /tmp/wfm-implementation-ui
COPY implementation/runtime/one-day-enterprise-engine.cjs /app/implementation-runtime/one-day-enterprise-engine.cjs
COPY implementation/runtime/configuration-inference-engine.cjs /app/implementation-runtime/configuration-inference-engine.cjs
COPY learning/runtime/adaptive-learning-engine.cjs /app/learning-runtime/adaptive-learning-engine.cjs
COPY operations/runtime/workforce-lifecycle-guard.cjs /app/operations-runtime/workforce-lifecycle-guard.cjs
COPY operations/runtime/vector-intelligence-layer.cjs /app/operations-runtime/vector-intelligence-layer.cjs
COPY operations/runtime/vector-intelligence-control-plane.cjs /app/operations-runtime/vector-intelligence-control-plane.cjs
COPY operations/runtime/vector-report-engine.cjs /app/operations-runtime/vector-report-engine.cjs
COPY operations/runtime/vector-email-delivery.cjs /app/operations-runtime/vector-email-delivery.cjs
COPY operations/runtime/vector-context-engine.cjs /app/operations-runtime/vector-context-engine.cjs
COPY operations/runtime/vector-automation-worker.cjs /app/operations-runtime/vector-automation-worker.cjs
COPY learning/ui/ /tmp/wfm-learning-ui/
COPY implementation/ui/ /tmp/wfm-implementation-ui/

# Exact cloud-scale proof runtime. Kept read-only with the application and executable only when explicitly selected.
RUN mkdir -p /app/proof-runtime
COPY implementation/proof/cloud-scale-proof-runner.cjs /app/proof-runtime/cloud-scale-proof-runner.cjs

# Deterministic build admission for implementation, learning and Vector intelligence control planes.
# Tests execute against the exact files copied into this image; test sources are removed
# afterwards so they do not expand the runtime attack surface.
RUN mkdir -p /tmp/wfm-tests/implementation/runtime /tmp/wfm-tests/learning/runtime /tmp/wfm-tests/security/runtime /tmp/wfm-tests/integration/runtime /tmp/wfm-tests/integration/worker /tmp/wfm-tests/operations/runtime
COPY implementation/runtime/one-day-enterprise-engine.cjs /tmp/wfm-tests/implementation/runtime/one-day-enterprise-engine.cjs
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
COPY operations/runtime/workforce-lifecycle-guard.cjs /tmp/wfm-tests/operations/runtime/workforce-lifecycle-guard.cjs
COPY operations/runtime/workforce-lifecycle-guard.test.cjs /tmp/wfm-tests/operations/runtime/workforce-lifecycle-guard.test.cjs
COPY operations/runtime/vector-intelligence-layer.cjs /tmp/wfm-tests/operations/runtime/vector-intelligence-layer.cjs
COPY operations/runtime/vector-intelligence-layer.test.cjs /tmp/wfm-tests/operations/runtime/vector-intelligence-layer.test.cjs
COPY operations/runtime/vector-intelligence-control-plane.cjs /tmp/wfm-tests/operations/runtime/vector-intelligence-control-plane.cjs
COPY operations/runtime/vector-intelligence-control-plane.test.cjs /tmp/wfm-tests/operations/runtime/vector-intelligence-control-plane.test.cjs
COPY operations/runtime/vector-report-engine.cjs /tmp/wfm-tests/operations/runtime/vector-report-engine.cjs
COPY operations/runtime/vector-report-engine.test.cjs /tmp/wfm-tests/operations/runtime/vector-report-engine.test.cjs
COPY operations/runtime/vector-email-delivery.cjs /tmp/wfm-tests/operations/runtime/vector-email-delivery.cjs
COPY operations/runtime/vector-email-delivery.test.cjs /tmp/wfm-tests/operations/runtime/vector-email-delivery.test.cjs
COPY operations/runtime/vector-context-engine.cjs /tmp/wfm-tests/operations/runtime/vector-context-engine.cjs
COPY operations/runtime/vector-context-engine.test.cjs /tmp/wfm-tests/operations/runtime/vector-context-engine.test.cjs
COPY operations/runtime/vector-automation-worker.cjs /tmp/wfm-tests/operations/runtime/vector-automation-worker.cjs
COPY operations/runtime/vector-automation-worker.test.cjs /tmp/wfm-tests/operations/runtime/vector-automation-worker.test.cjs
COPY implementation/simulation/one-day-enterprise-simulation.mjs /tmp/wfm-tests/one-day-enterprise-simulation.mjs
RUN node /tmp/wfm-tests/one-day-enterprise-simulation.mjs --assert-target \
 && node --test \
      /tmp/wfm-tests/implementation/runtime/one-day-enterprise-engine.test.cjs \
      /tmp/wfm-tests/implementation/runtime/configuration-inference-engine.test.cjs \
      /tmp/wfm-tests/learning/runtime/adaptive-learning-engine.test.cjs \
      /tmp/wfm-tests/implementation/runtime/implementation-learning-integration.test.cjs \
      /tmp/wfm-tests/security/runtime/hosted-listen-guard.test.cjs \
      /tmp/wfm-tests/integration/runtime/autonomous-integration-hub.test.cjs \
      /tmp/wfm-tests/integration/runtime/directory-oauth-broker.test.cjs \
      /tmp/wfm-tests/integration/worker/directory-discovery-worker.test.cjs \
      /tmp/wfm-tests/operations/runtime/workforce-lifecycle-guard.test.cjs \
      /tmp/wfm-tests/operations/runtime/vector-intelligence-layer.test.cjs \
      /tmp/wfm-tests/operations/runtime/vector-intelligence-control-plane.test.cjs \
      /tmp/wfm-tests/operations/runtime/vector-report-engine.test.cjs \
      /tmp/wfm-tests/operations/runtime/vector-email-delivery.test.cjs \
      /tmp/wfm-tests/operations/runtime/vector-context-engine.test.cjs \
      /tmp/wfm-tests/operations/runtime/vector-automation-worker.test.cjs \
 && rm -rf /tmp/wfm-tests

# Railway cloud-build admission: execute the exact 10,000-employee / 50-site
# configuration and independent payroll reconciliation proof without starting a server.
RUN WFM_PROOF_ONESHOT=true \
    WFM_CONFIG_ENGINE_PATH=/app/implementation-runtime/configuration-inference-engine.cjs \
    WFM_CONFIG_ENGINE_GIT_BLOB_SHA=d3688d27841a28d3b8801b7d4c63f254e8bf7edd \
    node /app/proof-runtime/cloud-scale-proof-runner.cjs

# Vector-only presentation composition.
# Legacy/retired shells remain completely unloaded.
# Vector is the only active presentation shell; governed routes/APIs remain underneath.
COPY ux-overlay/ /tmp/wfm-ux-overlay/
RUN node --check /app/security-runtime/bootstrap.cjs \
 && node --check /tmp/wfm-implementation-ui/implementation-journey.js \
 && node --check /tmp/wfm-ux-overlay/vector-shell.js \
 && printf '\n/* WFM_ADAPTIVE_COACH_BEGIN */\n' >> /app/public/factory-control-ui.css \
 && cat /tmp/wfm-learning-ui/adaptive-coach.css >> /app/public/factory-control-ui.css \
 && printf '\n/* WFM_IMPLEMENTATION_JOURNEY_VERSION_D_BEGIN */\n' >> /app/public/factory-control-ui.css \
 && cat /tmp/wfm-implementation-ui/implementation-journey.css >> /app/public/factory-control-ui.css \
 && printf '\n/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */\n' >> /app/public/factory-control-ui.css \
 && cat /tmp/wfm-ux-overlay/vector-shell.css >> /app/public/factory-control-ui.css \
 && printf '\n;/* WFM_ADAPTIVE_COACH_BEGIN */\n' >> /app/public/value-cockpit-ui.js \
 && cat /tmp/wfm-learning-ui/adaptive-coach.js >> /app/public/value-cockpit-ui.js \
 && printf '\n;/* WFM_IMPLEMENTATION_JOURNEY_VERSION_D_BEGIN */\n' >> /app/public/value-cockpit-ui.js \
 && cat /tmp/wfm-implementation-ui/implementation-journey.js >> /app/public/value-cockpit-ui.js \
 && cp /tmp/wfm-ux-overlay/vector-shell.js /app/public/vector-shell.js \
 && node -e "const fs=require('fs');const css=fs.readFileSync('/app/public/factory-control-ui.css','utf8');const legacy=fs.readFileSync('/app/public/value-cockpit-ui.js','utf8');const vector=fs.readFileSync('/app/public/vector-shell.js','utf8');for(const marker of ['WFM_UX_RESET_CYCLE11_BEGIN','WFM_UX_RESET_CYCLE12_BEGIN','VECTOR_PRIORITY_BRIDGE_V1']){if(css.includes(marker)||legacy.includes(marker)||vector.includes(marker))throw new Error('Retired presentation marker loaded: '+marker)}if(!css.includes('VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1')||!vector.includes('VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1'))throw new Error('Approved Vector shell missing');console.log('VECTOR_ONLY_PRESENTATION_ADMISSION=PASS')" \
 && node --check /app/public/value-cockpit-ui.js \
 && node --check /app/public/vector-shell.js \
 && node -e "const fs=require('fs');const p='/app/public/index.html';let h=fs.readFileSync(p,'utf8');if(!h.includes('vector-shell.js')){h=h.replace('</body>','<script src=\"vector-shell.js\"></script></body>');fs.writeFileSync(p,h)}" \
 && rm -rf /tmp/wfm-ux-overlay /tmp/wfm-learning-ui /tmp/wfm-implementation-ui

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