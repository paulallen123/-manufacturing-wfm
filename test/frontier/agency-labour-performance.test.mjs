import test from 'node:test';
import assert from 'node:assert/strict';
import {profileAgencyPerformance,rankAgenciesForRequest,modelAgencyAutomationValue} from '../../src/frontier/agency-labour-performance.mjs';

function event(agencyId,type,extra={}){return {agencyId,type,siteId:'S1',roleId:'R1',...extra};}
function history(agencyId,{requests=20,filled=18,preferred=14,noShows=1,completed=18,response=8,matched=17,review=1,rate=20}={}){
 const e=[];for(let i=0;i<requests;i++)e.push(event(agencyId,'request_sent'));
 for(let i=0;i<filled;i++)e.push(event(agencyId,'request_filled',{preferredWorker:i<preferred}));
 for(let i=0;i<completed;i++)e.push(event(agencyId,'shift_completed',{chargeRatePerHour:rate}));
 for(let i=0;i<noShows;i++)e.push(event(agencyId,'worker_no_show'));
 for(let i=0;i<requests;i++)e.push(event(agencyId,'agency_response',{responseMinutes:response}));
 for(let i=0;i<matched;i++)e.push(event(agencyId,'invoice_matched'));
 for(let i=0;i<review;i++)e.push(event(agencyId,'invoice_review_required'));
 return e;
}

function licence(id){return {status:'licensed',evidenceRef:`fwa-register-snapshot:${id}`,providerReference:`FWA-${id}`,checkedAt:'2026-09-18T09:00:00.000Z'};}

test('strong role/site supplier evidence produces an explainable profile',()=>{const p=profileAgencyPerformance({agencyId:'A1',events:history('A1'),request:{siteId:'S1',roleId:'R1',maxChargePerHour:25},responseTargetMinutes:15});assert.equal(p.scope,'site_role');assert.ok(p.score>.7);assert.equal(p.raw.requests,20);assert.equal(p.raw.filled,18);assert.ok(p.metrics.invoiceAccuracy>.7);});

test('small samples are shrunk toward neutral and cannot dominate on one lucky fill',()=>{const tiny=[event('A1','request_sent'),event('A1','request_filled',{preferredWorker:true}),event('A1','shift_completed',{chargeRatePerHour:18}),event('A1','agency_response',{responseMinutes:1}),event('A1','invoice_matched')];const p=profileAgencyPerformance({agencyId:'A1',events:tiny,request:{siteId:'S1',roleId:'R1',maxChargePerHour:25},responseTargetMinutes:15});assert.ok(p.score<.75);assert.ok(p.evidenceConfidence<.2);});

test('better operational supplier ranks above a cheaper but unreliable supplier',()=>{const agencies=[{agencyId:'GOOD',approved:true,active:true,responseSlaMinutes:15},{agencyId:'CHEAP',approved:true,active:true,responseSlaMinutes:15}];const events=[...history('GOOD',{requests:30,filled:29,preferred:25,noShows:0,completed:29,response:5,matched:28,review:1,rate:22}),...history('CHEAP',{requests:30,filled:18,preferred:8,noShows:5,completed:18,response:20,matched:12,review:6,rate:16})];const r=rankAgenciesForRequest({agencies,events,request:{siteId:'S1',roleId:'R1',maxChargePerHour:25}});assert.equal(r[0].agencyId,'GOOD');assert.ok(r[0].score>r[1].score);});

test('unapproved suppliers never enter ranking',()=>{const agencies=[{agencyId:'A1',approved:false,active:true},{agencyId:'A2',approved:true,active:true}];const r=rankAgenciesForRequest({agencies,events:[...history('A1'),...history('A2')],request:{siteId:'S1',roleId:'R1'}});assert.deepEqual(r.map(x=>x.agencyId),['A2']);});

test('FWA supplier compliance is evaluated before performance ranking',()=>{const agencies=[{agencyId:'SAFE',approved:true,active:true,fairWorkAgencyGangmasterLicence:licence('SAFE')},{agencyId:'UNLICENSED',approved:true,active:true}];const events=[...history('SAFE',{requests:20,filled:15,preferred:10,noShows:2,completed:15,response:12,matched:14,review:1,rate:22}),...history('UNLICENSED',{requests:40,filled:40,preferred:40,noShows:0,completed:40,response:1,matched:40,review:0,rate:15})];const r=rankAgenciesForRequest({agencies,events,request:{siteId:'S1',roleId:'R1',fairWorkAgencyGangmasterLicenceRequired:true,endAt:'2026-09-21T14:00:00.000Z'},now:'2026-09-18T12:00:00.000Z'});assert.deepEqual(r.map(x=>x.agencyId),['SAFE']);assert.equal(r[0].supplierEligibility.eligible,true);assert.equal(r[0].supplierEligibility.evidence.primaryLicence.providerReference,'FWA-SAFE');});

test('value model reports scenario output, not a realised saving claim',()=>{const v=modelAgencyAutomationValue({requestsPerMonth:100,manualMinutesPerRequest:18,automatedMinutesPerRequest:3,managerHourlyCost:30,agencyWorkersPerMonth:200,manualInvoiceMinutesPerWorker:4,automatedInvoiceMinutesPerWorker:1,avoidedNoShowsPerMonth:2,costPerNoShow:500});assert.equal(v.requestHoursSaved,25);assert.equal(v.invoiceHoursSaved,10);assert.equal(v.adminHoursSaved,35);assert.equal(v.adminCostSaved,1050);assert.equal(v.noShowCostAvoided,1000);assert.equal(v.totalModelledMonthlyValue,2050);assert.equal(v.modelOnly,true);});

test('ranking is deterministic across identical evidence',()=>{const agencies=[{agencyId:'A',approved:true,active:true},{agencyId:'B',approved:true,active:true}];const events=[...history('A'),...history('B',{filled:15})];const a=rankAgenciesForRequest({agencies,events,request:{siteId:'S1',roleId:'R1'}});const b=rankAgenciesForRequest({agencies:structuredClone(agencies),events:structuredClone(events),request:{siteId:'S1',roleId:'R1'}});assert.deepEqual(a,b);});
