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
  assert.ok(executable, 'Approved Google Chrome executable is unavailable. Refusing credential-bearing browser proof.');
  const versionResult = spawnSync(executable, ['--version'], { encoding: 'utf8' });
  assert.equal(versionResult.status, 0, `Unable to determine Google Chrome version from ${executable}. Refusing credential-bearing browser proof.`);
  const raw = `${versionResult.stdout || ''} ${versionResult.stderr || ''}`.trim();
  const actual = parseBrowserVersion(raw).join('.');
  assert.ok(
    browserVersionMeetsFloor(actual),
    `Google Chrome ${actual} is below the WFM browser-proof security floor ${minimumBrowserVersion}. Refusing to expose staging or demo credentials to a browser session.`
  );
  return { executable, actual, minimum: minimumBrowserVersion };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  const result = assertCurrentBrowserSecurityFloor();
  console.log(`CHROME_SECURITY_FLOOR=PASS actual=${result.actual} minimum=${result.minimum}`);
}
