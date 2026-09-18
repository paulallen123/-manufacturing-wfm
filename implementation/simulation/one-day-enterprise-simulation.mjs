'use strict';

const ITERATIONS = 100000;
const TARGET_MINUTES = 480;
const SEED = 20260918;

const PHASES = Object.freeze([
  ['tenant-environment', 5, 9, 15, []],
  ['identity-access', 5, 12, 20, ['tenant-environment']],
  ['source-systems', 10, 25, 45, ['identity-access']],
  ['people-data', 8, 18, 30, ['source-systems']],
  ['organisation-model', 8, 18, 30, ['people-data']],
  ['time-policies', 10, 25, 45, ['people-data']],
  ['absence-policies', 7, 16, 30, ['people-data']],
  ['scheduling', 10, 25, 45, ['organisation-model', 'time-policies']],
  ['approvals', 6, 14, 30, ['organisation-model', 'identity-access']],
  ['clocking', 7, 16, 30, ['identity-access', 'time-policies']],
  ['payroll-mapping', 10, 25, 45, ['source-systems', 'people-data', 'time-policies']],
  ['historical-replay', 20, 40, 60, ['payroll-mapping', 'time-policies']],
  ['security-controls', 8, 18, 30, ['tenant-environment', 'identity-access']],
  ['resilience', 8, 18, 30, ['source-systems', 'security-controls']],
  ['role-learning', 4, 8, 15, ['people-data']],
  ['privileged-competency', 35, 55, 90, ['role-learning', 'time-policies', 'scheduling', 'payroll-mapping', 'security-controls']],
  ['frontline-readiness', 8, 14, 20, ['role-learning', 'absence-policies', 'scheduling', 'clocking']]
]);

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function triangular(random, min, mode, max) {
  const u = random();
  const f = (mode - min) / (max - min);
  if (u < f) return min + Math.sqrt(u * (max - min) * (mode - min));
  return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

function humanDecisionDelay(random) {
  const u = random();
  if (u < 0.82) return random() * 20;
  if (u < 0.97) return 20 + random() * 55;
  return 75 + random() * 105;
}

function percentile(sorted, p) {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

function runSimulation(iterations = ITERATIONS, seed = SEED) {
  const random = mulberry32(seed);
  const totals = [];
  const critical = [];

  for (let i = 0; i < iterations; i++) {
    const finish = new Map();
    for (const [key, min, mode, max, dependencies] of PHASES) {
      const start = dependencies.length
        ? Math.max(...dependencies.map(dep => finish.get(dep)))
        : 0;
      finish.set(key, start + triangular(random, min, mode, max));
    }

    const base = Math.max(...finish.values());
    const total = base + humanDecisionDelay(random);
    critical.push(base);
    totals.push(total);
  }

  critical.sort((a, b) => a - b);
  totals.sort((a, b) => a - b);
  const withinTarget = totals.filter(value => value <= TARGET_MINUTES).length / totals.length;

  return {
    model: 'SYNTHETIC_THEORY_ONLY',
    prerequisite: 'Customer admin access/consent and source-system authority available at activation.',
    iterations,
    seed,
    targetMinutes: TARGET_MINUTES,
    criticalPath: {
      p50Minutes: Number(percentile(critical, 0.50).toFixed(1)),
      p95Minutes: Number(percentile(critical, 0.95).toFixed(1)),
      p99Minutes: Number(percentile(critical, 0.99).toFixed(1))
    },
    includingHumanDecisionLatency: {
      p50Minutes: Number(percentile(totals, 0.50).toFixed(1)),
      p95Minutes: Number(percentile(totals, 0.95).toFixed(1)),
      p99Minutes: Number(percentile(totals, 0.99).toFixed(1)),
      maxMinutes: Number(totals[totals.length - 1].toFixed(1)),
      withinEightHoursPercent: Number((withinTarget * 100).toFixed(3))
    },
    claimBoundary: 'Architecture timing simulation only. Not customer, production, payroll or implementation evidence.'
  };
}

const result = runSimulation();
process.stdout.write(JSON.stringify(result, null, 2) + '\n');

if (process.argv.includes('--assert-target')) {
  if (
    result.includingHumanDecisionLatency.p99Minutes > TARGET_MINUTES ||
    result.includingHumanDecisionLatency.withinEightHoursPercent < 99
  ) {
    process.stderr.write('Synthetic one-day architecture target failed.\n');
    process.exitCode = 1;
  }
}

export { runSimulation };
