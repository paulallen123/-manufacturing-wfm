import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const base='frontier-prototypes/factory-capability-graph';
const html=fs.readFileSync(`${base}/index.html`,'utf8');
const css=fs.readFileSync(`${base}/factory-capability-graph.css`,'utf8');
const js=fs.readFileSync(`${base}/factory-capability-graph-ui.js`,'utf8');

test('capability workspace is calm by default and preserves dense graph on demand',()=>{
  assert.match(html,/What needs attention/);
  assert.match(html,/data-tab="graph"/);
  assert.match(html,/data-view="graph" hidden/);
  assert.match(html,/Review discovered capability/);
  assert.match(html,/will never grant qualification automatically/);
});

test('capability workspace carries the role-first responsive contract',()=>{
  assert.match(css,/@media\(max-width:760px\)/);
  assert.match(css,/overflow-x:auto/);
  assert.match(css,/max-width:100%/);
  assert.match(js,/event\.key==='Escape'/);
  assert.match(js,/aria-selected/);
});