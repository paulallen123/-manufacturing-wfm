FROM node:22.23.2-bookworm-slim@sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96
WORKDIR /app
COPY artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz /tmp/runtime.tgz
RUN echo "6444bf808ee0d666c77d5815dc36dcc41417252a5f77e4e3ba45f27f3c643f57  /tmp/runtime.tgz" | sha256sum -c - \
 && tar -xzf /tmp/runtime.tgz -C /app \
 && rm -f /tmp/runtime.tgz \
 && chown -R node:node /app
USER node
ENV NODE_ENV=staging
EXPOSE 3000
CMD ["node","server.cjs"]
