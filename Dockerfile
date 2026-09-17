FROM node:22.16.0-bookworm-slim
WORKDIR /app
RUN node -e "(async()=>{const fs=require('fs');const u='https://b6a76830-3899-4ad5-a1d9-427f063f5e71.sandbox.floot.app/_cdn/static/0e7802b6-c0c3-41ac-84c4-c171f8dc98ec-wfm-0.6.70-hosted-staging-runtime.tgz';const r=await fetch(u,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('artifact download '+r.status);fs.writeFileSync('/tmp/runtime.tgz',Buffer.from(await r.arrayBuffer()))})().catch(e=>{console.error(e);process.exit(1)})" \
 && echo "f9704a40a78bbfd9961184250fe1a6143ba68f7cab23f40b30935c99afee6d6a  /tmp/runtime.tgz" | sha256sum -c - \
 && tar -xzf /tmp/runtime.tgz -C /app \
 && rm -f /tmp/runtime.tgz
ENV NODE_ENV=staging
EXPOSE 3000
CMD ["node","server.cjs"]
