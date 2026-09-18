'use strict';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'DEPLOYMENT_MANIFEST.json'), 'utf8'));
const artifact = path.join(root, manifest.runtime_artifact);
const outDir = path.join(root, 'proof-output');
fs.mkdirSync(outDir, { recursive: true });

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).replaceAll('\\', '/'));
  }
  return out;
}
function snippets(source, needle, radius = 700) {
  const out = [];
  let index = 0;
  while ((index = source.toLowerCase().indexOf(needle.toLowerCase(), index)) >= 0 && out.length < 20) {
    out.push(source.slice(Math.max(0, index - radius), Math.min(source.length, index + needle.length + radius)));
    index += needle.length;
  }
  return out;
}

assert.equal(fs.existsSync(artifact), true, 'Sealed runtime artifact is missing.');
assert.equal(sha256File(artifact), manifest.runtime_sha256, 'Sealed runtime digest mismatch.');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-runtime-inventory-'));
try {
  execFileSync('tar', ['-xzf', artifact, '-C', temp], { stdio: 'pipe' });
  const files = walk(temp).sort();
  const relevantFiles = files.filter(file => /payroll|pay|attendance|clock|time|support|onboard|training|learn/i.test(file));

  const serverPath = path.join(temp, 'server.cjs');
  assert.equal(fs.existsSync(serverPath), true, 'server.cjs missing from sealed runtime.');
  const server = fs.readFileSync(serverPath, 'utf8');
  const routes = [...new Set([...server.matchAll(/['"`](\/api\/[A-Za-z0-9_?&=\/.:{}-]+)['"`]/g)].map(match => match[1]))].sort();
  const payrollRoutes = routes.filter(route => /payroll|pay/i.test(route));
  const supportRoutes = routes.filter(route => /support|help/i.test(route));
  const implementationRoutes = routes.filter(route => /onboard|implement|readiness|company/i.test(route));
  const attendanceRoutes = routes.filter(route => /time|clock|attendance|absence|shift|schedule/i.test(route));

  const tableNames = [...new Set([...server.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_]+)/gi)].map(match => match[1]))].sort();
  const payrollTableNames = tableNames.filter(name => /payroll|pay|wage|earning/i.test(name));
  const timeTableNames = tableNames.filter(name => /time|clock|attendance|shift|absence|schedule/i.test(name));

  const result = {
    schemaVersion: 1,
    proof: 'sealed-runtime-capability-inventory',
    status: 'PASS',
    candidate: manifest.candidate,
    runtimeSha256: manifest.runtime_sha256,
    runtimeFiles: files.length,
    relevantFiles,
    routes: {
      payroll: payrollRoutes,
      support: supportRoutes,
      implementation: implementationRoutes,
      attendance: attendanceRoutes
    },
    schema: {
      allTableNames: tableNames,
      payrollTableNames,
      timeTableNames
    },
    sourceEvidence: {
      payrollSnippets: snippets(server, 'payroll'),
      supportSnippets: snippets(server, 'support'),
      clockSnippets: snippets(server, 'clock')
    },
    claimBoundary: 'Static inventory of the exact sealed runtime used by the current hosted staging candidate. This does not itself prove throughput or payroll correctness; it identifies the authoritative runtime surfaces to drive in the next live-scale gate.'
  };

  fs.writeFileSync(path.join(outDir, 'sealed-runtime-capability-inventory.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({
    status: result.status,
    candidate: result.candidate,
    runtimeFiles: result.runtimeFiles,
    relevantFiles: result.relevantFiles,
    payrollRoutes: result.routes.payroll,
    supportRoutes: result.routes.support,
    payrollTableNames: result.schema.payrollTableNames,
    timeTableNames: result.schema.timeTableNames
  }, null, 2));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
