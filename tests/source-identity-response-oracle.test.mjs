import test from 'node:test';
import assert from 'node:assert/strict';
import { assessSourceIdentityResponses } from '../scripts/source-identity-response-oracle.mjs';

const SHA = 'f62f1e9f6d993d3f90ff19f8178275803e5b7d3f';
const OTHER = '517f58670009709ded4178f47e66bbe7059bfa0e';
const headers = () => [
  ['X-WFM-Source-SHA', SHA],
  ['X-WFM-Source-Binding', 'build-file-matched'],
  ['X-WFM-Fixture-Only', 'true'],
];
const expectedRequests = [
  { captureId: 'release', method: 'POST', path: '/api/payroll/release', status: 200 },
  { captureId: 'denial', method: 'GET', path: '/api/payroll/export', status: 403 },
];
const responses = () => expectedRequests.map(request => ({ ...request, headers: headers() }));
const input = () => ({ candidateSha: SHA, expectedRequests, responses: responses() });

test('accepts exact source headers on consequential success and denial captures', () => {
  const result = assessSourceIdentityResponses(input());
  assert.deepEqual(result, { status: 'PASS', failures: [], checked: 2, hostedProof: false });
});

test('a mismatch on one consequential response fails the whole matrix', () => {
  const data = input();
  data.responses[1].headers[0][1] = OTHER;
  assert.ok(assessSourceIdentityResponses(data).failures.includes('source_header_mismatch:denial:x-wfm-source-sha'));
});

test('raw duplicate proof headers fail instead of being merged away', () => {
  const data = input();
  data.responses[0].headers.push(['x-wfm-source-sha', OTHER]);
  assert.ok(assessSourceIdentityResponses(data).failures.includes('source_header_mismatch:release:x-wfm-source-sha'));
});

test('a plain header object is insufficient to prove header multiplicity', () => {
  const data = input();
  data.responses[0].headers = Object.fromEntries(headers());
  assert.ok(assessSourceIdentityResponses(data).failures.includes('unverifiable_raw_headers:release'));
});

test('missing, duplicate, or undeclared captures cannot satisfy coverage', () => {
  const missing = input();
  missing.responses.pop();
  assert.ok(assessSourceIdentityResponses(missing).failures.includes('missing_response:denial'));
  const duplicate = input();
  duplicate.responses.push(structuredClone(duplicate.responses[0]));
  assert.ok(assessSourceIdentityResponses(duplicate).failures.includes('duplicate_response:release'));
  const extra = input();
  extra.responses.push({ ...extra.responses[0], captureId: 'other' });
  assert.ok(assessSourceIdentityResponses(extra).failures.includes('unexpected_response'));
});

test('capture method, path, and status must match the declared journey', () => {
  for (const key of ['method', 'path', 'status']) {
    const data = input();
    data.responses[0][key] = key === 'status' ? 201 : 'wrong';
    assert.ok(assessSourceIdentityResponses(data).failures.includes('request_mismatch:release'));
  }
});

test('source binding and fixture boundary cannot be downgraded', () => {
  for (const [header, value] of [['X-WFM-Source-Binding', 'configured-only'], ['X-WFM-Fixture-Only', 'false']]) {
    const data = input();
    data.responses[0].headers.find(pair => pair[0] === header)[1] = value;
    assert.equal(assessSourceIdentityResponses(data).status, 'FAIL');
  }
});

test('missing candidate or expected response matrix fails closed', () => {
  assert.ok(assessSourceIdentityResponses({ ...input(), candidateSha: 'not-a-sha' }).failures.includes('invalid_candidate_sha'));
  assert.ok(assessSourceIdentityResponses({ ...input(), expectedRequests: [] }).failures.includes('missing_expected_requests'));
});
