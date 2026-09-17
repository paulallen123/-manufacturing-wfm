# Customer-proof staging build: sealed 0.6.76 runtime
FROM node:22.23.2-bookworm-slim@sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96
WORKDIR /app
COPY artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz /tmp/runtime.tgz
RUN echo "3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d  /tmp/runtime.tgz" | sha256sum -c - \
 && tar -xzf /tmp/runtime.tgz -C /app \
 && rm -f /tmp/runtime.tgz \
 && chown -R node:node /app

# Resource-side identity survival overlay. This is deliberately outside the sealed runtime
# archive so the original artifact remains cryptographically verifiable while the defence
# overlay is independently reviewable and testable.
RUN mkdir -p /app/security-runtime && chown node:node /app/security-runtime
COPY --chown=node:node security/runtime/identity-survival-guard.cjs /app/security-runtime/identity-survival-guard.cjs
COPY --chown=node:node security/runtime/bootstrap.cjs /app/security-runtime/bootstrap.cjs

# The staged application is self-contained and uses Node built-ins only. Remove package
# managers from the final runtime so npm-bundled libraries (including node-tar) are not
# an exposed production attack surface.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
 && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
          /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx
USER node
ENV NODE_ENV=staging
ENV WFM_IDENTITY_SURVIVAL_GUARD=enforce
EXPOSE 3000
CMD ["node","security-runtime/bootstrap.cjs"]
