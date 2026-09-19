import http from 'node:http';

await import('./current-candidate-role-browser-proof.mjs');

const body = JSON.stringify({
  status: 'PASS',
  candidateSha: process.env.WFM_EXPECTED_CANDIDATE_SHA,
  claimBoundary: 'fixture/demo browser proof only; production approval and real-provider claims remain false'
});

http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(body);
}).listen(Number(process.env.PORT || 3000), '0.0.0.0');
