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

# Patch PCRE2 in the pinned Bookworm base to Debian's fixed security build.
# The exact version pin makes repository drift fail closed.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libpcre2-8-0=10.42-1+deb12u1 \
 && rm -rf /var/lib/apt/lists/*

# The sealed WFM runtime is Node-builtins-only. Remove dormant interpreters,
# decompression/terminal tools and privileged filesystem utilities that are not part of
# the application execution path. Package metadata is intentionally retained so scanners
# can still report source-package CVEs and the VEX gate must explain them explicitly.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
          /usr/lib/x86_64-linux-gnu/perl-base /usr/share/perl /usr/share/perl5 \
 && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
          /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx \
          /usr/bin/perl /usr/bin/perl5.36.0 \
          /usr/bin/mount /usr/bin/umount /usr/bin/nsenter \
          /usr/bin/gzip /bin/gzip /usr/bin/infocmp \
          /usr/bin/getfacl /usr/bin/setfacl \
          /usr/bin/homectl /usr/lib/systemd/systemd-homed \
          /sbin/mount.* /usr/sbin/mount.* \
 && find /usr -type f \( -path '*/Archive/Tar.pm' -o -path '*/IO/Compress/*' -o -path '*/IO/Uncompress/*' -o -path '*/Storable.pm' \) -delete \
 && find / -xdev -type f \( -perm /4000 -o -perm /2000 \) -print -exec chmod a-s {} + \
 && test -z "$(find / -xdev -type f \( -perm /4000 -o -perm /2000 \) -print -quit)"

# A compromised Node process must not be able to rewrite the sealed application or its
# identity guard. Runtime state lives outside /app (hosted staging uses explicit WFM_DB).
RUN chown -R root:root /app \
 && find /app -type d -exec chmod 0555 {} + \
 && find /app -type f -exec chmod 0444 {} +

USER node
ENV NODE_ENV=staging
ENV WFM_IDENTITY_SURVIVAL_GUARD=enforce
EXPOSE 3000
CMD ["node","security-runtime/bootstrap.cjs"]
