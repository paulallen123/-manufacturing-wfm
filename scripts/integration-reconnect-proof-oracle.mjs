const hex64 = /^[a-f0-9]{64}$/i;

/** Compare captured hub status responses with independent read-only batch counts. */
export function evaluateIntegrationReconnectProof(receipts = {}) {
  const failures = [];
  const labels = ['before', 'outage', 'reconnect', 'after', 'replay'];
  const captures = labels.map(label => receipts[label]);
  for (let index = 0; index < captures.length; index++) {
    const receipt = captures[index];
    const label = labels[index];
    if (!receipt?.connection || !receipt.batchWitness) {
      failures.push(`${label} hub connection or independent batch witness missing`);
      continue;
    }
    for (const field of ['candidateSha', 'deploymentId', 'tenant', 'capturedAt']) {
      if (!receipt[field]) failures.push(`${label}.${field} missing`);
    }
    if (!hex64.test(String(receipt.candidateSha || ''))) failures.push(`${label}.candidateSha invalid`);
    if (!Number.isFinite(Date.parse(receipt.capturedAt || ''))) failures.push(`${label}.capturedAt invalid`);
    const connection = receipt.connection;
    if (!connection.id || !connection.sourceInstanceId || !Number.isSafeInteger(connection.mappingVersion) || connection.mappingVersion < 1) failures.push(`${label} connection identity invalid`);
    if (!connection.canonicalImport?.batchId || !hex64.test(String(connection.canonicalImport?.checksum || ''))) failures.push(`${label} canonical import missing`);
    if (!Number.isSafeInteger(receipt.batchWitness.count) || receipt.batchWitness.count < 1 || receipt.batchWitness.latestBatchId !== connection.canonicalImport?.batchId ||
        receipt.batchWitness.tenant !== receipt.tenant || receipt.batchWitness.connectionId !== connection.id || receipt.batchWitness.mappingVersion !== connection.mappingVersion ||
        receipt.batchWitness.latestChecksum !== connection.canonicalImport?.checksum) failures.push(`${label} scoped batch witness disagrees with hub`);
  }
  if (failures.length) return { status: 'BLOCKED', failures };

  const [before, outage, reconnect, after, replay] = captures;
  const initial = before.connection;
  for (let index = 1; index < captures.length; index++) {
    const receipt = captures[index];
    for (const field of ['candidateSha', 'deploymentId', 'tenant']) {
      if (receipt[field] !== before[field]) failures.push(`${labels[index]}.${field} changed`);
    }
    for (const field of ['id', 'sourceInstanceId', 'mappingVersion']) {
      if (receipt.connection[field] !== initial[field]) failures.push(`${labels[index]}.connection.${field} changed`);
    }
    if (Date.parse(receipt.capturedAt) <= Date.parse(captures[index - 1].capturedAt)) failures.push('capture order is not strictly increasing');
  }
  const sameImport = (a, b) => a.canonicalImport.batchId === b.canonicalImport.batchId && a.canonicalImport.checksum === b.canonicalImport.checksum;
  const validSync = c => c.state === 'ACTIVE' && c.grantedScopes?.includes('people.read') && c.lastReconciliation?.status === 'PASS' && c.canonicalImport?.status === 'PASS';
  const validProbe = (receipt, expected) => {
    const probe = receipt.sourceProbe;
    return probe?.status === expected && probe.tenant === receipt.tenant && probe.connectionId === receipt.connection.id &&
      probe.sourceInstanceId === receipt.connection.sourceInstanceId && Number.isFinite(Date.parse(probe.capturedAt || '')) &&
      Date.parse(probe.capturedAt) <= Date.parse(receipt.capturedAt) && Date.parse(probe.capturedAt) > Date.parse(before.capturedAt);
  };

  if (!validSync(initial)) failures.push('before is not an authorized validated source');
  if (outage.connection.state !== 'DEGRADED' || outage.connection.failureClass !== 'SOURCE' || !validProbe(outage, 'UNAVAILABLE')) failures.push('scoped source outage not observed');
  if (!sameImport(initial, outage.connection) || outage.batchWitness.count !== before.batchWitness.count) failures.push('outage changed imported state');
  if (!validSync(reconnect.connection) || !validProbe(reconnect, 'AVAILABLE') || Date.parse(reconnect.sourceProbe?.capturedAt || '') <= Date.parse(outage.capturedAt) || !sameImport(initial, reconnect.connection) || reconnect.batchWitness.count !== before.batchWitness.count) failures.push('reconnect changed imported state or lacks recovered source probe');
  if (!validSync(after.connection) || after.syncResponse?.status !== 200 || after.syncResponse?.canonicalImport?.replayed !== false) failures.push('post-reconnect sync not validated as new import');
  if (sameImport(initial, after.connection) || initial.canonicalImport.checksum === after.connection.canonicalImport.checksum || after.batchWitness.count !== before.batchWitness.count + 1) failures.push('post-reconnect canonical batch did not advance');
  if (after.syncResponse?.canonicalImport?.batchId !== after.connection.canonicalImport.batchId || after.syncResponse?.canonicalImport?.checksum !== after.connection.canonicalImport.checksum) failures.push('post-reconnect response differs from hub readback');
  if (!validSync(replay.connection) || replay.syncResponse?.status !== 200 || replay.syncResponse?.canonicalImport?.replayed !== true) failures.push('replay not validated as idempotent');
  if (!sameImport(after.connection, replay.connection) || replay.batchWitness.count !== after.batchWitness.count) failures.push('replay changed imported state');
  if (replay.syncResponse?.canonicalImport?.batchId !== after.connection.canonicalImport.batchId || replay.syncResponse?.canonicalImport?.checksum !== after.connection.canonicalImport.checksum) failures.push('replay response differs from hub readback');
  return { status: failures.length ? 'BLOCKED' : 'PASS', failures };
}
