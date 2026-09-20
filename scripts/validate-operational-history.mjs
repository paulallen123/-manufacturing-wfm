#!/usr/bin/env node
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { buildFactoryGraph } from '../platform/factory-graph/factory-graph-kernel.mjs';
import { buildOperationalHistory } from '../platform/factory-graph/operational-history.mjs';
import { evaluateProjectedDecision } from '../platform/optimisation/savings-engine.mjs';

const ev = (sourceRef, observedAt) => ({ sourceType: 'synthetic-operational-history-proof', sourceRef, observedAt });
const graph = buildFactoryGraph({
  entities: [
    { id:'worker:op-1', type:'worker', evidence:ev('fixture://worker/op-1','2026-09-20T09:00:00.000Z') },
    { id:'asset:press-7', type:'asset', evidence:ev('fixture://asset/press-7','2026-09-20T09:00:00.000Z') },
    { id:'line:4', type:'line', evidence:ev('fixture://line/4','2026-09-20T09:00:00.000Z') },
    { id:'order:alpha', type:'production_order', evidence:ev('fixture://order/alpha','2026-09-20T09:00:00.000Z') },
    { id:'quality:q-1', type:'quality_record', evidence:ev('fixture://quality/q-1','2026-09-20T09:00:00.000Z') },
    { id:'maintenance:press-7', type:'maintenance_task', evidence:ev('fixture://maintenance/press-7','2026-09-20T09:00:00.000Z') }
  ],
  relations: [
    { from:'asset:press-7', to:'line:4', type:'LOCATED_AT', evidence:ev('fixture://rel/asset-line','2026-09-20T09:00:00.000Z') },
    { from:'order:alpha', to:'asset:press-7', type:'REQUIRES_ASSET', evidence:ev('fixture://rel/order-asset','2026-09-20T09:00:00.000Z') },
    { from:'maintenance:press-7', to:'asset:press-7', type:'MAINTENANCE_FOR', evidence:ev('fixture://rel/maint-asset','2026-09-20T09:00:00.000Z') },
    { from:'quality:q-1', to:'order:alpha', type:'QUALITY_FOR', evidence:ev('fixture://rel/quality-order','2026-09-20T09:00:00.000Z') }
  ],
  // Deliberately supplied out of occurrence order.
  events: [
    { id:'event:defect', kind:'quality_defect', occurredAt:'2026-09-20T10:08:00.000Z', entityIds:['quality:q-1','order:alpha','asset:press-7'], evidence:ev('fixture://event/defect','2026-09-20T10:08:05.000Z') },
    { id:'event:worker-adjustment', kind:'operator_adjustment', occurredAt:'2026-09-20T10:03:00.000Z', entityIds:['worker:op-1','asset:press-7','order:alpha'], evidence:ev('fixture://event/worker-adjustment','2026-09-20T10:03:02.000Z') },
    { id:'event:pressure-spike', kind:'machine_pressure_spike', occurredAt:'2026-09-20T10:01:00.000Z', entityIds:['asset:press-7','order:alpha'], evidence:ev('fixture://event/pressure-spike','2026-09-20T10:20:00.000Z') },
    { id:'event:maintenance-warning', kind:'maintenance_warning', occurredAt:'2026-09-20T10:06:00.000Z', entityIds:['asset:press-7','maintenance:press-7'], evidence:ev('fixture://event/maintenance-warning','2026-09-20T10:06:01.000Z') }
  ]
});

const history = buildOperationalHistory(graph);
assert.deepEqual(history.orderedEvents.map((e)=>e.id), [
  'event:pressure-spike','event:worker-adjustment','event:maintenance-warning','event:defect'
]);

const asKnownAt1010 = history.eventsInWindow({
  from:'2026-09-20T10:00:00.000Z',
  to:'2026-09-20T10:10:00.000Z',
  knownAt:'2026-09-20T10:10:00.000Z',
  entityIds:['asset:press-7']
});
assert(!asKnownAt1010.some((e)=>e.id==='event:pressure-spike'), 'late event leaked into historical replay before it was observed');
assert(asKnownAt1010.some((e)=>e.id==='event:defect'));

const asKnownAt1030 = history.eventsInWindow({
  from:'2026-09-20T10:00:00.000Z',
  to:'2026-09-20T10:10:00.000Z',
  knownAt:'2026-09-20T10:30:00.000Z',
  entityIds:['asset:press-7']
});
assert(asKnownAt1030.some((e)=>e.id==='event:pressure-spike'));
assert.equal(history.dataQuality().lateArrivalCount, 1); // only materially delayed telemetry is classified as late
assert.equal(history.dataQuality().maxIngestionDelayMs, 19 * 60_000);

const incident = history.incidentBundle({
  anchorEventId:'event:defect',
  beforeMs:10 * 60_000,
  afterMs:2 * 60_000,
  knownAt:'2026-09-20T10:10:00.000Z'
});
assert(incident.events.some((e)=>e.id==='event:worker-adjustment'));
assert(incident.events.some((e)=>e.id==='event:maintenance-warning'));
assert(!incident.events.some((e)=>e.id==='event:pressure-spike'));
assert.match(incident.claimBoundary, /does not prove causality/);

const decision = evaluateProjectedDecision({
  baseline:{
    id:'baseline:continue-uninvestigated', currency:'GBP',
    costs:{quality:6000,downtime:2500,missedOutput:2000},
    evidenceRefs:incident.evidenceRefs
  },
  alternatives:[
    {
      id:'option:controlled-stop-and-inspect', currency:'GBP',
      costs:{maintenance:600,downtime:1200,quality:500},
      constraintViolations:[], evidenceRefs:incident.evidenceRefs
    },
    {
      id:'option:keep-running', currency:'GBP',
      costs:{quality:4000,downtime:800},
      constraintViolations:['quality_hold_required'], evidenceRefs:incident.evidenceRefs
    }
  ],
  decisionContext:{ anchorEventId:'event:defect', replayKnownAt:'2026-09-20T10:10:00.000Z' }
});
assert.equal(decision.selected.id,'option:controlled-stop-and-inspect');
assert.equal(decision.selected.projectedSaving,8200);
assert(!decision.selected.evidenceRefs.includes('fixture://event/pressure-spike'), 'decision used evidence unavailable at decision time');

const receipt = {
  proof:'time-aligned-operational-history-kernel',
  status:'PASS',
  source_sha:process.env.CIRCLE_SHA1 || process.env.GITHUB_SHA || process.env.SOURCE_SHA || null,
  deployment_id:process.env.WFM_DEPLOYMENT_ID || null,
  deployment_proven:Boolean(process.env.WFM_DEPLOYMENT_ID),
  claim_boundary:process.env.WFM_DEPLOYMENT_ID ? 'Source and deployment identity supplied by proof environment.' : 'Source-level synthetic proof only; no hosted, customer, video or causal-inference claim is made.',
  scenario:{
    ordered_event_replay:true,
    hindsight_leakage_blocked:true,
    late_event_detected:true,
    incident_evidence_refs:incident.evidenceRefs.length,
    projected_saving_gbp:decision.selected.projectedSaving,
    selected_option:decision.selected.id,
    late_event_excluded_from_decision:true
  }
};
writeFileSync('operational-history-proof.json', JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt));
