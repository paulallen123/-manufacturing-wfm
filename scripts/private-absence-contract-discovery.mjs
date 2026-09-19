import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const targetBase = (process.env.PROOF_TARGET_BASE || '').replace(/\/$/, '');
const browserOrigin = (process.env.PROOF_BROWSER_ORIGIN || '').replace(/\/$/, '');
const expectedRelease = '0.6.76-hosted-staging-rc1';
assert.ok(targetBase.startsWith('http://') || targetBase.startsWith('https://'), 'PROOF_TARGET_BASE missing');
assert.ok(targetBase.includes('.railway.internal'), 'Proof target must stay on Railway private networking');
assert.ok(browserOrigin.startsWith('https://'), 'PROOF_BROWSER_ORIGIN missing');
const target = new URL(targetBase);
const browserHost = new URL(browserOrigin).host;
const hostedHeaders = { host: browserHost, 'x-forwarded-host': browserHost, 'x-forwarded-proto': 'https' };

async function request(path) {
  const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
  return await new Promise((resolve, reject) => {
    const req = transport({ protocol: target.protocol, hostname: target.hostname, port: target.port || undefined, method: 'GET', path, headers: hostedHeaders, timeout: 20000 }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

const health = await request('/api/health');
assert.equal(health.status, 200, 'private health failed');
const h = JSON.parse(health.text);
assert.equal(h.release, expectedRelease, 'release identity mismatch');
assert.equal(h.fixtureOnly, true, 'fixture-only boundary required');
assert.equal(h.productionApproved, false, 'production approval must remain false');
console.log(`HEALTH_PASS ${h.release}`);

const root = await request('/');
assert.equal(root.status, 200, `root failed ${root.status}`);
const assetMatches = [...root.text.matchAll(/(?:src|href)=["']([^"']+\.(?:js|mjs))["']/gi)].map(m => m[1]);
assetMatches.push('/value-cockpit-ui.js');
const assets = [...new Set(assetMatches.map(x => x.startsWith('http') ? new URL(x).pathname : (x.startsWith('/') ? x : `/${x}`)))];
assert.ok(assets.length > 0, 'no JS assets discovered');

const keyword = /(leave|absence|holiday|time\s*off|entitlement)/ig;
const apiRegex = /\/api\/[A-Za-z0-9_?=&%./:-]+/g;
const hits = [];
for (const asset of assets) {
  const r = await request(asset);
  if (r.status !== 200) continue;
  const text = r.text;
  let m;
  while ((m = keyword.exec(text))) {
    const start = Math.max(0, m.index - 700);
    const end = Math.min(text.length, m.index + 1200);
    const snippet = text.slice(start, end);
    const apis = [...new Set(snippet.match(apiRegex) || [])];
    if (apis.length) hits.push({ asset, keyword: m[0], apis, snippet: snippet.replace(/\s+/g, ' ').slice(0, 1600) });
    if (hits.length >= 30) break;
  }
  if (hits.length >= 30) break;
}
assert.ok(hits.length > 0, 'no absence/leave API contract found in served frozen candidate');
const apis = [...new Set(hits.flatMap(h => h.apis))].sort();
console.log(`ABSENCE_API_CANDIDATES=${apis.join('|')}`);
for (const hit of hits.slice(0, 12)) console.log(`ABSENCE_CONTRACT_HIT asset=${hit.asset} keyword=${hit.keyword} apis=${hit.apis.join(',')} snippet=${hit.snippet}`);
console.log('PRIVATE_ABSENCE_CONTRACT_DISCOVERY=PASS');

httpRequest({ host: '0.0.0.0', port: Number(process.env.PORT || 3000) }, () => {}).on('error', () => {});
import('node:http').then(({createServer}) => createServer((req,res)=>{res.statusCode=200;res.setHeader('content-type','text/plain');res.end('proof-pass\n');}).listen(Number(process.env.PORT||3000),'0.0.0.0'));
