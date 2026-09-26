'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('customer runtime packages and routes durable outcome learning service',()=>{
  const root=path.resolve(__dirname,'..');
  const docker=fs.readFileSync(path.join(root,'Dockerfile'),'utf8');
  const bootstrap=fs.readFileSync(path.join(root,'security/runtime/bootstrap.cjs'),'utf8');

  assert.match(
    docker,
    /COPY operations\/runtime\/outcome-learning-service\.cjs \/app\/operations-runtime\/outcome-learning-service\.cjs/,
    'customer image must package the verified outcome learning service'
  );
  assert.match(
    bootstrap,
    /createOutcomeLearningService.*outcome-learning-service\.cjs/,
    'bootstrap must load the outcome learning service'
  );
  assert.match(
    bootstrap,
    /function outcomeLearningPath\(req\)[\s\S]*\/api\/learning\/outcomes/,
    'bootstrap must identify only the dedicated outcome-learning route'
  );
  assert.match(
    bootstrap,
    /outcomeLearningService\s*=\s*createOutcomeLearningService\(\{\s*dbPath:\s*process\.env\.WFM_DB\s*\}\)/,
    'bootstrap must initialise learning on the durable customer database'
  );
  assert.match(
    bootstrap,
    /routeOverlay\(outcomeLearningService,\s*outcomeLearningServiceInitError,\s*res,\s*'Operational outcome learning',\s*req\)/,
    'bootstrap must route the dedicated learning endpoint through fail-closed overlay handling'
  );
});
