import http from 'node:http';

const port = Number(process.env.PORT || 3000);
const parkedAt = new Date().toISOString();
const state = {
  status: 'PARKED',
  reason: 'retired password-login persistence proof disabled for canonical VECTOR customer proof',
  canonicalService: 'vector-customer-gate-executor-0928',
  canonicalAuth: 'proof-runner-signed',
  parkedAt,
};

console.log('VECTOR_RETIRED_PASSWORD_LOGIN_PERSISTENCE_PROOF_PARKED=' + JSON.stringify(state));

http.createServer((req, res) => {
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(state));
}).listen(port, '0.0.0.0');
