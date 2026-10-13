const COMMIT_SHA = /^[0-9a-f]{40}$/;
const PROOF_HEADERS = Object.freeze({
  'x-wfm-source-binding': 'build-file-matched',
  'x-wfm-fixture-only': 'true',
});

function validCaptureId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function headerValues(rawHeaders, name) {
  if (!Array.isArray(rawHeaders)) return null;
  if (!rawHeaders.every(pair => Array.isArray(pair) && pair.length === 2
    && typeof pair[0] === 'string' && typeof pair[1] === 'string')) return null;
  return rawHeaders.filter(([key]) => key.toLowerCase() === name).map(([, value]) => value);
}

// Evaluates raw HTTP response captures. The capture producer and hosted source
// identity must be verified separately; this result never grants release authority.
export function assessSourceIdentityResponses(input = {}) {
  const failures = [];
  const candidateSha = input.candidateSha;
  const expected = input.expectedRequests;
  const responses = input.responses;
  if (typeof candidateSha !== 'string' || !COMMIT_SHA.test(candidateSha)) failures.push('invalid_candidate_sha');
  if (!Array.isArray(expected) || expected.length === 0) failures.push('missing_expected_requests');
  if (!Array.isArray(responses)) failures.push('missing_response_captures');
  if (failures.length) return { status: 'FAIL', failures, checked: 0, hostedProof: false };

  const expectedById = new Map();
  for (const request of expected) {
    if (!validCaptureId(request?.captureId) || !/^[A-Z]+$/.test(request?.method ?? '')
      || typeof request.path !== 'string' || !request.path.startsWith('/api/')
      || !Number.isInteger(request.status) || request.status < 100 || request.status > 599) {
      failures.push('invalid_expected_request');
      continue;
    }
    if (expectedById.has(request.captureId)) failures.push(`duplicate_expected:${request.captureId}`);
    else expectedById.set(request.captureId, request);
  }

  const seen = new Set();
  for (const response of responses) {
    const id = response?.captureId;
    if (!validCaptureId(id) || !expectedById.has(id)) {
      failures.push('unexpected_response');
      continue;
    }
    if (seen.has(id)) {
      failures.push(`duplicate_response:${id}`);
      continue;
    }
    seen.add(id);
    const request = expectedById.get(id);
    if (response.method !== request.method || response.path !== request.path || response.status !== request.status) {
      failures.push(`request_mismatch:${id}`);
    }
    const required = { ...PROOF_HEADERS, 'x-wfm-source-sha': candidateSha };
    for (const [name, value] of Object.entries(required)) {
      const actual = headerValues(response.headers, name);
      if (actual === null) failures.push(`unverifiable_raw_headers:${id}`);
      else if (actual.length !== 1 || actual[0] !== value) failures.push(`source_header_mismatch:${id}:${name}`);
    }
  }
  for (const id of expectedById.keys()) if (!seen.has(id)) failures.push(`missing_response:${id}`);

  return {
    status: failures.length ? 'FAIL' : 'PASS',
    failures,
    checked: seen.size,
    hostedProof: false,
  };
}
