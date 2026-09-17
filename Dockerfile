FROM node:22.16.0-bookworm-slim
WORKDIR /app
RUN node -e "(async()=>{const fs=require('fs');const u='https://b6a76830-3899-4ad5-a1d9-427f063f5e71.sandbox.floot.app/_cdn/static/393f846c-18eb-497d-ad42-1cbb0f044d81-wfm-0.6.70-hosted-staging-rc5.tgz';const r=await fetch(u,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('artifact download '+r.status);fs.writeFileSync('/tmp/runtime.tgz',Buffer.from(await r.arrayBuffer()))})().catch(e=>{console.error(e);process.exit(1)})" \
 && echo "5fbe9c2923890c410cf6d7184f7678409da92cf3c6b485a217de60d6259a9931  /tmp/runtime.tgz" | sha256sum -c - \
 && tar -xzf /tmp/runtime.tgz -C /app \
 && rm -f /tmp/runtime.tgz
ENV NODE_ENV=staging
EXPOSE 3000
CMD ["node","server.cjs"]
