'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

// Regression boundary: retiring review-ui.js must not remove time-review-ui.js,
// or any asset that merely mentions a retired filename in its directory/query.
function compose(t, tags) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-index-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'vector-workflows.js'), '/* fixture controller */\n');
  fs.writeFileSync(path.join(directory, 'index.html'), '<!doctype html><html><head>' + tags.filter(tag => /^<link/i.test(tag)).join('\n') + '</head><body>' + tags.filter(tag => !/^<link/i.test(tag)).join('\n') + '<script src="payroll-intelligence-ui.js"></script></body></html>');
  execFileSync(process.execPath, [path.join(__dirname, 'compose-vector-presentation.mjs'), directory], { stdio: 'pipe' });
  const once = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
  execFileSync(process.execPath, [path.join(__dirname, 'compose-vector-presentation.mjs'), directory], { stdio: 'pipe' });
  assert.equal(fs.readFileSync(path.join(directory, 'index.html'), 'utf8'), once, 'composition is repeatable without deleting or duplicating active assets');
  return once;
}

test('composition retains Time Review JavaScript and styles while removing the retired review UI', t => {
  const active = ['<script src="time-review-ui.js"></script>', '<link rel="stylesheet" href="time-review-ui.css">'];
  const retired = ['<script src="review-ui.js"></script>', '<link rel="stylesheet" href="review-ui.css">'];
  const html = compose(t, [...active, ...retired]);
  for (const tag of active) assert.ok(html.includes(tag), 'active dependency must survive: ' + tag);
  for (const tag of retired) assert.ok(!html.includes(tag), 'retired entry must be absent: ' + tag);
});

test('composition compares exact asset basenames across relative, root, absolute and queried URLs', t => {
  const variants = [
    ['review-ui.js', 'review-ui.css'],
    ['./review-ui.js?v=7', './review-ui.css?v=7#theme'],
    ['/assets/review-ui.js#v7', '/assets/review-ui.css?theme=light'],
    ['https://cdn.example.test/v1/review-ui.js?v=7', 'https://cdn.example.test/v1/review-ui.css?v=7'],
    ['//cdn.example.test/v1/review-ui.js?v=7', '//cdn.example.test/v1/review-ui.css?v=7']
  ];
  const removed = variants.flatMap(([js, css], index) => [`<script data-case="retired-js-${index}" src = '${js}'></script>`, `<link data-case="retired-css-${index}" href = '${css}' rel="stylesheet">`]);
  const kept = [
    '<script data-case="active-time" src="/time-review-ui.js?v=2"></script>',
    '<link data-case="active-time-css" href="https://cdn.example.test/time-review-ui.css?theme=light">',
    '<script data-case="active-suffix" src="/preview-review-ui.js"></script>',
    '<script data-case="active-extension" src="/review-ui.js.backup.js"></script>',
    '<script data-case="active-query" src="/current-ui.js?replaces=review-ui.js"></script>',
    '<script data-case="active-directory" src="/review-ui.js/current.js"></script>',
    '<script data-case="data-src" data-src="review-ui.js" src="current.js"></script>',
    '<script data-case="inline">const reference = "review-ui.js";</script>'
  ];
  const html = compose(t, [...removed, ...kept]);
  for (const tag of removed) assert.ok(!html.includes(tag), 'remove exact retired basename: ' + tag);
  for (const tag of kept) assert.ok(html.includes(tag), 'preserve unrelated asset: ' + tag);
});

test('Docker presentation admission accepts Time Review but rejects exact retired references and files', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-admission-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const html = '<html><head><link href="time-review-ui.css"><link href="/vector-ui.css"></head><body><script src="time-review-ui.js"></script><script src="/vector-workflows.js"></script><script src="payroll-intelligence-ui.js"></script><script src="/vector-ui.js"></script></body></html>';
  fs.writeFileSync(path.join(directory, 'index.html'), html);
  for (const name of ['vector-ui.js', 'vector-ui.css', 'vector-workflows.js']) fs.writeFileSync(path.join(directory, name), '/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */');
  const verify = () => spawnSync(process.execPath, [path.join(__dirname, 'compose-vector-presentation.mjs'), directory, '--verify'], { encoding: 'utf8' });
  assert.equal(verify().status, 0, 'active similarly named assets must pass admission');
  fs.writeFileSync(path.join(directory, 'index.html'), html.replace('</body>', '<script src="/review-ui.js?v=2"></script></body>'));
  const retiredReference = verify();
  assert.notEqual(retiredReference.status, 0, 'admission must refuse an exact retired reference without silently repairing it');
  assert.match(retiredReference.stderr, /Retired presentation remains/);
  fs.writeFileSync(path.join(directory, 'index.html'), html);
  fs.writeFileSync(path.join(directory, 'review-ui.js'), '/* retired */');
  const retiredFile = verify();
  assert.notEqual(retiredFile.status, 0, 'admission must refuse a retained retired disk asset');
  assert.match(retiredFile.stderr, /Retired presentation remains/);
});
