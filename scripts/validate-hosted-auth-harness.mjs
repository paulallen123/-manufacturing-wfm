import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function has(re, source) {
  return re.test(source);
}

export function inspectHostedAuthHarness(source, name = '<inline>') {
  const findings = [];
  // Comments cannot establish a header capture, cookie check, or transport policy.
  const executable = source.split(/\r?\n/).filter(line => !/^\s*#/.test(line)).join('\n');
  const hosted = has(/WFM_HOSTED_STAGING\s*(?:=|:)\s*["']?true\b/i, executable) || has(/-e\s+WFM_HOSTED_STAGING=true\b/i, executable);
  const login = has(/\/api\/login\b/i, executable);
  if (!hosted || !login) return { name, result: 'PASS', findings };

  const loopbackLogin = has(/http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/api\/login\b/i, executable);
  const anyExternalPlainHttpLogin = has(/http:\/\/(?!127\.0\.0\.1(?::\d+)?\/|localhost(?::\d+)?\/)[A-Za-z0-9._-]+(?::\d+)?\/api\/login\b/i, executable);
  const cookieJarWrite = has(/(?:^|[\s\\])(?:-c\s+|--cookie-jar(?:=|\s+))[^\s\\]+/m, executable);
  const cookieJarReplay = has(/(?:^|[\s\\])(?:-b\s+|--cookie(?:=|\s+))[^\s\\]+/m, executable);
  // Include literal, variable, and multiline headers. Header content is never authority.
  const explicitCookieHeader = has(/(?:-H|--header)(?:=|\s+)(?:["'][^"']*Cookie\s*:|Cookie\s*:)/i, executable);
  const capturesHeaders = has(/(?:^|[\s\\])(?:-D\s+|--dump-header(?:=|\s+))[^\s\\]+/m, executable);
  const provesSetCookie = has(/set-cookie:/i, executable);
  const provesSecure = has(/set-cookie:[^\n]*Secure|grep[^\n]*Secure[^\n]*login\.headers/i, executable);

  if (loopbackLogin && cookieJarWrite && cookieJarReplay && !explicitCookieHeader) {
    findings.push({
      code: 'PLAIN_HTTP_SECURE_COOKIE_JAR_ORACLE',
      severity: 'error',
      message: 'Hosted-staging authentication is being judged through a curl cookie jar over plain loopback HTTP. Use real TLS, or explicitly validate Set-Cookie and replay the session token only inside the isolated loopback harness.'
    });
  }

  if (loopbackLogin && explicitCookieHeader && !(capturesHeaders && provesSetCookie && provesSecure)) {
    findings.push({
      code: 'LOOPBACK_SESSION_COOKIE_NOT_PROVEN',
      severity: 'error',
      message: 'Explicit loopback session replay must first prove the login response emitted the expected Secure Set-Cookie contract.'
    });
  }

  if (anyExternalPlainHttpLogin && explicitCookieHeader) {
    findings.push({
      code: 'AUTH_COOKIE_ON_NON_LOOPBACK_HTTP',
      severity: 'error',
      message: 'Explicit authentication-cookie replay is forbidden over non-loopback plain HTTP.'
    });
  }

  return { name, result: findings.some(f => f.severity === 'error') ? 'FAIL' : 'PASS', findings };
}

function collectYamlFiles(root) {
  const out = [];
  const visit = p => {
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(p)) visit(path.join(p, entry));
      return;
    }
    if (/\.ya?ml$/i.test(p)) out.push(p);
  };
  visit(root);
  return out.sort();
}

function runFixtures(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  let failed = 0;
  for (const testCase of data.cases ?? []) {
    const result = inspectHostedAuthHarness(testCase.source, testCase.name);
    const expectedCodeOk = !testCase.expected_code || result.findings.some(f => f.code === testCase.expected_code);
    const ok = result.result === testCase.expected && expectedCodeOk;
    console.log(`HOSTED_AUTH_FIXTURE=${testCase.name}|expected=${testCase.expected}|actual=${result.result}|codes=${result.findings.map(f => f.code).join(',') || 'none'}|${ok ? 'PASS' : 'FAIL'}`);
    if (!ok) failed += 1;
  }
  if (failed) {
    console.error(`HOSTED_AUTH_FIXTURES=FAIL|failed=${failed}`);
    process.exitCode = 1;
  } else {
    console.log(`HOSTED_AUTH_FIXTURES=PASS|cases=${data.cases.length}`);
  }
}

function runScan(root) {
  const files = collectYamlFiles(root);
  const violations = [];
  for (const file of files) {
    const result = inspectHostedAuthHarness(fs.readFileSync(file, 'utf8'), file);
    for (const finding of result.findings) violations.push({ file, ...finding });
  }
  console.log(`HOSTED_AUTH_SCAN_FILES=${files.length}`);
  if (violations.length) {
    for (const v of violations) console.error(`HOSTED_AUTH_VIOLATION=${v.code}|file=${v.file}|${v.message}`);
    console.error(`HOSTED_AUTH_HARNESS_SCAN=FAIL|violations=${violations.length}`);
    process.exitCode = 1;
  } else {
    console.log('HOSTED_AUTH_HARNESS_SCAN=PASS|violations=0');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === '--fixtures' && args[1]) {
    runFixtures(args[1]);
  } else if (args[0] === '--scan' && args[1]) {
    runScan(args[1]);
  } else {
    console.error('Usage: node scripts/validate-hosted-auth-harness.mjs --fixtures <json> | --scan <directory>');
    process.exitCode = 2;
  }
}
