import { createHash } from 'node:crypto';

function fail(message) {
  throw new Error(message);
}

function canonical(value, path = 'source') {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${path} contains a non-finite number`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail(`${path} must be a plain array`);
    if (Object.keys(value).length !== value.length) fail(`${path} contains sparse, hidden, or extra values`);
    return `[${value.map((item, index) => canonical(item, `${path}[${index}]`)).join(',')}]`;
  }
  if (!value || typeof value !== 'object') fail(`${path} contains unsupported data`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${path} must be plain data`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value).sort()) {
    if (typeof key !== 'string') fail(`${path} contains symbol data`);
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !('value' in descriptor)) fail(`${path}.${key} contains executable or hidden data`);
    parts.push(`${JSON.stringify(key)}:${canonical(descriptor.value, `${path}.${key}`)}`);
  }
  return `{${parts.join(',')}}`;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function bytes(value, name) {
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  fail(`${name} must be a string, Buffer, or Uint8Array`);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function bindAuthoritativeArtifact({ sourceFacts, deliveredArtifact, renderAuthoritativeArtifact }) {
  if (typeof renderAuthoritativeArtifact !== 'function') fail('renderAuthoritativeArtifact must be a function');

  const sourceCanonical = canonical(sourceFacts);
  const authoritativeSnapshot = deepFreeze(JSON.parse(sourceCanonical));
  const expectedBytes = bytes(
    renderAuthoritativeArtifact(authoritativeSnapshot),
    'authoritative artifact'
  );
  const deliveredBytes = bytes(deliveredArtifact, 'delivered artifact');

  if (!expectedBytes.equals(deliveredBytes)) {
    const error = new Error('Delivered artifact does not match authoritative source reconstruction byte for byte.');
    error.code = 'VECTOR_AUTHORITATIVE_ARTIFACT_MISMATCH';
    error.expectedSha256 = sha256(expectedBytes);
    error.deliveredSha256 = sha256(deliveredBytes);
    throw error;
  }

  return Object.freeze({
    authoritativeContentBound: true,
    sourceFactsSha256: sha256(Buffer.from(sourceCanonical, 'utf8')),
    artifactSha256: sha256(expectedBytes),
    sizeBytes: expectedBytes.length,
    deliveryMatchesAuthoritativeBytes: true
  });
}
