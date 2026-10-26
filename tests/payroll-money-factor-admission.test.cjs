'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const createMoney = require('../operations/runtime/payroll-money.cjs');

for (const [name, money] of [['server', createMoney()], ['embedded browser', vm.runInNewContext('(' + createMoney.toString() + ')()')]]) {
  const price = allowances => money.components({durationMs:3600000,rate:10,allowances});
  test(name + ': incomplete allowance arrays cannot silently reduce pay', () => {
    for (const values of [new Array(1), [1,,2]]) {
      assert.throws(() => money.sum(values));
      assert.throws(() => price(values));
      assert.throws(() => money.factorKey([1], 'highest', values));
    }
  });
  test(name + ': inherited or accessor factors are not authoritative operands', () => {
    const inherited = new Array(1);
    Object.setPrototypeOf(inherited, Object.assign(Object.create(Array.prototype), {0:2}));
    let reads = 0;
    const accessor = [1];
    Object.defineProperty(accessor, '0', {get(){reads++;return 2;}});
    for (const values of [inherited, accessor]) {
      assert.throws(() => price(values));
      assert.throws(() => money.stack(values, 'additive'));
      assert.throws(() => money.stack(values, 'highest'));
    }
    assert.equal(reads, 0);
  });
  test(name + ': custom array traversal cannot substitute pay factors', () => {
    const values = [1.1, 1.2];
    values.reduce = () => [1000n,1n];
    values.some = () => false;
    values[Symbol.iterator] = function*(){yield 99;};
    assert.equal(money.sum(values), 2.3);
    assert.equal(money.stack(values, 'additive'), 1.3);
    assert.equal(money.stack(values, 'highest'), 1.2);
  });
  test(name + ': valid decimal rounding and explicit zero remain unchanged', () => {
    assert.equal(money.sum([]), 0);
    assert.equal(money.sum([0,0.1,0.2]), 0.3);
    assert.equal(money.stack([1.1,1.2,1.35], 'additive'), 1.65);
    assert.equal(money.stack([1,1.5,1.2], 'highest'), 1.5);
    assert.equal(money.components({durationMs:1800000,rate:8.03,oncostPercent:12.5,oncostHourly:0.1}).totalPence,457);
    assert.equal(price([]).grossPence,1000);
    assert.equal(money.factorKey([1], 'highest', [0.1,0.2]), money.factorKey([1], 'highest', [0.3]));
    for (const values of [[undefined],[null],['1'],[NaN],[Infinity],[-1],new Array(1001).fill(1)]) assert.throws(()=>price(values));
    assert.throws(()=>money.stack([], 'highest'));
  });
}
