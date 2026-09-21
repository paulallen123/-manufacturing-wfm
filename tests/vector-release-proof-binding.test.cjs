'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const V = require('../scripts/vector-http-verifier.cjs');
test('independent verifier binds all three exact assets from the admitted five-section candidate', () => {
 assert.deepEqual(V.DIGESTS, {
  '/vector-ui.js':'cc9b69b48b14b643e50cf6b44f6c601772eaa13a829cf3d4205e652ed8574377',
  '/vector-ui.css':'db33e280854fe55927077a9f0ab85ea86eb9d34aa6aa049936ad46b88f558738',
  '/vector-workflows.js':'a08138f821fdb292bddd231a81b9ae82de3daadffb41f78e65e9fcb94cadc458'
 });
});
test('verifier never substitutes the superseded navigation identity for the approved five-section layout', () => {
 const src=fs.readFileSync(path.join(__dirname,'../scripts/vector-http-verifier.cjs'),'utf8');
 assert.match(src,/VECTOR_FIVE_SECTION_2026_09_19/);
 assert.doesNotMatch(src,/VECTOR_UI_V2_20260921/);
 assert.match(src,/if \(path === '\/vector-ui\.js'\)/);
});
