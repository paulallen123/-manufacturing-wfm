FROM node:22.23.2-bookworm-slim@sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96
WORKDIR /app
COPY agency-labour/ /app/agency-labour/
RUN node /app/agency-labour/test.mjs \
 && node /app/agency-labour/protocol.test.mjs \
 && node /app/agency-labour/recovery.test.mjs
RUN chown -R root:root /app \
 && find /app -type d -exec chmod 0555 {} + \
 && find /app -type f -exec chmod 0444 {} +
USER node
ENV NODE_ENV=staging
EXPOSE 3000
CMD ["node","/app/agency-labour/server.mjs"]
