'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const { applyCrawlerBoundary } = require('./crawler-boundary.cjs');

async function request(hosted, path, method = 'GET') {
  const server = http.createServer((req, res) => {
    if (applyCrawlerBoundary(req, res, { hosted })) return;
    res.end('fixture sign-in');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    return await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.address().port, path, method }, res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
      req.on('error', reject);
      req.end();
    });
  } finally {
    server.close();
  }
}

test('hosted fixture pages and APIs declare no indexing', async () => {
  for (const path of ['/', '/api/health']) {
    const response = await request(true, path);
    assert.equal(response.status, 200);
    assert.equal(response.headers['x-robots-tag'], 'noindex, nofollow, noarchive');
  }
});

test('hosted robots policy denies every crawler path and supports HEAD', async () => {
  const response = await request(true, '/robots.txt');
  assert.equal(response.status, 200);
  assert.match(response.body, /^User-agent: \*\nDisallow: \/\n$/);
  assert.equal(response.headers['content-type'], 'text/plain; charset=utf-8');
  assert.equal(response.headers['x-robots-tag'], 'noindex, nofollow, noarchive');
  const head = await request(true, '/robots.txt', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
});

test('non-hosted development responses keep their own crawler policy', async () => {
  const response = await request(false, '/');
  assert.equal(response.headers['x-robots-tag'], undefined);
});
