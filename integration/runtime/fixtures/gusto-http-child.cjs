'use strict';

// Test-only HTTP boundary. Provider I/O is replaced; the hub, routes and SQLite
// lifecycle are the product implementations under test.
const http = require('node:http');
const path = require('node:path');
const hubPath = process.env.VECTOR_IMAGE_ADMISSION_ROOT
  ? path.join(process.env.VECTOR_IMAGE_ADMISSION_ROOT, 'integration-runtime/autonomous-integration-hub.cjs')
  : path.join(__dirname, '../autonomous-integration-hub.cjs');
const { createAutonomousIntegrationHub } = require(hubPath);

const COMPANY = '11111111-1111-4111-8111-111111111111';
const env = {
  WFM_GUSTO_CLIENT_ID: 'fixture-client',
  WFM_GUSTO_CLIENT_SECRET: 'fixture-client-secret',
  WFM_GUSTO_TOKEN_ENCRYPTION_KEY_B64: Buffer.alloc(32, 7).toString('base64'),
  WFM_PUBLIC_ORIGIN: 'https://vector.example.test',
  WFM_GUSTO_ENVIRONMENT: 'sandbox'
};
let denial = null;
const fetchImpl = async (url, init = {}) => {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://api.gusto-demo.com') throw new Error('Unexpected provider origin');
  if (parsed.pathname !== '/oauth/token' && init.method !== 'GET')
    throw new Error('Unexpected provider write');
  if (parsed.pathname === '/oauth/token') return Response.json({
    access_token: 'fixture-access-token', refresh_token: 'fixture-refresh-token',
    expires_in: 7200, token_type: 'Bearer'
  });
  if (parsed.pathname === '/v1/token_info') {
    if (denial === 'forbidden') return Response.json({ error: 'private-provider-detail' }, { status: 403 });
    return Response.json({
      scope: denial === 'missing-scope' ? 'employees:read' : 'companies:read employees:read payrolls:read',
      resource: { type: 'Company', uuid: denial === 'wrong-company'
        ? '22222222-2222-4222-8222-222222222222' : COMPANY },
      resource_owner: { type: 'CompanyAdmin', uuid: 'not-the-company' }
    });
  }
  if (parsed.pathname === '/v1/companies/' + COMPANY)
    return Response.json({ uuid: COMPANY, name: 'Fixture company' });
  throw new Error('Unexpected provider request');
};

const hub = createAutonomousIntegrationHub({
  dbPath: process.argv[2], env, fetchImpl, internalToken: 'fixture-worker'
});
const server = http.createServer(async (req, res) => {
  try {
    if (!await hub.handleRequest(req, res) && !res.writableEnded) {
      res.statusCode = 404;
      res.end();
    }
  } catch {
    if (!res.writableEnded) { res.statusCode = 500; res.end(); }
  }
});
process.on('message', message => {
  if (message?.type === 'denial') {
    denial = message.value;
    process.send({ type: 'denial-set' });
  }
});
process.on('disconnect', () => { server.close(); hub.close(); });
server.listen(0, '127.0.0.1', () => process.send({ type: 'ready', port: server.address().port }));
