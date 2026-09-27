import http from 'node:http';

const port = Number(process.env.PORT || 3000);
let state = {
  schemaVersion: 1,
  status: 'PENDING',
  candidateSha: process.env.WFM_EXPECTED_CANDIDATE_SHA || null,
  target: process.env.VECTOR_PROOF_URL || null,
  startedAt: new Date().toISOString()
};

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  if (req.url === '/health') {
    res.statusCode = state.status === 'PASS' ? 200 : 503;
    return res.end(JSON.stringify({ service: 'vector-browser-proof-runner', status: state.status, candidateSha: state.candidateSha }));
  }
  if (req.url === '/proof') {
    res.statusCode = state.status === 'PASS' ? 200 : state.status === 'FAIL' ? 503 : 202;
    return res.end(JSON.stringify(state));
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(port, '0.0.0.0', () => {
  console.log('VECTOR_BROWSER_PROOF_RUNNER_LISTENING=' + port);
});

try {
  await import('./current-candidate-role-browser-proof.mjs');
  state = { ...state, status: 'PASS', finishedAt: new Date().toISOString() };
  console.log('VECTOR_BROWSER_PROOF_RUNNER=PASS candidateSha=' + state.candidateSha);
} catch (error) {
  state = {
    ...state,
    status: 'FAIL',
    finishedAt: new Date().toISOString(),
    error: String(error?.stack || error?.message || error).slice(0, 6000)
  };
  console.error('VECTOR_BROWSER_PROOF_RUNNER=FAIL candidateSha=' + state.candidateSha);
  console.error(state.error);
}
