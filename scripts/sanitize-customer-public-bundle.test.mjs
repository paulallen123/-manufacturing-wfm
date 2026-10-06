import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {sanitizeCustomerBundle} from './sanitize-customer-public-bundle.mjs';
import {validatePublicBundle,APPROVED_AUTHENTICATED_TITLE} from './validate-customer-public-bundle.mjs';

function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'vector-customer-sanitize-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}

test('final sanitizer cleans known rendered legacy copy across multiple files and scanner admits the result',t=>{
 const root=fixture(t);
 fs.writeFileSync(path.join(root,'app.js'),"const banner='INTERACTIVE DESIGN PREVIEW';document.title='Manufacturing Workforce · Interactive Design';");
 fs.writeFileSync(path.join(root,'cost-ui.js'),"const a='Only the payroll-admin role can review and apply imports in this development build.';document.title='Workforce · Costs';");
 fs.writeFileSync(path.join(root,'rules.js'),"const status='Draft GB rule pack; local development, not certification';");
 const result=sanitizeCustomerBundle(root);assert.equal(result.changed,3);
 const admitted=validatePublicBundle(root);assert.equal(admitted.approvedTitle,APPROVED_AUTHENTICATED_TITLE);
 for(const name of ['app.js','cost-ui.js'])assert.match(fs.readFileSync(path.join(root,name),'utf8'),/Vector · Workforce/);
});

test('sanitizer does not make the release gate permissive for unknown customer copy',t=>{
 const root=fixture(t);fs.writeFileSync(path.join(root,'app.js'),"document.title='Vector · Workforce';const x='Interactive design blueprint';");
 sanitizeCustomerBundle(root);
 assert.throws(()=>validatePublicBundle(root),/VECTOR_CUSTOMER_PUBLIC_BUNDLE_REJECTED/);
});
