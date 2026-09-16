FROM node:22.16.0-bookworm-slim
WORKDIR /app
COPY artifact/ /tmp/artifact/
RUN cat /tmp/artifact/runtime.b64.* | base64 -d > /tmp/runtime.tgz \
 && echo "b5344cbd866320c3e7afcb177f2cc1f6060118af6780fedf33c9764d25c1935f  /tmp/runtime.tgz" | sha256sum -c - \
 && tar -xzf /tmp/runtime.tgz -C /app \
 && rm -rf /tmp/artifact /tmp/runtime.tgz
ENV NODE_ENV=staging
EXPOSE 3000
CMD ["node","server.cjs"]
