import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const policy = JSON.parse(fs.readFileSync(new URL('../resilience/browser-security-floor.json', import.meta.url), 'utf8'));
export const minimumBrowserVersion = policy.minimum_version;

export function parseBrowserVersion(value) {
  const match = String(value || '').match(/\b(\d+)\.(\d+)\.(\d+)\.(\d+)\b/);
  if (!match) throw new Error(`Unable to parse four-component browser version from: ${String(value || '<empty>')}`);
  return match.slice(1).map(Number);
}

export function compareBrowserVersions(left, right) {
  const a = Array.isArray(left) ? left : parseBrowserVersion(left);
  const b = Array.isArray(right) ? right : parseBrowserVersion(right);
  for (let i = 0; i < 4; i += 1) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

export function browserVersionMeetsFloor(actual, minimum = minimumBrowserVersion) {
  return compareBrowserVersions(actual, minimum) >= 0;
}

function findApprovedChrome() {
  for (const candidate of ['google-chrome', 'google-chrome-stable']) {
    const which = spawnSync('which', [candidate], { encoding: 'utf8' });
    if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  }
  return '';
}

export function assertCurrentBrowserSecurityFloor() {
  const executable = findApprovedChrome();
  assert.ok(executable, 'BROWSER_FLOOR_APPROVED_CHROME_MISSING: approved Google Chrome executable is unavailable; refusing credential-bearing browser proof.');
  const versionResult = spawnSync(executable, ['--version'], { encoding: 'utf8' });
  assert.equal(versionResult.status, 0, `BROWSER_FLOOR_VERSION_UNAVAILABLE: unable to determine Google Chrome version from ${executable}.`);
  const raw = `${versionResult.stdout || ''} ${versionResult.stderr || ''}`.trim();
  const actual = parseBrowserVersion(raw).join('.');
  assert.ok(
    browserVersionMeetsFloor(actual),
    `BROWSER_FLOOR_TOO_OLD: Google Chrome ${actual} is below the WFM browser-proof security floor ${minimumBrowserVersion}; refusing provider credential retrieval.`
  );
  return { executable, actual, minimum: minimumBrowserVersion };
}

export function runSelfTest() {
  assert.ok(Array.isArray(policy.regression_tests) && policy.regression_tests.length > 0, 'Browser policy must contain regression cases.');
  for (const testCase of policy.regression_tests) {
    assert.equal(browserVersionMeetsFloor(testCase.actual), testCase.allowed, `Browser boundary regression for ${testCase.actual}`);
  }
  assert.equal(browserVersionMeetsFloor(minimumBrowserVersion), true, 'Published minimum must satisfy itself.');
  return { ok: true, minimum: minimumBrowserVersion, cases: policy.regression_tests.length, protectedPaths: policy.protected_paths.length };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const result = process.argv.includes('--self-test') ? runSelfTest() : assertCurrentBrowserSecurityFloor();
    console.log(`WFM_BROWSER_SECURITY_FLOOR=PASS ${JSON.stringify(result)}`);
  } catch (error) {
    console.error(`WFM_BROWSER_SECURITY_FLOOR=FAIL ${error.message}`);
    process.exitCode = 1;
  }
}
