# Customer-proof staging build: sealed 0.6.76 runtime
FROM node:22.23.2-bookworm-slim@sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96
WORKDIR /app
COPY artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz /tmp/runtime.tgz
RUN echo "3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d  /tmp/runtime.tgz" | sha256sum -c - \
 && tar -xzf /tmp/runtime.tgz -C /app \
 && rm -f /tmp/runtime.tgz \
 && chown -R node:node /app
# Keep the sealed runtime immutable and add the UX reset as a final, reviewable overlay.
COPY --chown=node:node ux-overlay/ux-reset.css /app/public/ux-reset.css
COPY --chown=node:node ux-overlay/ux-reset.js /app/public/ux-reset.js
RUN sed -i 's#</head>#<link rel="stylesheet" href="ux-reset.css?v=20260917-1"></head>#' /app/public/index.html \
 && sed -i 's#</body>#<script src="ux-reset.js?v=20260917-1"></script></body>#' /app/public/index.html
# The staged application is self-contained and uses Node built-ins only. Remove package
# managers from the final runtime so npm-bundled libraries (including node-tar) are not
# an exposed production attack surface.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
 && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
          /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx
USER node
ENV NODE_ENV=staging
EXPOSE 3000
CMD ["node","server.cjs"]
