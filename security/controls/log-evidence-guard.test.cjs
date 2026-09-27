'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectLogText, MAX_LINE_LENGTH } = require('./log-evidence-guard.cjs');

const b64 = 'A'.repeat(5000);

test('allows hash-only screenshot evidence', () => {
  assert.equal(inspectLogText('CURRENT_MANAGER_SCREENSHOT_META|bytes=8504|sha=abc123').ok, true);
});

test('blocks the observed screenshot payload form', () => {
  const result = inspectLogText(`CURRENT_MANAGER_SCREENSHOT_B64|${b64}`);
  assert.equal(result.ok, false);
  assert.ok(result.findings.some(f => f.rule === 'screenshot-base64-payload'));
});

test('blocks marker variations used to bypass exact matching', () => {
  for (const line of [
    `manager_screenshot_base64=${b64}`,
    `foo SCREENSHOT_B64:${b64}`,
    `data:image/jpeg;base64,${b64}`
  ]) assert.equal(inspectLogText(line).ok, false);
});

test('blocks large anonymous base64 blobs', () => {
  const result = inspectLogText(b64);
  assert.equal(result.ok, false);
  assert.ok(result.findings.some(f => f.rule === 'large-base64-payload'));
});

test('blocks telemetry-suppressing oversized lines even when not base64', () => {
  const result = inspectLogText('x'.repeat(MAX_LINE_LENGTH + 1));
  assert.equal(result.ok, false);
  assert.ok(result.findings.some(f => f.rule === 'oversized-log-line'));
});
