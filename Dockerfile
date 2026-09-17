# Customer-proof staging build: sealed 0.6.76 runtime
FROM node:22.23.2-bookworm-slim@sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96
WORKDIR /app
COPY artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz /tmp/runtime.tgz
COPY ux/ux-role-shell.css /tmp/ux-role-shell.css
COPY ux/ux-role-shell.js /tmp/ux-role-shell.js
RUN echo "3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d  /tmp/runtime.tgz" | sha256sum -c - \
 && tar -xzf /tmp/runtime.tgz -C /app \
 && rm -f /tmp/runtime.tgz \
 && cp /tmp/ux-role-shell.css /app/public/ux-role-shell.css \
 && cp /tmp/ux-role-shell.js /app/public/ux-role-shell.js \
 && node -e "const fs=require('fs');const p='/app/public/index.html';let s=fs.readFileSync(p,'utf8');if(!s.includes('ux-role-shell.css'))s=s.replace('</head>','<link rel=\"stylesheet\" href=\"ux-role-shell.css\">\\n</head>');if(!s.includes('ux-role-shell.js'))s=s.replace('</body>','<script src=\"ux-role-shell.js\"></script>\\n</body>');fs.writeFileSync(p,s)" \
 && rm -f /tmp/ux-role-shell.css /tmp/ux-role-shell.js \
 && chown -R node:node /app
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
