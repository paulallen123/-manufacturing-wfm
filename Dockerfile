FROM node:22.23.2-bookworm-slim
WORKDIR /app
RUN node -e "(async()=>{const fs=require('fs');const u='https://b6a76830-3899-4ad5-a1d9-427f063f5e71.sandbox.floot.app/_cdn/static/7fd30064-0e04-43f9-9d5a-d08467fb7304-wfm-0.6.70-hosted-staging-rc2.tgz';const r=await fetch(u,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('artifact download '+r.status);fs.writeFileSync('/tmp/runtime.tgz',Buffer.from(await r.arrayBuffer()))})().catch(e=>{console.error(e);process.exit(1)})" \
 && echo "ecb59f71218b0be62d815471259b916cfe595a97ebbc166a554e167d176cf37c  /tmp/runtime.tgz" | sha256sum -c - \
 && tar -xzf /tmp/runtime.tgz -C /app \
 && rm -f /tmp/runtime.tgz
ENV NODE_ENV=staging
EXPOSE 3000
CMD ["node","server.cjs"]
