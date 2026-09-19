import http from 'node:http';

let state = 'RUNNING';
let detail = null;

const body = () => JSON.stringify({
  status: state,
  candidateSha: process.env.WFM_EXPECTED_CANDIDATE_SHA,
  claimBoundary: 'fixture/demo browser proof only; production approval and real-provider claims remain false',
  detail
});

const server = http.createServer((req, res) => {
  res.statusCode = state === 'FAIL' ? 503 : 200;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(body());
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(Number(process.env.PORT || 3000), '0.0.0.0', resolve);
});
console.log('BROWSER_PROOF_SERVER=READY');

try {
  await import('./current-candidate-role-browser-proof.mjs');
  state = 'PASS';
  console.log('BROWSER_PROOF_SERVER=PASS');
} catch (error) {
  state = 'FAIL';
  detail = String(error?.stack || error);
  console.error(`BROWSER_PROOF_SERVER=FAIL\n${detail}`);
  setTimeout(() => process.exit(1), 1000).unref();
}
