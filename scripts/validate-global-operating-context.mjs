#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildFactoryGraph } from '../platform/factory-graph/factory-graph-kernel.mjs';
import { buildGlobalOperatingContext } from '../platform/factory-graph/global-operating-context.mjs';

const observedAt = '2026-09-20T12:00:00.000Z';
const ev = (sourceRef) => ({ sourceType: 'synthetic-global-scale-fixture', sourceRef, observedAt });

const microGraph = buildFactoryGraph({
  entities: [
    { id: 'org:micro', type: 'organisation', globalContext: { countryCode: 'GB', locale: 'en-GB', timeZone: 'Europe/London', currency: 'GBP', unitSystem: 'metric', dataRegion: 'uk' }, evidence: ev('fixture://micro/org') },
    { id: 'site:micro', type: 'site', evidence: ev('fixture://micro/site') },
    { id: 'worker:micro', type: 'worker', evidence: ev('fixture://micro/worker') }
  ],
  relations: [
    { from: 'org:micro', to: 'site:micro', type: 'PARENT_OF', evidence: ev('fixture://micro/org-site') },
    { from: 'site:micro', to: 'worker:micro', type: 'PARENT_OF', evidence: ev('fixture://micro/site-worker') }
  ]
});
const micro = buildGlobalOperatingContext(microGraph);
assert.deepEqual(micro.lineage('worker:micro'), ['org:micro', 'site:micro', 'worker:micro']);
assert.equal(micro.resolveContext('worker:micro').currency, 'GBP');
assert.equal(micro.resolveContext('worker:micro').timeZone, 'Europe/London');

const entities = [
  { id: 'org:global', type: 'organisation', globalContext: { locale: 'en-GB', timeZone: 'UTC', currency: 'USD', unitSystem: 'metric', dataRegion: 'global-control' }, evidence: ev('fixture://global/org') },
  { id: 'entity:uk', type: 'legal_entity', globalContext: { countryCode: 'GB', currency: 'GBP', timeZone: 'Europe/London', dataRegion: 'uk' }, evidence: ev('fixture://global/entity-uk') },
  { id: 'entity:de', type: 'legal_entity', globalContext: { countryCode: 'DE', locale: 'de-DE', currency: 'EUR', timeZone: 'Europe/Berlin', dataRegion: 'eu' }, evidence: ev('fixture://global/entity-de') },
  { id: 'entity:jp', type: 'legal_entity', globalContext: { countryCode: 'JP', locale: 'ja-JP', currency: 'JPY', timeZone: 'Asia/Tokyo', dataRegion: 'apac' }, evidence: ev('fixture://global/entity-jp') },
  { id: 'policy:overtime-global', type: 'policy_set', policyKey: 'overtime.maxDailyHours', value: 12, evidence: ev('fixture://policy/overtime-global') },
  { id: 'policy:overtime-de', type: 'policy_set', policyKey: 'overtime.maxDailyHours', value: 10, evidence: ev('fixture://policy/overtime-de') },
  { id: 'policy:overtime-de-site', type: 'policy_set', policyKey: 'overtime.maxDailyHours', value: 8, evidence: ev('fixture://policy/overtime-de-site') }
];
const relations = [
  { from: 'org:global', to: 'entity:uk', type: 'PARENT_OF', evidence: ev('fixture://hierarchy/uk') },
  { from: 'org:global', to: 'entity:de', type: 'PARENT_OF', evidence: ev('fixture://hierarchy/de') },
  { from: 'org:global', to: 'entity:jp', type: 'PARENT_OF', evidence: ev('fixture://hierarchy/jp') },
  { from: 'org:global', to: 'policy:overtime-global', type: 'GOVERNED_BY', validFrom: '2026-01-01T00:00:00.000Z', evidence: ev('fixture://policy/assign-global') },
  { from: 'entity:de', to: 'policy:overtime-de', type: 'GOVERNED_BY', validFrom: '2026-01-01T00:00:00.000Z', evidence: ev('fixture://policy/assign-de') }
];

const siteCount = 50;
const workerCount = 12500;
for (let siteIndex = 0; siteIndex < siteCount; siteIndex += 1) {
  const entityId = siteIndex % 3 === 0 ? 'entity:uk' : siteIndex % 3 === 1 ? 'entity:de' : 'entity:jp';
  const siteId = `site:${siteIndex}`;
  const siteContext = siteIndex === 1 ? { locale: 'de-DE', timeZone: 'Europe/Berlin', currency: 'EUR' } : undefined;
  entities.push({ id: siteId, type: 'site', ...(siteContext ? { globalContext: siteContext } : {}), evidence: ev(`fixture://site/${siteIndex}`) });
  relations.push({ from: entityId, to: siteId, type: 'PARENT_OF', evidence: ev(`fixture://hierarchy/site/${siteIndex}`) });
}
relations.push({ from: 'site:1', to: 'policy:overtime-de-site', type: 'GOVERNED_BY', validFrom: '2026-09-01T00:00:00.000Z', evidence: ev('fixture://policy/assign-de-site') });

for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
  const siteId = `site:${workerIndex % siteCount}`;
  const workerId = `worker:${workerIndex}`;
  entities.push({ id: workerId, type: 'worker', evidence: ev(`fixture://worker/${workerIndex}`) });
  relations.push({ from: siteId, to: workerId, type: 'PARENT_OF', evidence: ev(`fixture://hierarchy/worker/${workerIndex}`) });
}

const graph = buildFactoryGraph({ entities, relations });
const global = buildGlobalOperatingContext(graph);
assert.equal(graph.entities.length, entities.length);
assert.equal(global.resolveContext('worker:1').countryCode, 'DE');
assert.equal(global.resolveContext('worker:1').currency, 'EUR');
assert.equal(global.resolveContext('worker:2').countryCode, 'JP');
assert.equal(global.resolveContext('worker:0').countryCode, 'GB');
assert.equal(global.effectivePolicies('worker:1', '2026-08-31T23:59:59.000Z')['overtime.maxDailyHours'].value, 10);
assert.equal(global.effectivePolicies('worker:1', '2026-09-20T12:00:00.000Z')['overtime.maxDailyHours'].value, 8);
assert.equal(global.effectivePolicies('worker:2', '2026-09-20T12:00:00.000Z')['overtime.maxDailyHours'].value, 12);

const londonAfterDst = micro.localParts('worker:micro', '2026-03-29T01:30:00.000Z');
assert.equal(londonAfterDst.hour, '02');
const tokyo = global.localParts('worker:2', '2026-09-20T12:00:00.000Z');
assert.equal(tokyo.hour, '21');

const badGraph = buildFactoryGraph({ entities: [{ id: 'org:bad', type: 'organisation', globalContext: { timeZone: 'Mars/Olympus' }, evidence: ev('fixture://bad/org') }] });
assert.throws(() => buildGlobalOperatingContext(badGraph), /timeZone is invalid/);

const receipt = {
  proof: 'global-operating-context-scale-kernel',
  status: 'PASS',
  source_sha: process.env.CIRCLE_SHA1 || process.env.GITHUB_SHA || process.env.SOURCE_SHA || null,
  claim_boundary: 'Synthetic source-level proof only. This validates global context inheritance, effective-dated policy specificity, DST/time-zone handling and >10k hierarchy scale; it does not certify jurisdiction-specific legal compliance or production multi-region deployment.',
  scenarios: {
    micro_one_employee_one_site: true,
    global_workers: workerCount,
    global_sites: siteCount,
    countries: ['GB', 'DE', 'JP'],
    local_policy_override: true,
    effective_dated_policy: true,
    dst_timezone_resolution: true,
    invalid_timezone_rejected: true,
    fixed_hierarchy_depth_required: false
  }
};
console.log(JSON.stringify(receipt));
