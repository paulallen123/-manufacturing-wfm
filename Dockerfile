FROM node:22.23.2-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5

RUN apt-get update \
 && apt-get install -y --no-install-recommends tar gzip \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz /tmp/runtime.tgz

RUN echo "6444bf808ee0d666c77d5815dc36dcc41417252a5f77e4e3ba45f27f3c643f57  /tmp/runtime.tgz" | sha256sum -c - \
 && tar -xzf /tmp/runtime.tgz -C /app \
 && chown -R node:node /app \
 && rm -f /tmp/runtime.tgz

ENV NODE_ENV=staging
EXPOSE 3000

USER node
CMD ["node","server.cjs"]
