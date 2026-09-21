'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../scripts/vector-browser-feedback-wrapper.cjs'),'utf8');
test('private browser images are never emitted into ordinary logs',()=>{
  assert.doesNotMatch(source,/console\.log[^\n]*base64\s*:/);
  assert.match(source,/fs\.writeFileSync\(out\+'\/'\+file,image,\{mode:0o600\}\)/);
  assert.match(source,/sha256:digest\(image\),bytes:image\.length/);
});
test('exact original source identities and the strong overlap rejection assertions are retained',()=>{
  assert.ok(source.includes('6803b05fe634f78122a61703df5f6835b71a430857c213f7cfb4b82628aedbd1'));
  assert.ok(source.includes('36d996c04079c1d6dd5ef33356972f2dc5bc56fabdbcae0c4531f067f9d0fdbc'));
  assert.ok(source.includes('AMBIGUOUS_PROOF_PATCH'));
  assert.ok(source.includes('OVERLAP_NOT_REFUSED_BY_SOURCE'));
  assert.ok(source.includes('SOURCE_OVERLAP_REASON_MISSING'));
  assert.ok(source.includes("assert.match(settledFeedback,/overlap|already|request/i)"));
  assert.ok(source.includes("getByRole('button',{name:'Cancel',exact:true})"));
});
test('the folded active proof remains syntactically valid and keeps honest scope boundaries',()=>{
  assert.doesNotThrow(()=>new vm.Script(source));
  assert.ok(source.includes('restart durability, full approval/payroll and provider proof remain unproven'));
  assert.ok(source.includes('applicationChanged:false'));
});
