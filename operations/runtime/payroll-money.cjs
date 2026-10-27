'use strict';

// Embedded unchanged in the shared browser/server cost module by the composer.
// Decimal inputs remain rational until the existing pay-component rounding point.
module.exports = function createPayrollMoney() {
  // Keep the factory self-contained: the composer embeds it in browser code.
  const isArray = Array.isArray, descriptor = Object.getOwnPropertyDescriptor;
  const hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty);
  function factors(values, minimum, nonempty) {
    if (!isArray(values)) throw Error('Invalid pay-factor collection.');
    const length = descriptor(values, 'length').value;
    if (length > 1000 || (nonempty && !length)) throw Error('Invalid pay-factor collection.');
    const result = Object.create(null);
    result.length = length;
    for (let i = 0; i < length; i++) {
      const field = descriptor(values, String(i));
      if (!field || !hasOwn(field, 'value')) throw Error('Pay factors require dense own data entries.');
      const value = field.value;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) throw Error('Invalid pay factor.');
      result[i] = value;
    }
    return result;
  }
  const add = (a, b) => [a[0] * b[1] + b[0] * a[1], a[1] * b[1]];
  const multiply = (a, b) => [a[0] * b[0], a[1] * b[1]];
  function decimal(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw Error('Pay calculation requires finite non-negative decimal inputs.');
    }
    const [coefficient, exponentText = '0'] = String(value).toLowerCase().split('e');
    const [whole, fraction = ''] = coefficient.split('.');
    const scale = fraction.length - Number(exponentText);
    const integer = BigInt(whole + fraction);
    return scale < 0 ? [integer * 10n ** BigInt(-scale), 1n] : [integer, 10n ** BigInt(scale)];
  }
  function roundedPence(value) {
    if (value[0] < 0n) throw Error('Negative pay components require a reviewed adjustment.');
    const result = (value[0] * 2n + value[1]) / (value[1] * 2n);
    if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('Pay component exceeds safe integer pence.');
    return Number(result);
  }
  function asDecimalNumber(value) {
    // All sums here have power-of-ten denominators. Parse one exact decimal string.
    const scale = value[1].toString().length - 1;
    const digits = value[0].toString().padStart(scale + 1, '0');
    const result = Number(scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits);
    if (!Number.isFinite(result)) throw Error('Pay factor exceeds finite decimal range.');
    return result;
  }
  function sumRatio(values) {
    const entries = factors(values, 0, false);
    let total = [0n, 1n];
    for (let i = 0; i < entries.length; i++) total = add(total, decimal(entries[i]));
    return total;
  }
  function stackRatio(values, mode) {
    const entries = factors(values, 1, true);
    if (mode === 'highest') {
      let highest = entries[0];
      for (let i = 1; i < entries.length; i++) if (entries[i] > highest) highest = entries[i];
      return decimal(highest);
    }
    if (mode !== 'additive') throw Error('Unknown pay multiplier stacking rule.');
    let total = [0n, 1n];
    for (let i = 0; i < entries.length; i++) total = add(total, decimal(entries[i]));
    total[0] -= BigInt(entries.length - 1) * total[1];
    return total;
  }
  // Numeric aggregates are for row labels only; pricing receives original operands.
  const sum = values => asDecimalNumber(sumRatio(values));
  const stack = (values, mode) => asDecimalNumber(stackRatio(values, mode));
  function factorKey(multipliers, stacking, allowances) {
    const reduced = ([numerator, denominator]) => {
      let a = numerator, b = denominator;
      while (b) { const remainder = a % b; a = b; b = remainder; }
      return String(numerator / a) + '/' + String(denominator / a);
    };
    return reduced(stackRatio(multipliers, stacking)) + ':' + reduced(sumRatio(allowances));
  }
  function components({ durationMs, rate, multiplier = 1, multipliers, stacking, otMultiplier = 1, allowance = 0, allowances, oncostPercent = 0, oncostHourly = 0 }) {
    const hours = multiply(decimal(durationMs), [1n, 3600000n]);
    const hourly = decimal(rate), factor = multipliers === undefined ? decimal(multiplier) : stackRatio(multipliers, stacking), overtime = decimal(otMultiplier);
    if (factor[0] < factor[1] || overtime[0] < overtime[1] || factor[0] * overtime[1] < overtime[0] * factor[1]) throw Error('Invalid pay-component multipliers.');
    const fixed = allowances === undefined ? decimal(allowance) : sumRatio(allowances);
    const inPence = amount => roundedPence(multiply(amount, [100n, 1n]));
    const basePence = inPence(multiply(hours, hourly));
    const grossPence = inPence(multiply(hours, add(multiply(hourly, factor), fixed)));
    const overtimePremiumPence = Math.min(grossPence - basePence, inPence(multiply(multiply(hours, hourly), [overtime[0] - overtime[1], overtime[1]])));
    const oncostPence = roundedPence(add(multiply([BigInt(grossPence), 100n], decimal(oncostPercent)), multiply(multiply(hours, decimal(oncostHourly)), [100n, 1n])));
    const totalPence = grossPence + oncostPence;
    if (!Number.isSafeInteger(totalPence)) throw Error('Total cost exceeds safe integer pence.');
    return { basePence, grossPence, overtimePremiumPence, otherPremiumPence: grossPence - basePence - overtimePremiumPence, oncostPence, totalPence };
  }
  return Object.freeze({ components, sum, stack, factorKey });
};

