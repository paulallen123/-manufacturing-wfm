#!/usr/bin/env node
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { buildFactoryGraph } from '../platform/factory-graph/factory-graph-kernel.mjs';
import { buildEngineeringMemory } from '../platform/factory-graph/engineering-memory.mjs';

const observedAt = '2026-09-20T11:40:00.000Z';
const ev = (sourceRef) => ({ sourceType: 'synthetic-proof-fixture', sourceRef, observedAt });

const graph = buildFactoryGraph({
  entities: [
    { id: 'part:shaft-A', type: 'part', evidence: ev('fixture://part/A') },
    { id: 'part:shaft-B', type: 'part', evidence: ev('fixture://part/B') },
    { id: 'drawing:A-r1', type: 'engineering_document', evidence: ev('fixture://drawing/A-r1') },
    { id: 'drawing:A-r2', type: 'engineering_document', evidence: ev('fixture://drawing/A-r2') },
    { id: 'drawing:B-r1', type: 'engineering_document', evidence: ev('fixture://drawing/B-r1') }
  ],
  relations: [
    { from: 'drawing:A-r1', to: 'part:shaft-A', type: 'DOCUMENTS', evidence: ev('fixture://rel/A-r1-part') },
    { from: 'drawing:A-r2', to: 'part:shaft-A', type: 'DOCUMENTS', evidence: ev('fixture://rel/A-r2-part') },
    { from: 'drawing:A-r2', to: 'drawing:A-r1', type: 'REVISION_OF', evidence: ev('fixture://rel/A-revision') },
    { from: 'drawing:B-r1', to: 'part:shaft-B', type: 'DOCUMENTS', evidence: ev('fixture://rel/B-r1-part') }
  ]
});

assert.equal(graph.related('drawing:A-r2', 'DOCUMENTS')[0].id, 'part:shaft-A');
assert.equal(graph.related('drawing:A-r2', 'REVISION_OF')[0].id, 'drawing:A-r1');

const memory = buildEngineeringMemory({
  records: [
    {
      id: 'drawing:A-r1', partId: 'part:shaft-A', revision: '1',
      searchTokens: ['drive', 'shaft', '42crmo4', 'turned'],
      engineeringVector: [0.90, 0.12, 0.44, 0.20], geometryVector: [0.81, 0.17, 0.51],
      material: '42CrMo4', process: 'turned', evidence: ev('fixture://drawing/A-r1')
    },
    {
      id: 'drawing:A-r2', partId: 'part:shaft-A', revision: '2', previousRevisionId: 'drawing:A-r1',
      searchTokens: ['drive', 'shaft', '42crmo4', 'turned', 'revision2'],
      engineeringVector: [0.91, 0.12, 0.45, 0.20], geometryVector: [0.82, 0.17, 0.50],
      material: '42CrMo4', process: 'turned', evidence: ev('fixture://drawing/A-r2')
    },
    {
      id: 'drawing:B-r1', partId: 'part:shaft-B', revision: '1',
      searchTokens: ['drive', 'shaft', '42crmo4', 'turned'],
      engineeringVector: [0.89, 0.13, 0.43, 0.21], geometryVector: [0.80, 0.18, 0.52],
      material: '42CrMo4', process: 'turned', evidence: ev('fixture://drawing/B-r1')
    },
    {
      id: 'drawing:C-r1', partId: 'part:bracket-C', revision: '1',
      searchTokens: ['mounting', 'bracket', 'aluminium', 'milled'],
      engineeringVector: [0.12, 0.92, 0.10, 0.80], geometryVector: [0.10, 0.92, 0.05],
      material: '6082-T6', process: 'milled', evidence: ev('fixture://drawing/C-r1')
    }
  ]
});

const ranked = memory.similarTo('drawing:A-r2');
assert.equal(ranked[0].recordId, 'drawing:B-r1');
assert(ranked[0].score > 0.95);
assert(ranked[0].score > ranked.at(-1).score);
assert.equal(memory.revisionChain('drawing:A-r2').map((record) => record.id).join(','), 'drawing:A-r2,drawing:A-r1');
assert.throws(() => buildEngineeringMemory({
  records: [{
    id: 'drawing:bad-r2', partId: 'part:bad', revision: '2', previousRevisionId: 'drawing:missing',
    searchTokens: [], evidence: ev('fixture://drawing/bad-r2')
  }]
}), /previousRevisionId does not exist/);

const receipt = {
  proof: 'engineering-memory-evidence-first-similarity',
  status: 'PASS',
  source_sha: process.env.CIRCLE_SHA1 || process.env.GITHUB_SHA || process.env.SOURCE_SHA || null,
  deployment_id: process.env.WFM_DEPLOYMENT_ID || null,
  deployment_proven: Boolean(process.env.WFM_DEPLOYMENT_ID),
  claim_boundary: 'Source-level synthetic proof. Similarity consumes supplied evidence-backed text/engineering/geometry features; OCR, GD&T extraction, CAD parsing and production-scale retrieval are not claimed.',
  scenario: {
    query_record: 'drawing:A-r2',
    top_cross_part_match: ranked[0].recordId,
    top_match_score: ranked[0].score,
    top_match_signal_breakdown: ranked[0].signals,
    same_part_revisions_excluded_from_cross_part_search: true,
    revision_lineage_proven: memory.revisionChain('drawing:A-r2').map((record) => record.id),
    missing_revision_parent_rejected: true,
    graph_document_to_part_link_proven: true
  }
};

writeFileSync('engineering-memory-proof.json', JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
