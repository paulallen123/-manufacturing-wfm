import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableOutcomeLedger } from './durable-outcome-ledger.mjs';

const outcome = () => ({
  tenantScope: 'synthetic-tenant', source: 'synthetic-outcome-ledger',
  category: 'scheduling', fingerprint: 'shift-cover', baseline: 1, result: 2,
  verified: true, evidenceRef: 'synthetic-proof-1', createdAt: '2026-10-30T00:00:00.000Z',
});
function ledgerFor(t) {
  const directory = mkdtempSync(join(tmpdir(), 'vector-v123-inert-'));
  const ledger = new DurableOutcomeLedger({ path: join(directory, 'outcomes.sqlite') });
  t.after(() => { ledger.close(); rmSync(directory, { recursive: true, force: true }); });
  return ledger;
}

test('proxy evidence is rejected before prototype, descriptor, key or value traps', t => {
  const ledger = ledgerFor(t);
  let traps = 0;
  const proxy = new Proxy(outcome(), {
    getPrototypeOf(target) { traps++; return Reflect.getPrototypeOf(target); },
    ownKeys(target) { traps++; return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) { traps++; return Reflect.getOwnPropertyDescriptor(target, key); },
    get(target, key, receiver) { traps++; return Reflect.get(target, key, receiver); },
  });
  assert.throws(() => ledger.ingestOutcome(proxy), /OUTCOME_INERT_RECORD_REQUIRED/);
  assert.equal(traps, 0);
  assert.equal(ledger.snapshot().outcomes.length, 0);
});

test('a proxy cannot validate one amount and persist a changed amount', t => {
  const ledger = ledgerFor(t);
  let resultReads = 0;
  const proxy = new Proxy(outcome(), {
    get(target, key, receiver) {
      if (key === 'result') return ++resultReads <= 2 ? 2 : 999;
      return Reflect.get(target, key, receiver);
    },
  });
  assert.throws(() => ledger.ingestOutcome(proxy), /OUTCOME_INERT_RECORD_REQUIRED/);
  assert.equal(resultReads, 0);
  assert.equal(ledger.snapshot().outcomes.length, 0);
});

test('changing own getters are denied without reading or committing evidence', t => {
  const ledger = ledgerFor(t);
  for (const field of ['tenantScope', 'source', 'result']) {
    const input = outcome();
    let reads = 0;
    Object.defineProperty(input, field, { enumerable: true, get() { reads++; return reads === 1 ? 2 : 999; } });
    assert.throws(() => ledger.ingestOutcome(input), /OUTCOME_INERT_RECORD_REQUIRED/);
    assert.equal(reads, 0);
  }
  assert.equal(ledger.snapshot().outcomes.length, 0);
});

test('plain JSON, frozen and null-prototype evidence preserve one stable receipt', t => {
  const ledger = ledgerFor(t);
  const input = outcome();
  const expected = ledger.ingestOutcome(JSON.parse(JSON.stringify(input)));
  const frozen = Object.freeze(outcome());
  const nullPrototype = Object.assign(Object.create(null), outcome());
  const literalPrototypeKey = JSON.parse(JSON.stringify(input).replace(/}$/, ',"__proto__":"literal"}'));
  for (const record of [input, frozen, nullPrototype, literalPrototypeKey]) {
    assert.deepEqual(ledger.ingestOutcome(record), expected);
  }
  assert.equal(ledger.snapshot().outcomes.length, 1);
  assert.equal(ledger.snapshot().skills.length, 0);
});
