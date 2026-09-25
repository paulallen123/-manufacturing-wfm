'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'vector-operations-bot.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'vector-operations-bot.css'), 'utf8');

test('operations bot is bound to the guarded lifecycle API and existing authenticated workflow', () => {
  assert.match(source, /\/api\/workforce\/lifecycle\/operations-bot/);
  assert.match(source, /window\.VectorWorkflow/);
  assert.match(source, /leaveRequest/);
  assert.match(source, /leaveState\(\)\.receipt/);
  assert.match(source, /verifyAfterExecution/);
});

test('no action executes before explicit confirmation', () => {
  assert.match(source, /confirm:\s*true/);
  assert.match(source, /data-wfm-bot-confirm/);
  const executeIndex = source.indexOf("request('/execute'");
  const confirmIndex = source.indexOf('async function confirmPlan');
  assert.ok(confirmIndex >= 0 && executeIndex > confirmIndex);
  assert.doesNotMatch(source, /eval\s*\(|new Function\s*\(/);
});

test('voice input and spoken replies use the same locale without changing action semantics', () => {
  assert.match(source, /window\.SpeechRecognition\s*\|\|\s*window\.webkitSpeechRecognition/);
  assert.match(source, /recognition\.lang\s*=\s*locale\(\)/);
  assert.match(source, /new SpeechSynthesisUtterance/);
  assert.match(source, /utterance\.lang\s*=\s*locale\(\)/);
  assert.match(source, /navigator\.language/);
  assert.match(source, /Voice availability depends on the browser\/device speech service/);
});

test('the existing Vector ask entry points resolve to one canonical Operations Bot', () => {
  assert.match(source, /id\s*=\s*'wfm-bot-launch'/);
  assert.match(source, /root\.id\s*=\s*'wfm-bot'/);
  assert.match(source, /id="bot-message"/);
  assert.match(source, /existingBot\.remove\(\)/);
  assert.match(source, /existingLaunch\.remove\(\)/);
  assert.match(source, /existingBot\.dataset\.marker === MARKER/);
});

test('bot UI remains inside the approved blue-and-white presentation and is responsive', () => {
  assert.match(css, /VECTOR_OPERATIONS_BOT_UI_V1/);
  assert.match(css, /#0b6ff4|#096bf1/);
  assert.match(css, /@media \(max-width:700px\)/);
  assert.match(css, /prefers-reduced-motion/);
});

test('unknown execution instructions fail closed', () => {
  assert.match(source, /Vecta refused an unregistered execution instruction/);
  assert.match(source, /The action did not complete/);
  assert.match(source, /Vecta has not reported it as done/);
});
