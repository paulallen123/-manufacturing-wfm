'use strict';
const test=require('node:test'); const assert=require('node:assert/strict'); const {createHash}=require('node:crypto');
const {createAuthoritativePolicySourceRegistry}=require('./authoritative-policy-source-registry.cjs');
const sha=s=>createHash('sha256').update(s).digest('hex');
function registry(){return createAuthoritativePolicySourceRegistry([{id:'gb-law',authorityTier:'PRIMARY_GOVERNMENT',channel:'API',jurisdiction:'GB',canonicalReference:'official:gb',nativeLanguages:['en'],freshnessHours:24}]);}
test('verified official snapshot becomes current evidence',()=>{const r=registry();const s=r.recordSnapshot({sourceId:'gb-law',observedAt:'2026-09-25T08:00:00Z',contentDigest:sha('v1'),verifiedRetrieval:true});assert.equal(r.assess('gb-law',{at:'2026-09-25T09:00:00Z'}).state,'CURRENT');assert.equal(s.executionAuthority,false);});
test('stale source cannot silently remain usable',()=>{const r=registry();r.recordSnapshot({sourceId:'gb-law',observedAt:'2026-09-20T08:00:00Z',contentDigest:sha('v1'),verifiedRetrieval:true});const a=r.assess('gb-law',{at:'2026-09-25T09:00:00Z'});assert.equal(a.state,'STALE');assert.equal(a.usable,false);});
test('unverified retrieval cannot enter authoritative evidence',()=>{const r=registry();assert.throws(()=>r.recordSnapshot({sourceId:'gb-law',observedAt:'2026-09-25T08:00:00Z',contentDigest:sha('v1'),verifiedRetrieval:false}),/verified retrieval/i);});
test('source metadata never grants execution authority',()=>{const r=registry();assert.equal(r.all()[0].grantsExecutionAuthority,false);});
