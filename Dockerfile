# Customer-proof staging build: sealed 0.6.76 runtime
FROM node:22.23.2-bookworm-slim@sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96
WORKDIR /app
COPY artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz /tmp/runtime.tgz
RUN echo "3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d  /tmp/runtime.tgz" | sha256sum -c - \
 && tar -xzf /tmp/runtime.tgz -C /app \
 && rm -f /tmp/runtime.tgz \
 && chown -R node:node /app

# Patch the PCRE2 package carried by the pinned Bookworm base to Debian's fixed
# security build. Pin the exact package version so a future repository change
# fails closed instead of silently changing the staged runtime.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libpcre2-8-0=10.42-1+deb12u1 \
 && rm -rf /var/lib/apt/lists/*

# The staged application is self-contained and uses Node built-ins only. Remove package
# managers from the final runtime so npm-bundled libraries (including node-tar) are not
# an exposed production attack surface. WFM does not require privileged helper binaries,
# so remove every setuid/setgid transition from the final filesystem as defense in depth.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
 && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
          /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx \
 && find / -xdev -type f \( -perm /4000 -o -perm /2000 \) -print -exec chmod a-s {} + \
 && test -z "$(find / -xdev -type f \( -perm /4000 -o -perm /2000 \) -print -quit)"
USER node
ENV NODE_ENV=staging
EXPOSE 3000
CMD ["node","server.cjs"]
