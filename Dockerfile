FROM node:22.23.2-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5

WORKDIR /app
COPY artifact/ /tmp/artifact/

RUN test -n "$(find /tmp/artifact -maxdepth 1 -type f -name 'runtime.b64.*' -print -quit)" \
 && cat /tmp/artifact/runtime.b64.* | base64 -d > /tmp/runtime.tgz \
 && echo "b5344cbd866320c3e7afcb177f2cc1f6060118af6780fedf33c9764d25c1935f  /tmp/runtime.tgz" | sha256sum -c - \
 && tar -xzf /tmp/runtime.tgz -C /app \
 && chown -R node:node /app \
 && rm -rf /tmp/artifact /tmp/runtime.tgz

ENV NODE_ENV=staging
EXPOSE 3000

USER node
CMD ["node","server.cjs"]
