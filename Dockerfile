# Customer-proof staging build: sealed 0.6.76 runtime
FROM node:22.23.2-bookworm-slim@sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96
WORKDIR /app
COPY artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz /tmp/runtime.tgz
RUN echo "3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d  /tmp/runtime.tgz" | sha256sum -c - \
 && tar -xzf /tmp/runtime.tgz -C /app \
 && rm -f /tmp/runtime.tgz

# Resource-side identity survival overlay. Keep the original sealed artifact intact and
# add the defence overlay as a separately reviewable layer.
RUN mkdir -p /app/security-runtime
COPY security/runtime/identity-survival-guard.cjs /app/security-runtime/identity-survival-guard.cjs
COPY security/runtime/bootstrap.cjs /app/security-runtime/bootstrap.cjs

# Vector-only presentation composition.
# Retired UX-reset/Cycle renderers are not present in the repository and cannot be rebuilt.
COPY ux-overlay/ /tmp/wfm-ux-overlay/
RUN node --check /tmp/wfm-ux-overlay/vector-shell.js \
 && printf '\n/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */\n' >> /app/public/factory-control-ui.css \
 && cat /tmp/wfm-ux-overlay/vector-shell.css >> /app/public/factory-control-ui.css \
 && printf '\n;/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */\n' >> /app/public/value-cockpit-ui.js \
 && cat /tmp/wfm-ux-overlay/vector-shell.js >> /app/public/value-cockpit-ui.js \
 && test "$(find /tmp/wfm-ux-overlay -maxdepth 1 -type f -printf '%f\n' | sort | tr '\n' ' ')" = "vector-shell.css vector-shell.js " \
 && rm -rf /tmp/wfm-ux-overlay

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
