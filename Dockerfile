FROM node:22.16.0-bookworm-slim
WORKDIR /app
RUN node -e "(async()=>{const fs=require('fs');const u='https://b6a76830-3899-4ad5-a1d9-427f063f5e71.sandbox.floot.app/_cdn/static/98e675cf-4cbe-4146-bd3b-866fd6713c56-wfm-0.6.70-hosted-staging-rc6.tgz';const r=await fetch(u,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('artifact download '+r.status);fs.writeFileSync('/tmp/runtime.tgz',Buffer.from(await r.arrayBuffer()))})().catch(e=>{console.error(e);process.exit(1)})" \
 && echo "89666f0b3118fa262fda5764f07915fde07492f816fa9ac8140b560089f6f3e0  /tmp/runtime.tgz" | sha256sum -c - \
 && tar -xzf /tmp/runtime.tgz -C /app \
 && rm -f /tmp/runtime.tgz
ENV NODE_ENV=staging
EXPOSE 3000
CMD ["node","server.cjs"]
