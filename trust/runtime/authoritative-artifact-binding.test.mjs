import assert from 'node:assert/strict';
import test from 'node:test';

import { bindAuthoritativeArtifact } from './authoritative-artifact-binding.mjs';

test('binds exact delivered bytes to independently reconstructed authoritative facts', () => {
  const sourceFacts = { id: 'batch-1', rows: [{ employee: 'e1', minutes: 450 }] };
  const proof = bindAuthoritativeArtifact({
    sourceFacts,
    deliveredArtifact: 'batch-1|e1|450\n',
    renderAuthoritativeArtifact: facts => `${facts.id}|${facts.rows[0].employee}|${facts.rows[0].minutes}\n`
  });

  assert.equal(proof.authoritativeContentBound, true);
  assert.equal(proof.deliveryMatchesAuthoritativeBytes, true);
  assert.match(proof.sourceFactsSha256, /^[a-f0-9]{64}$/);
  assert.match(proof.artifactSha256, /^[a-f0-9]{64}$/);
});

test('renders from an immutable canonical snapshot so the renderer cannot mutate the facts being proven', () => {
  const sourceFacts = { id: 'batch-2', rows: [{ employee: 'e2', minutes: 360 }] };
  let renderedFrom;

  bindAuthoritativeArtifact({
    sourceFacts,
    deliveredArtifact: 'batch-2|e2|360\n',
    renderAuthoritativeArtifact: facts => {
      renderedFrom = facts;
      assert.notEqual(facts, sourceFacts);
      assert.equal(Object.isFrozen(facts), true);
      assert.equal(Object.isFrozen(facts.rows), true);
      assert.equal(Object.isFrozen(facts.rows[0]), true);
      assert.throws(() => { facts.rows[0].minutes = 999; }, TypeError);
      return `${facts.id}|${facts.rows[0].employee}|${facts.rows[0].minutes}\n`;
    }
  });

  assert.equal(renderedFrom.rows[0].minutes, 360);
  assert.equal(sourceFacts.rows[0].minutes, 360);
});

test('rejects jointly altered artifact metadata when authoritative source facts reconstruct different bytes', () => {
  assert.throws(() => bindAuthoritativeArtifact({
    sourceFacts: { id: 'batch-1', gross: '150.00' },
    deliveredArtifact: 'batch-1,999.00\n',
    renderAuthoritativeArtifact: facts => `${facts.id},${facts.gross}\n`
  }), error => {
    assert.equal(error.code, 'VECTOR_AUTHORITATIVE_ARTIFACT_MISMATCH');
    assert.notEqual(error.expectedSha256, error.deliveredSha256);
    return true;
  });
});

test('rejects executable, hidden and non-finite source evidence before proof creation', () => {
  const accessor = {};
  Object.defineProperty(accessor, 'gross', { enumerable: true, get() { return '150.00'; } });
  assert.throws(() => bindAuthoritativeArtifact({
    sourceFacts: accessor,
    deliveredArtifact: 'x',
    renderAuthoritativeArtifact: () => 'x'
  }), /executable or hidden data/);

  assert.throws(() => bindAuthoritativeArtifact({
    sourceFacts: { gross: Number.NaN },
    deliveredArtifact: 'x',
    renderAuthoritativeArtifact: () => 'x'
  }), /non-finite number/);
});
