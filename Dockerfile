FROM node:22.23.2-bookworm-slim
WORKDIR /proof
COPY operations/runtime/outcome-learning-service.test.cjs operations/runtime/outcome-learning-service.test.cjs
COPY operations/runtime/decision-episode.cjs operations/runtime/decision-episode.cjs
COPY operations/runtime/decision-outcome-proof.cjs operations/runtime/decision-outcome-proof.cjs
COPY adaptive-intelligence/engine.mjs adaptive-intelligence/engine.mjs
RUN node --test operations/runtime/outcome-learning-service.test.cjs
CMD ["node","-e","setInterval(()=>{},1000000)"]
