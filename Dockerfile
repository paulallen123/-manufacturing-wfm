FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /proof
RUN npm init -y >/dev/null 2>&1 && npm install --no-audit --no-fund --save-exact playwright@1.63.0
COPY scripts/current-candidate-role-browser-proof.mjs /proof/current-candidate-role-browser-proof.mjs
COPY scripts/browser-proof-runner.mjs /proof/browser-proof-runner.mjs
ENV NODE_ENV=production
CMD ["node", "/proof/browser-proof-runner.mjs"]
