'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateBoundedBuildHold } = require('./railway-bounded-build-hold.cjs');

const held = {
  source: { rootDirectory: '/__security_hold_built_ui_audit_closed__' },
  build: {
    rootDirectory: '/__security_hold_built_ui_audit_closed__',
    dockerfilePath: '__security_manual_redeploy_hold__/Dockerfile',
    watchPatterns: ['__security_hold_built_ui_audit_closed__/**']
  },
  variableNames: ['WFM_STAGING_PASSWORD']
};

test('passes only the exact bounded hold shape for credential-bearing services', () => {
  assert.equal(evaluateBoundedBuildHold(held).ok, true);
});

test('blocks a normal source root', () => {
  assert.equal(evaluateBoundedBuildHold({ ...held, source: { rootDirectory: '/' }, build: { ...held.build, rootDirectory: '/' } }).ok, false);
});

test('blocks a real Dockerfile path that could execute repository build code', () => {
  assert.equal(evaluateBoundedBuildHold({ ...held, build: { ...held.build, dockerfilePath: 'Dockerfile' } }).ok, false);
});

test('blocks ordinary watch patterns that allow Git-triggered rebuilds', () => {
  assert.equal(evaluateBoundedBuildHold({ ...held, build: { ...held.build, watchPatterns: ['scripts/**'] } }).ok, false);
});

test('does not force a hold on a service with no credential-like variable names', () => {
  assert.equal(evaluateBoundedBuildHold({ build: {}, variableNames: ['PORT'] }).ok, true);
});
