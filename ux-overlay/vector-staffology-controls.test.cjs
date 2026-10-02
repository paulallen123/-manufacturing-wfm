'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'vector-shell.js'), 'utf8');

test('Staffology customer controls use only authenticated canonical routes and server-held scope', () => {
  for (const route of ['/api/integrations','/employees/acquire-stage','/payroll/approve-deliver','/payroll/readback','/payroll/recover','/api/integrations/apply']) assert.ok(source.includes(route), route);
  assert.match(source, /credentials:'same-origin'/);
  assert.match(source, /operation\.cohort\.employeeIds/);
  assert.match(source, /approval:operation\.payroll\.approval/);
  assert.match(source, /reviewed:true/);
  assert.doesNotMatch(source, /STAFFOLOGY_API_KEY|apiKey|Authorization.*Staffology/i);
});

test('Staffology controls expose dormant, authority, progress and double-submit boundaries', () => {
  assert.match(source, /Operations are dormant until an exact server-held employer and employee cohort are configured/);
  assert.match(source, /current account is not the exact authorised operator/);
  assert.match(source, /if\(!staffologyCurrent\(panel\)\|\|panel\.busy\)return/);
  assert.match(source, /button\.disabled=!!panel\.busy/);
  assert.match(source, /Every write is current-account checked, exact-scope checked and audit recorded/);
  assert.doesNotMatch(source, /setInterval\([^)]*Staffology|setTimeout\([^)]*Staffology/i);
});
