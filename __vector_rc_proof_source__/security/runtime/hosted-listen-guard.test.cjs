'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { installHostedListenGuard } = require('./hosted-listen-guard.cjs');

function fakeHttp() {
  function Server() {}
  Server.prototype.listen = function (...args) {
    this.lastListenArgs = args;
    return this;
  };
  return { Server };
}

test('local mode leaves loopback binding untouched', () => {
  const http = fakeHttp();
  installHostedListenGuard(http, { hosted: false });
  const server = new http.Server();
  server.listen(3000, '127.0.0.1');
  assert.deepEqual(server.lastListenArgs, [3000, '127.0.0.1']);
});

test('hosted mode changes only loopback host to all interfaces', () => {
  const http = fakeHttp();
  installHostedListenGuard(http, { hosted: true });
  const server = new http.Server();
  server.listen(3000, '127.0.0.1');
  assert.deepEqual(server.lastListenArgs, [3000, '0.0.0.0']);
});

test('hosted options form rewrites loopback without mutating caller options', () => {
  const http = fakeHttp();
  installHostedListenGuard(http, { hosted: true });
  const options = { port: 3000, host: 'localhost', backlog: 8 };
  const server = new http.Server();
  server.listen(options);
  assert.deepEqual(server.lastListenArgs[0], { port: 3000, host: '0.0.0.0', backlog: 8 });
  assert.equal(options.host, 'localhost');
});

test('hosted mode preserves explicit non-loopback and unix-socket bindings', () => {
  const http = fakeHttp();
  installHostedListenGuard(http, { hosted: true });
  const server = new http.Server();
  server.listen(3000, '10.0.0.5');
  assert.deepEqual(server.lastListenArgs, [3000, '10.0.0.5']);
  server.listen('/tmp/wfm.sock');
  assert.deepEqual(server.lastListenArgs, ['/tmp/wfm.sock']);
});
