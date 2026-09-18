import http from 'node:http';
import { createRequirementPlan, clockingExceptions, reconcileInvoice, estimateTouchlessSavings, DEFAULT_POLICY } from './engine.mjs';
import {
  buildAdaptiveSupplierReleasePlan,
  buildWorkerOfferProtocol,
  validateAgencyNominations,
  buildPreShiftAssurancePlan,
  assessSupplyChainAssurance
} from './protocol.mjs';
import { buildShortfallRecoveryPlan } from './recovery.mjs';

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/health') return json(res, 200, { ok: true, service: 'wfm-agency-labour-v1-proof' });
    if (req.method === 'GET' && req.url === '/api/policy') return json(res, 200, DEFAULT_POLICY);
    if (req.method === 'POST' && req.url === '/api/requirements/plan') return json(res, 200, createRequirementPlan(await body(req)));
    if (req.method === 'POST' && req.url === '/api/suppliers/release-plan') return json(res, 200, buildAdaptiveSupplierReleasePlan(await body(req)));
    if (req.method === 'POST' && req.url === '/api/suppliers/recover-shortfall') return json(res, 200, buildShortfallRecoveryPlan(await body(req)));
    if (req.method === 'POST' && req.url === '/api/workers/offer-protocol') return json(res, 200, buildWorkerOfferProtocol(await body(req)));
    if (req.method === 'POST' && req.url === '/api/workers/nominations/validate') return json(res, 200, validateAgencyNominations(await body(req)));
    if (req.method === 'POST' && req.url === '/api/attendance/pre-shift-assurance') return json(res, 200, buildPreShiftAssurancePlan(await body(req)));
    if (req.method === 'POST' && req.url === '/api/attendance/exceptions') return json(res, 200, clockingExceptions(await body(req)));
    if (req.method === 'POST' && req.url === '/api/invoices/reconcile') return json(res, 200, reconcileInvoice(await body(req)));
    if (req.method === 'POST' && req.url === '/api/compliance/supply-chain-assurance') return json(res, 200, assessSupplyChainAssurance(await body(req)));
    if (req.method === 'POST' && req.url === '/api/value/touchless') return json(res, 200, estimateTouchlessSavings(await body(req)));
    return json(res, 404, { error: 'not_found' });
  } catch (error) {
    return json(res, 400, { error: 'bad_request', message: error.message });
  }
});

server.listen(Number(process.env.PORT || 3000), '0.0.0.0');
