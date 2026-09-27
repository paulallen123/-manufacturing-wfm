FROM node:22-alpine
WORKDIR /proof
COPY scripts/policy-discovery-proof.mjs /proof/policy-discovery-proof.mjs
ENV NODE_ENV=production
CMD ["node","/proof/policy-discovery-proof.mjs"]
