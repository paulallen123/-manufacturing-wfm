'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSemanticEdgeBridge } = require('./industrial-signal-envelope.cjs');

const scope = { tenantId: 't1', siteId: 's1', publisherId: 'edge-1', writerId: 7 };
const config = [{ ...scope, namespaceUri: 'urn:factory:line-a', fields: {
  Running: { signalClass: 'machine-state', assetId: 'press-1', unit: 'boolean' },
  Energy: { signalClass: 'energy', assetId: 'press-1', unit: 'kWh' },
} }];
const metadata = (version = 1) => ({ MessageId: `meta-${version}`, MessageType: 'ua-metadata', PublisherId: 'edge-1', DataSetWriterId: 7,
  WriterGroupName: 'line', DataSetWriterName: 'press', Timestamp: '2026-10-12T10:00:00Z',
  MetaData: { ConfigurationVersion: { MajorVersion: version, MinorVersion: 0 }, Fields: [{ Name: 'Running' }, { Name: 'Energy' }] } });
const data = (sequence, payload = { Running: { Value: true, StatusCode: 0, SourceTimestamp: '2026-10-12T10:00:01Z' } }, version = 1) => ({
  MessageId: `data-${sequence}`, MessageType: 'ua-data', PublisherId: 'edge-1', Messages: [{ DataSetWriterId: 7,
    MetaDataVersion: { MajorVersion: version, MinorVersion: 0 }, SequenceNumber: sequence,
    Timestamp: '2026-10-12T10:00:01Z', Status: 0, Payload: payload }],
});
const context = { tenantId: 't1', siteId: 's1', receivedAt: '2026-10-12T10:00:02Z' };
const send = (bridge, message, overrides = {}) => bridge.ingest({ ...context, ...overrides, topic: message.MessageType === 'ua-metadata' ? 'metadata' : 'data/press', payload: JSON.stringify(message) });

test('metadata-bound read-only signal preserves identity, source timing and quality', () => {
  const bridge = createSemanticEdgeBridge({ mappings: config, freshnessMs: 60000 });
  assert.equal(send(bridge, metadata()).status, 'metadata-accepted');
  const result = send(bridge, data(1));
  assert.equal(result.status, 'applied');
  assert.equal(result.signals.length, 1);
  assert.deepEqual(result.signals[0].scope, { tenantId: 't1', siteId: 's1' });
  assert.equal(result.signals[0].source.namespaceUri, 'urn:factory:line-a');
  assert.equal(result.signals[0].source.writerId, 7);
  assert.equal(result.signals[0].source.sourceTimestamp, '2026-10-12T10:00:01.000Z');
  assert.equal(result.signals[0].source.ingestedAt, '2026-10-12T10:00:02.000Z');
  assert.equal(result.signals[0].source.metadataVersion, '1:0');
  assert.equal(result.signals[0].shadowOnly, true);
  assert.equal(result.signals[0].executionPermitted, false);
  assert.match(result.signals[0].provenanceHash, /^[a-f0-9]{64}$/);
});

test('scope, metadata, revision, freshness, quality and replay all fail closed', () => {
  const bridge = createSemanticEdgeBridge({ mappings: config, freshnessMs: 60000 });
  assert.equal(send(bridge, data(1)).status, 'metadata-missing');
  assert.equal(send(bridge, metadata(), { tenantId: 'other' }).status, 'scope-rejected');
  send(bridge, metadata());
  assert.equal(send(bridge, data(1), { siteId: 'other' }).status, 'scope-rejected');
  assert.equal(send(bridge, data(1, undefined, 2)).status, 'metadata-version-mismatch');
  assert.equal(send(bridge, data(1, { Running: { Value: true, StatusCode: 0x80000000, SourceTimestamp: '2026-10-12T10:00:01Z' } })).status, 'quality-rejected');
  assert.equal(send(bridge, data(1), { receivedAt: '2026-10-12T10:02:00Z' }).status, 'stale');
  assert.equal(send(bridge, data(1)).status, 'applied');
  assert.equal(send(bridge, data(1)).status, 'replay');
  assert.equal(send(bridge, data(0)).status, 'out-of-order');
  assert.equal(send(bridge, data(2, { Unknown: { Value: true, StatusCode: 0, SourceTimestamp: '2026-10-12T10:00:01Z' } })).status, 'unmapped');
});

test('malformed and command inputs cannot be accepted as telemetry', () => {
  const bridge = createSemanticEdgeBridge({ mappings: config });
  assert.equal(bridge.ingest({ ...context, topic: 'commands/press', payload: '{}' }).status, 'topic-rejected');
  assert.equal(bridge.ingest({ ...context, topic: 'data/press', payload: '{' }).status, 'invalid-payload');
  assert.equal(bridge.ingest({ ...context, topic: 'data/press', payload: ' '.repeat(70000) }).status, 'payload-too-large');
  assert.equal(send(bridge, { ...data(1), MessageType: 'ua-action-request' }).status, 'message-type-rejected');
});

test('namespace and publisher mappings stay distinct even for same field name', () => {
  const bridge = createSemanticEdgeBridge({ mappings: [...config, { ...config[0], publisherId: 'edge-2', namespaceUri: 'urn:factory:line-b', fields: { Running: { signalClass: 'machine-state', assetId: 'press-2' } } }] });
  send(bridge, metadata());
  const otherMeta = { ...metadata(), PublisherId: 'edge-2' };
  send(bridge, otherMeta);
  const otherData = { ...data(1), PublisherId: 'edge-2' };
  assert.equal(send(bridge, data(1)).signals[0].source.namespaceUri, 'urn:factory:line-a');
  assert.equal(send(bridge, otherData).signals[0].source.namespaceUri, 'urn:factory:line-b');
});

test('ten thousand ordered, duplicate, old and cross-scope synthetic deliveries never apply an unsafe event', () => {
  const bridge = createSemanticEdgeBridge({ mappings: config, freshnessMs: 60000 });
  send(bridge, metadata());
  let applied = 0, rejected = 0;
  for (let i = 1; i <= 10000; i += 1) {
    const result = send(bridge, data(i));
    assert.equal(result.status, 'applied');
    applied += result.signals.length;
    if (i % 10 === 0) {
      for (const attempt of [send(bridge, data(i)), send(bridge, data(i - 1)), send(bridge, data(i + 1), { tenantId: 'other' })]) {
        assert.equal(attempt.signals.length, 0);
        rejected += 1;
      }
    }
  }
  assert.equal(applied, 10000);
  assert.equal(rejected, 3000);
});
