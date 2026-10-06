import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {validatePublicBundle,APPROVED_AUTHENTICATED_TITLE} from './validate-customer-public-bundle.mjs';

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vector-public-bundle-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 return root;
}

test('technical comments may mention forbidden phrases when no customer-renderable string does',t=>{
 const root=fixture(t);
 fs.writeFileSync(path.join(root,'app.js'),"// development build; interactive design prototype; sample account\n/* local development design requirement */\ndocument.title='"+APPROVED_AUTHENTICATED_TITLE+"';const copy='Current workforce';");
 const result=validatePublicBundle(root);
 assert.equal(result.filesScanned,1);
 assert.equal(result.approvedTitle,APPROVED_AUTHENTICATED_TITLE);
});

test('customer-renderable forbidden copy fails anywhere in the recursive final bundle',t=>{
 const root=fixture(t);fs.mkdirSync(path.join(root,'nested'));
 fs.writeFileSync(path.join(root,'app.js'),"document.title='"+APPROVED_AUTHENTICATED_TITLE+"';");
 fs.writeFileSync(path.join(root,'nested','panel.js'),"const help='Downloadable sample for this sample account';");
 assert.throws(()=>validatePublicBundle(root),/VECTOR_CUSTOMER_PUBLIC_BUNDLE_REJECTED/);
});

test('authenticated application title must use only the approved static title',t=>{
 const root=fixture(t);
 fs.writeFileSync(path.join(root,'bad.js'),"document.title='Manufacturing Workforce · Interactive Design';");
 assert.throws(()=>validatePublicBundle(root),/unapproved-document-title|customer-copy/);
});

test('dynamic document titles fail closed because their rendered value cannot be admitted statically',t=>{
 const root=fixture(t);
 fs.writeFileSync(path.join(root,'dynamic.js'),"const suffix='Workforce';document.title='Vector · '+suffix;");
 assert.throws(()=>validatePublicBundle(root),/dynamic-document-title/);
});
