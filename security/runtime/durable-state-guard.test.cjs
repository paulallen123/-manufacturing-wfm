'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { proveDurableDb, parseMountPoints } = require('./durable-state-guard.cjs');

const mounted = [
  '25 20 0:22 / / rw,relatime - overlay overlay rw',
  '42 25 8:1 /vector-proof /data rw,relatime - ext4 /dev/volume rw'
].join('\n');

test('durable state accepts a database under a distinct mounted volume', () => {
  const result = proveDurableDb({ dbPath: '/data/wfm.sqlite', mountInfo: mounted });
  assert.equal(result.status, 'PASS');
  assert.equal(result.mountPoint, '/data');
});

test('durable state rejects /tmp even if container root is mounted', () => {
  assert.throws(() => proveDurableDb({ dbPath: '/tmp/wfm.sqlite', mountInfo: mounted }), /refuses ephemeral/);
});

test('durable state rejects a path that only resolves to container root', () => {
  assert.throws(() => proveDurableDb({ dbPath: '/state/wfm.sqlite', mountInfo: mounted }), /distinct mounted volume/);
});

test('durable state rejects the application image path', () => {
  assert.throws(() => proveDurableDb({ dbPath: '/app/state.sqlite', mountInfo: mounted }), /refuses ephemeral/);
});

test('mount parser preserves the deepest durable mount first', () => {
  const mounts = parseMountPoints(mounted + '\n43 42 8:2 /nested /data/nested rw - ext4 /dev/nested rw');
  assert.equal(mounts[0], '/data/nested');
});
