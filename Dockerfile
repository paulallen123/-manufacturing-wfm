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
COPY security/runtime/passkey-auth.cjs /app/security-runtime/passkey-auth.cjs
COPY security/runtime/bootstrap.cjs /app/security-runtime/bootstrap.cjs

# Preserve the sealed server/security contract. Compose the reviewable UX layers only
# through existing presentation assets that are already in the server's static allow-list.
# factory-control-ui.css and value-cockpit-ui.js are the final approved CSS/JS assets in
# the base page, so appending here keeps the UX ordering deterministic without adding routes.
COPY ux-overlay/ /tmp/wfm-ux-overlay/
RUN printf '\n/* WFM_UX_RESET_BASE_BEGIN */\n' >> /app/public/factory-control-ui.css \
 && cat /tmp/wfm-ux-overlay/ux-reset.css >> /app/public/factory-control-ui.css \
 && printf '\n/* WFM_UX_RESET_CYCLE2_BEGIN */\n' >> /app/public/factory-control-ui.css \
 && cat /tmp/wfm-ux-overlay/ux-reset-cycle2.css >> /app/public/factory-control-ui.css \
 && printf '\n/* WFM_UX_RESET_CYCLE3_BEGIN */\n' >> /app/public/factory-control-ui.css \
 && cat /tmp/wfm-ux-overlay/ux-reset-cycle3.css >> /app/public/factory-control-ui.css \
 && printf '\n/* WFM_UX_RESET_CYCLE4_BEGIN */\n' >> /app/public/factory-control-ui.css \
 && cat /tmp/wfm-ux-overlay/ux-reset-cycle4.css >> /app/public/factory-control-ui.css \
 && printf '\n/* WFM_UX_RESET_CYCLE5_BEGIN */\n' >> /app/public/factory-control-ui.css \
 && cat /tmp/wfm-ux-overlay/ux-reset-cycle5.css >> /app/public/factory-control-ui.css \
 && printf '\n/* WFM_UX_RESET_CYCLE6_BEGIN */\n' >> /app/public/factory-control-ui.css \
 && cat /tmp/wfm-ux-overlay/ux-reset-cycle6.css >> /app/public/factory-control-ui.css \
 && printf '\n/* WFM_UX_RESET_CYCLE7_BEGIN */\n' >> /app/public/factory-control-ui.css \
 && cat /tmp/wfm-ux-overlay/ux-reset-cycle7.css >> /app/public/factory-control-ui.css \
 && printf '\n/* WFM_UX_RESET_CYCLE8_BEGIN */\n' >> /app/public/factory-control-ui.css \
 && cat /tmp/wfm-ux-overlay/ux-reset-cycle8.css >> /app/public/factory-control-ui.css \
 && printf '\n/* WFM_UX_RESET_CYCLE9_BEGIN */\n' >> /app/public/factory-control-ui.css \
 && cat /tmp/wfm-ux-overlay/ux-reset-cycle9.css >> /app/public/factory-control-ui.css \
 && printf '\n/* WFM_PASSKEY_UI_BEGIN */\n' >> /app/public/factory-control-ui.css \
 && cat /tmp/wfm-ux-overlay/passkey-auth.css >> /app/public/factory-control-ui.css \
 && printf '\n/* WFM_UX_RESET_BASE_BEGIN */\n' >> /app/public/value-cockpit-ui.js \
 && cat /tmp/wfm-ux-overlay/ux-reset.js >> /app/public/value-cockpit-ui.js \
 && printf '\n;/* WFM_UX_RESET_CYCLE2_BEGIN */\n' >> /app/public/value-cockpit-ui.js \
 && cat /tmp/wfm-ux-overlay/ux-reset-cycle2.js >> /app/public/value-cockpit-ui.js \
 && printf '\n;/* WFM_UX_RESET_CYCLE3_BEGIN */\n' >> /app/public/value-cockpit-ui.js \
 && cat /tmp/wfm-ux-overlay/ux-reset-cycle3.js >> /app/public/value-cockpit-ui.js \
 && printf '\n;/* WFM_UX_RESET_CYCLE4_BEGIN */\n' >> /app/public/value-cockpit-ui.js \
 && cat /tmp/wfm-ux-overlay/ux-reset-cycle4.js >> /app/public/value-cockpit-ui.js \
 && printf '\n;/* WFM_UX_RESET_CYCLE5_BEGIN */\n' >> /app/public/value-cockpit-ui.js \
 && cat /tmp/wfm-ux-overlay/ux-reset-cycle5.js >> /app/public/value-cockpit-ui.js \
 && printf '\n;/* WFM_UX_RESET_CYCLE6_BEGIN */\n' >> /app/public/value-cockpit-ui.js \
 && cat /tmp/wfm-ux-overlay/ux-reset-cycle6.js >> /app/public/value-cockpit-ui.js \
 && printf '\n;/* WFM_UX_RESET_CYCLE7_BEGIN */\n' >> /app/public/value-cockpit-ui.js \
 && cat /tmp/wfm-ux-overlay/ux-reset-cycle7.js >> /app/public/value-cockpit-ui.js \
 && printf '\n;/* WFM_UX_RESET_CYCLE8_BEGIN */\n' >> /app/public/value-cockpit-ui.js \
 && cat /tmp/wfm-ux-overlay/ux-reset-cycle8.js >> /app/public/value-cockpit-ui.js \
 && printf '\n;/* WFM_UX_RESET_CYCLE9_BEGIN */\n' >> /app/public/value-cockpit-ui.js \
 && cat /tmp/wfm-ux-overlay/ux-reset-cycle9.js >> /app/public/value-cockpit-ui.js \
 && printf '\n;/* WFM_PASSKEY_UI_BEGIN */\n' >> /app/public/value-cockpit-ui.js \
 && cat /tmp/wfm-ux-overlay/passkey-auth.js >> /app/public/value-cockpit-ui.js \
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
ENV WFM_PASSKEYS=true
EXPOSE 3000
CMD ["node","security-runtime/bootstrap.cjs"]
