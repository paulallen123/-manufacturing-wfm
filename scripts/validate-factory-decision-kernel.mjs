#!/usr/bin/env node
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { buildFactoryGraph } from '../platform/factory-graph/factory-graph-kernel.mjs';
import { evaluateProjectedDecision, recordRealisedOutcome } from '../platform/optimisation/savings-engine.mjs';

const observedAt = '2026-09-20T10:00:00.000Z';
const ev = (sourceRef) => ({ sourceType: 'synthetic-proof-fixture', sourceRef, observedAt });

const graph = buildFactoryGraph({
  entities: [
    { id: 'worker:tech-1', type: 'worker', evidence: ev('fixture://worker/tech-1') },
    { id: 'skill:electrical-maintenance', type: 'skill', evidence: ev('fixture://skill/electrical-maintenance') },
    { id: 'shift:night-1', type: 'shift', evidence: ev('fixture://shift/night-1') },
    { id: 'line:4', type: 'line', evidence: ev('fixture://line/4') },
    { id: 'asset:press-7', type: 'asset', evidence: ev('fixture://asset/press-7') },
    { id: 'maintenance:press-7-pm', type: 'maintenance_task', evidence: ev('fixture://maintenance/press-7-pm') },
    { id: 'order:alpha', type: 'production_order', evidence: ev('fixture://order/alpha') },
    { id: 'tariff:offpeak', type: 'energy_tariff', evidence: ev('fixture://tariff/offpeak') }
  ],
  relations: [
    { from: 'worker:tech-1', to: 'skill:electrical-maintenance', type: 'HAS_SKILL', evidence: ev('fixture://rel/worker-skill') },
    { from: 'worker:tech-1', to: 'shift:night-1', type: 'WORKS_SHIFT', evidence: ev('fixture://rel/worker-shift') },
    { from: 'asset:press-7', to: 'line:4', type: 'LOCATED_AT', evidence: ev('fixture://rel/asset-line') },
    { from: 'maintenance:press-7-pm', to: 'asset:press-7', type: 'MAINTENANCE_FOR', evidence: ev('fixture://rel/maintenance-asset') },
    { from: 'maintenance:press-7-pm', to: 'skill:electrical-maintenance', type: 'REQUIRES_SKILL', evidence: ev('fixture://rel/maintenance-skill') },
    { from: 'order:alpha', to: 'asset:press-7', type: 'REQUIRES_ASSET', evidence: ev('fixture://rel/order-asset') },
    { from: 'asset:press-7', to: 'tariff:offpeak', type: 'CONSUMES_ENERGY_UNDER', evidence: ev('fixture://rel/asset-tariff') }
  ],
  events: [
    {
      id: 'event:maintenance-due',
      kind: 'maintenance_due',
      occurredAt: observedAt,
      entityIds: ['asset:press-7', 'maintenance:press-7-pm'],
      measurements: { remainingHours: 18 },
      evidence: ev('fixture://event/maintenance-due')
    }
  ]
});

assert.equal(graph.related('worker:tech-1', 'HAS_SKILL')[0].id, 'skill:electrical-maintenance');
assert.throws(() => buildFactoryGraph({
  entities: [{ id: 'worker:x', type: 'worker', evidence: ev('fixture://worker/x') }],
  relations: [{ from: 'worker:x', to: 'asset:missing', type: 'ASSIGNED_TO', evidence: ev('fixture://bad-rel') }]
}), /missing to entity/);

const decision = evaluateProjectedDecision({
  baseline: {
    id: 'baseline:reactive-peak-maintenance',
    currency: 'GBP',
    costs: { agency: 800, energy: 400, downtime: 8000 },
    evidenceRefs: ['fixture://baseline/cost-model']
  },
  alternatives: [
    {
      id: 'option:planned-offpeak-internal-tech',
      currency: 'GBP',
      costs: { labour: 250, energy: 150, downtime: 1500 },
      constraintViolations: [],
      evidenceRefs: ['fixture://worker/tech-1', 'fixture://tariff/offpeak', 'fixture://order/alpha']
    },
    {
      id: 'option:defer-beyond-due-window',
      currency: 'GBP',
      costs: { labour: 100, downtime: 500 },
      constraintViolations: ['maintenance_due_window_breached'],
      evidenceRefs: ['fixture://maintenance/press-7-pm']
    }
  ],
  decisionContext: {
    assetId: 'asset:press-7',
    maintenanceTaskId: 'maintenance:press-7-pm',
    workerId: 'worker:tech-1',
    productionOrderId: 'order:alpha'
  }
});

assert.equal(decision.selected.id, 'option:planned-offpeak-internal-tech');
assert.equal(decision.selected.projectedSaving, 7300);
assert.equal(decision.rejectedAlternatives[0].id, 'option:defer-beyond-due-window');
assert.throws(() => recordRealisedOutcome(decision, {
  actualSelectedCost: 2100,
  evidenceRefs: [],
  attributionKey: 'maintenance:press-7-pm:2026-09-20',
  observedAt
}), /requires evidenceRefs/);

const realised = recordRealisedOutcome(decision, {
  actualSelectedCost: 2100,
  evidenceRefs: ['fixture://actual/work-order', 'fixture://actual/payroll', 'fixture://actual/meter'],
  attributionKey: 'maintenance:press-7-pm:2026-09-20',
  observedAt
});
assert.equal(realised.realisedSaving, 7100);

const receipt = {
  proof: 'factory-graph-cross-domain-savings-kernel',
  status: 'PASS',
  source_sha: process.env.CIRCLE_SHA1 || process.env.GITHUB_SHA || process.env.SOURCE_SHA || null,
  deployment_id: process.env.WFM_DEPLOYMENT_ID || null,
  deployment_proven: Boolean(process.env.WFM_DEPLOYMENT_ID),
  claim_boundary: process.env.WFM_DEPLOYMENT_ID
    ? 'Source and deployment identity supplied by proof environment.'
    : 'Source-level proof only; no hosted deployment claim is made.',
  scenario: {
    selected_option: decision.selected.id,
    projected_saving_gbp: decision.selected.projectedSaving,
    realised_saving_gbp: realised.realisedSaving,
    unsafe_option_rejected: decision.rejectedAlternatives[0].id,
    graph_entities: graph.entities.length,
    graph_relations: graph.relations.length,
    graph_events: graph.events.length
  }
};
writeFileSync('factory-graph-savings-proof.json', JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
