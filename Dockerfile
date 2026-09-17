FROM node:22.16.0-bookworm-slim
WORKDIR /app
RUN node -e "(async()=>{const fs=require('fs');const u='https://b6a76830-3899-4ad5-a1d9-427f063f5e71.sandbox.floot.app/_cdn/static/57f7ba78-dfba-4e86-8924-f2c422496426-wfm-0.6.70-hosted-staging-rc4.tgz';const r=await fetch(u,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('artifact download '+r.status);fs.writeFileSync('/tmp/runtime.tgz',Buffer.from(await r.arrayBuffer()))})().catch(e=>{console.error(e);process.exit(1)})" \
 && echo "c99f0ffb724978cb758eb16237b293791fe1e9aeca9d395d8c4238283789f380  /tmp/runtime.tgz" | sha256sum -c - \
 && tar -xzf /tmp/runtime.tgz -C /app \
 && rm -f /tmp/runtime.tgz
ENV NODE_ENV=staging
EXPOSE 3000
CMD ["node","server.cjs"]
