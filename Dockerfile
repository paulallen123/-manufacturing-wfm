FROM node:22.16.0-bookworm-slim
WORKDIR /app
RUN node -e "(async()=>{const fs=require('fs');const u='https://b6a76830-3899-4ad5-a1d9-427f063f5e71.sandbox.floot.app/_cdn/static/a2fa233e-8768-45fe-a7d2-83530a62a066-wfm-0.6.70-hosted-staging-runtime.tar.xz';const r=await fetch(u);if(!r.ok)throw new Error('artifact download '+r.status);fs.writeFileSync('/tmp/runtime.tar.xz',Buffer.from(await r.arrayBuffer()))})().catch(e=>{console.error(e);process.exit(1)})" \
 && echo "3b39402fcabcbe5267915561474684b010427110b0b5f38562af4d4624b6a181  /tmp/runtime.tar.xz" | sha256sum -c - \
 && tar -xJf /tmp/runtime.tar.xz -C /app \
 && rm -f /tmp/runtime.tar.xz
ENV NODE_ENV=staging
EXPOSE 3000
CMD ["node","server.cjs"]
