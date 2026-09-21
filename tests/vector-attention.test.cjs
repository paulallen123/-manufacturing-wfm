const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('the entire attention button carries the queue action for keyboard and pointer activation', () => {
  const element = () => ({ dataset: {}, appendChild() {}, querySelector() { return null; } });
  const content = element();
  let rendered;
  content.prepend = node => { rendered = node.innerHTML; };
  const source = fs.readFileSync(require.resolve('../ux-overlay/vector-shell.js'), 'utf8')
    .replace('window.VectorWorkforceOperations={marker:MARKER', 'window.VectorWorkforceOperations={renderHome,marker:MARKER');
  const context = { window: {}, document: { createElement: element, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, documentElement: {} }, MutationObserver: class { observe() {} }, setTimeout() {}, queueMicrotask() {}, isEmployee: () => false };
  vm.runInNewContext(source, context);
  context.window.VectorWorkforceOperations.renderHome(content);
  const card = rendered.match(/<button\b[^>]*>[\s\S]*?<\/button>/g).find(html => html.includes('Items needing attention'));
  assert.ok(card, 'Attention card was rendered');
  assert.match(card.split('>')[0], /data-vector-focus-attention/);
  assert.match(card.split('>')[0], /data-vector-route="overview"/);
});
