#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import fs from 'node:fs';

const require=createRequire(import.meta.url);
const C=require('../ux-overlay/vector-operating-context.js');
const checks=[];
const check=(name,fn)=>{fn();checks.push(name);};

check('identity, site and Unicode come from supplied records',()=>{
  const result=C.resolve({
    actor:{id:'u-1',name:'山田 太郎',title:'工場長'},
    person:{id:'u-1',site:'東京 第一工場'},
    scope:{id:'site-jp',label:'東京 第一工場'},
    operatingContext:{authoritative:true,scopeId:'site-jp',organisationName:'精密製造株式会社',locale:'ja-JP',timeZone:'Asia/Tokyo',currency:'JPY'},
    costEvidence:{scopeId:'site-jp',currency:'JPY'},
    browser:{locale:'en-GB',timeZone:'Europe/London'}
  });
  assert.equal(result.displayName,'山田 太郎');
  assert.equal(result.siteName,'東京 第一工場');
  assert.equal(result.companyName,'精密製造株式会社');
  assert.equal(result.timeZone,'Asia/Tokyo');
  assert.equal(result.currency,'JPY');
  assert.equal(result.complete,true);
});

check('person locale preference overrides the operating display locale only',()=>{
  const result=C.resolve({
    actor:{name:'Élodie Martin'},person:{site:'Lyon'},scope:{id:'lyon'},
    preference:{locale:'fr-FR'},
    operatingContext:{authoritative:true,scopeId:'lyon',locale:'de-DE',timeZone:'Europe/Paris',currency:'EUR'},
    costEvidence:{scopeId:'lyon',currency:'EUR'}
  });
  assert.equal(result.locale,'fr-FR');
  assert.equal(result.localeSource,'person_preference');
  assert.match(C.formatMoney(1234.5,result),/€/);
  assert.equal(result.timeZone,'Europe/Paris');
});

check('mismatched legal/site cost scope cannot leak a currency',()=>{
  const result=C.resolve({
    actor:{name:'Alex'},person:{site:'Plant A'},scope:{id:'site-a'},
    operatingContext:{authoritative:true,scopeId:'site-a',timeZone:'Europe/London',currency:'GBP'},
    costEvidence:{scopeId:'site-b',currency:'USD'},
    browser:{locale:'en-GB',timeZone:'Europe/London'}
  });
  assert.equal(result.currency,null);
  assert.equal(result.currencyScopeMismatch,true);
  assert.equal(C.formatMoney(100,result),'\u2014');
  assert.ok(result.missing.includes('cost_scope_match'));
});

check('unscoped cost evidence cannot supply a plausible currency',()=>{
  const result=C.resolve({
    actor:{name:'Alex'},person:{site:'Plant A'},scope:{id:'site-a'},
    operatingContext:{authoritative:true,scopeId:'site-a',timeZone:'Europe/London',currency:'GBP'},
    costEvidence:{currency:'GBP'},
    browser:{locale:'en-GB',timeZone:'Europe/London'}
  });
  assert.equal(result.currency,null);
  assert.equal(result.currencyScopeMismatch,true);
  assert.equal(C.formatMoney(100,result),'\u2014');
  assert.ok(result.missing.includes('cost_scope_match'));
});

check('the shell never invents a missing cost-evidence scope from UI state',()=>{
  const shell=fs.readFileSync(new URL('../ux-overlay/vector-shell.js',import.meta.url),'utf8');
  assert.doesNotMatch(shell,/scopeId:scopeIds\.length===1\?scopeIds\[0\]:String\(ui\?\.root\|\|''\)/);
  assert.match(shell,/scopeId:scopeIds\.length===1\?scopeIds\[0\]:null/);
});

check('invalid global values fail closed to neutral display defaults',()=>{
  const result=C.resolve({
    operatingContext:{locale:'not_a_locale',timeZone:'Mars/Olympus',currency:'BITCOIN'},
    browser:{locale:'pl-PL',timeZone:'Europe/Warsaw'}
  });
  assert.equal(result.locale,'pl-PL');
  assert.equal(result.timeZone,'Europe/Warsaw');
  assert.equal(result.currency,null);
  assert.equal(result.displayName,'Current user');
  assert.equal(result.complete,false);
});

check('local hour, calendar day and ISO week follow the site time zone across the date line',()=>{
  const instant='2026-12-31T23:30:00Z';
  assert.equal(C.localHour(instant,{timeZone:'Asia/Tokyo'}),8);
  assert.equal(C.localHour(instant,{timeZone:'America/Los_Angeles'}),15);
  assert.deepEqual(C.localCalendarParts(instant,{timeZone:'Asia/Tokyo'}),{year:2027,month:1,day:1});
  assert.deepEqual(C.localCalendarParts(instant,{timeZone:'America/Los_Angeles'}),{year:2026,month:12,day:31});
  assert.equal(C.isoWeek(instant,{timeZone:'Asia/Tokyo'}),53);
  assert.equal(C.isoWeek('2027-01-04T12:00:00Z',{timeZone:'Europe/London'}),1);
});

check('size and topology matrix remains deterministic without fixed hierarchy depth',()=>{
  const sizes=[1,25,100,500,2000,10000];
  const start=performance.now();
  let resolved=0;
  for(const size of sizes){
    const depth=size===10000?75:Math.max(1,Math.ceil(Math.log2(size+1)));
    const scope={id:`scope-${size}-${depth}`,label:`Site ${size}`};
    for(let i=0;i<size;i++){
      const region=i%3;
      const contexts=[
        {locale:'en-GB',timeZone:'Europe/London',currency:'GBP'},
        {locale:'de-DE',timeZone:'Europe/Berlin',currency:'EUR'},
        {locale:'ja-JP',timeZone:'Asia/Tokyo',currency:'JPY'}
      ];
      const op={authoritative:true,scopeId:scope.id,siteName:scope.label,organisationName:'Global Manufacturer',...contexts[region]};
      const result=C.resolve({actor:{name:`Worker ${i}`},person:{site:scope.label},scope,operatingContext:op,costEvidence:{scopeId:scope.id,currency:op.currency}});
      assert.equal(result.scopeId,scope.id);
      assert.equal(result.complete,true);
      resolved++;
    }
  }
  const elapsedMs=Math.round((performance.now()-start)*100)/100;
  assert.equal(resolved,12626);
  assert.ok(elapsedMs<5000,`context matrix took ${elapsedMs}ms`);
  checks.push(`size-matrix:${resolved}-contexts:${elapsedMs}ms`);
});

check('formatters preserve unknown rather than inventing money, dates or calendar positions',()=>{
  assert.equal(C.formatMoney(42,{locale:'en-GB',currency:null}),'\u2014');
  assert.equal(C.formatMoney(Number.NaN,{locale:'en-GB',currency:'GBP'}),'\u2014');
  assert.equal(C.formatDate('not-a-date',{locale:'en-GB',timeZone:'UTC'}),'\u2014');
  assert.equal(C.localCalendarParts('not-a-date',{timeZone:'UTC'}),null);
  assert.equal(C.isoWeek('not-a-date',{timeZone:'UTC'}),null);
});

console.log(JSON.stringify({
  status:'pass',
  validator:'vector-operating-context',
  version:C.VERSION,
  checks,
  claimBoundary:'Source-level deterministic validation only; no hosted browser, customer, legal, payroll or production certification.'
},null,2));
