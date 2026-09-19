# Development-only proof harness. The frozen WFM candidate remains on its separate immutable branch/service.
FROM node:22.23.2-bookworm-slim@sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96
WORKDIR /proof
COPY scripts/private-kiosk-proof.mjs /proof/private-kiosk-proof.mjs
RUN chown -R root:root /proof \
 && find /proof -type d -exec chmod 0555 {} + \
 && find /proof -type f -exec chmod 0444 {} +
USER node
ENV NODE_ENV=staging
EXPOSE 3000
CMD ["node","/proof/private-kiosk-proof.mjs"]
