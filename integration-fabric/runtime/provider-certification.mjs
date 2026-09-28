import { createHash } from 'node:crypto';
import { buildSafeConnectionTest, validateConnectionEvidence } from './connection-test-plan.mjs';
import { connectorById } from './connector-registry.mjs';

const sha256 = value => createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex');

const PROFILES = Object.freeze({
  'sap-s4hana': Object.freeze({
    connectorId: 'sap-s4hana',
    evidenceLevelOnPass: 'sandbox-authenticated',
    environment: 'sandbox',
    adapter: 'odata',
    authMethod: 'api-key',
    credentialRef: 'secret://provider/sap-business-accelerator-hub/api-key',
    exactHost: 'sandbox.api.sap.com',
    sourceInstanceId: 'sap-business-accelerator-hub-s4hana-sandbox',
    dataProbeApproved: false,
    buildRequest(bundle) {
      if (!bundle?.apiKey) throw new Error('SAP API key secret is unavailable.');
      return {
        method: 'GET',
        url: 'https://sandbox.api.sap.com/s4hanacloud/sap/opu/odata4/sap/api_bank/srvd_a2x/sap/bank/0002/',
        headers: {
          APIKey: bundle.apiKey,
          Accept: 'application/json'
        }
      };
    },
    verify(payload) {
      if (!Array.isArray(payload?.value)) {
        throw new Error('SAP S/4HANA sandbox response is not the expected OData service-document shape.');
      }
      return { entitySetCount: payload.value.length, assertion: 'odata-v4-service-document' };
    }
  }),
  'xero': Object.freeze({
    connectorId: 'xero',
    evidenceLevelOnPass: 'sandbox-authenticated',
    environment: 'sandbox',
    adapter: 'http-json',
    authMethod: 'oauth2',
    credentialRef: 'secret://provider/xero/demo-company',
    exactHost: 'api.xero.com',
    dataProbeApproved: true,
    sourceInstanceId(bundle) {
      if (!bundle?.tenantId) throw new Error('Xero demo tenant ID is unavailable.');
      return 'xero-demo-' + sha256(bundle.tenantId).slice(0, 16);
    },
    buildRequest(bundle) {
      if (!bundle?.accessToken || !bundle?.tenantId) throw new Error('Xero demo OAuth secret bundle is incomplete.');
      return {
        method: 'GET',
        url: 'https://api.xero.com/api.xro/2.0/Organisation',
        headers: {
          Authorization: 'Bearer ' + bundle.accessToken,
          'xero-tenant-id': bundle.tenantId,
          Accept: 'application/json'
        }
      };
    },
    verify(payload) {
      const organisation = payload?.Organisations?.[0];
      if (!organisation || organisation.IsDemoCompany !== true) {
        throw new Error('Xero target is not independently attested as a Demo Company; proof fails closed.');
      }
      if (organisation.OrganisationStatus && organisation.OrganisationStatus !== 'ACTIVE') {
        throw new Error('Xero Demo Company is not ACTIVE.');
      }
      return {
        sampleCount: 1,
        assertion: 'organisation-is-demo-company',
        organisationIdDigest: organisation.OrganisationID ? sha256(organisation.OrganisationID) : null
      };
    }
  })
});

function redactRequest(request) {
  const headers = {};
  for (const [key, value] of Object.entries(request.headers || {})) {
    headers[key] = /authorization|apikey|api-key|xero-tenant-id|cookie/i.test(key) ? '[REDACTED]' : value;
  }
  const url = new URL(request.url);
  return { method: request.method, origin: url.origin, path: url.pathname, querySha256: url.search ? sha256(url.search) : null, headers };
}

function assertExactCandidateSha(value) {
  const sha = String(value || '').trim();
  if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error('Exact 40-character VECTOR candidate SHA is required.');
  return sha.toLowerCase();
}

function assertRequestBoundary(profile, request) {
  const method = String(request.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD'].includes(method)) throw new Error('Provider certification executor is read-only.');
  const url = new URL(request.url);
  if (url.protocol !== 'https:') throw new Error('Provider certification requires HTTPS.');
  if (url.hostname !== profile.exactHost) throw new Error('Provider endpoint is not the exact allowlisted sandbox/demo host.');
  return url;
}

export async function certifyProviderSandbox({
  providerKey,
  candidateSha,
  resolveSecretBundle,
  fetchImpl = globalThis.fetch,
  nowMs = Date.now()
} = {}) {
  const profile = PROFILES[providerKey];
  if (!profile) throw new Error('Provider is not approved for VECTOR sandbox certification.');
  if (typeof resolveSecretBundle !== 'function') throw new Error('A managed secret resolver is required.');
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');

  const exactCandidateSha = assertExactCandidateSha(candidateSha);
  const connector = connectorById(profile.connectorId);
  if (!connector) throw new Error('VECTOR connector is not present in the Integration Fabric registry.');
  if (connector.security?.readOnlyDefault !== true || connector.security?.writeEnabled === true) {
    throw new Error('VECTOR connector is not fail-closed read-only.');
  }

  const secretBundle = await resolveSecretBundle(profile.credentialRef);
  if (!secretBundle || typeof secretBundle !== 'object') throw new Error('Managed secret resolver returned no credential bundle.');

  const sourceInstanceId = typeof profile.sourceInstanceId === 'function'
    ? profile.sourceInstanceId(secretBundle)
    : profile.sourceInstanceId;

  const plan = buildSafeConnectionTest({
    providerKey: profile.connectorId,
    sourceInstanceId,
    environment: profile.environment,
    adapter: profile.adapter,
    authMethod: profile.authMethod,
    credentialRef: profile.credentialRef,
    capabilities: ['metadata', 'bounded-read'],
    requestedSemanticScopes: connector.canonicalTargets || [],
    dataProbeApproved: profile.dataProbeApproved === true,
    allowWrites: false
  });

  const request = profile.buildRequest(secretBundle);
  assertRequestBoundary(profile, request);
  const started = Date.now();
  const response = await fetchImpl(request.url, {
    method: request.method,
    headers: request.headers,
    redirect: 'error',
    signal: AbortSignal.timeout(15_000)
  });
  const latencyMs = Date.now() - started;
  const body = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers?.get?.('content-type') || '';

  if (response.status < 200 || response.status >= 300) {
    throw new Error('Provider sandbox authentication/read failed with HTTP ' + response.status + '.');
  }
  if (!contentType.toLowerCase().includes('json')) {
    throw new Error('Provider sandbox returned a non-JSON response.');
  }

  let payload;
  try { payload = JSON.parse(body.toString('utf8')); }
  catch { throw new Error('Provider sandbox returned invalid JSON.'); }

  const providerAssertion = profile.verify(payload);
  const observedAt = new Date(nowMs).toISOString();
  const steps = plan.steps.map(step => ({ id: step.id, status: 'PASS' }));
  const evidence = {
    configurationFingerprint: plan.configurationFingerprint,
    providerKey: plan.configuration.providerKey,
    sourceInstanceId: plan.configuration.sourceInstanceId,
    environment: plan.configuration.environment,
    readOnly: true,
    rawCredentialObserved: false,
    employeeOrPayrollDataObserved: false,
    latencyMs,
    observedAt,
    steps
  };
  const validation = validateConnectionEvidence(plan, evidence, { nowMs });

  if (!['CONNECTION_VERIFIED', 'CONNECTION_AND_SAMPLE_VERIFIED'].includes(validation.status)) {
    throw new Error('VECTOR connection evidence rejected: ' + validation.reasons.join(','));
  }

  return Object.freeze({
    schemaVersion: 1,
    status: 'PASS',
    evidenceLevel: profile.evidenceLevelOnPass,
    claimBoundary: 'Genuine vendor sandbox/demo authentication plus a bounded read through the VECTOR Integration Fabric. This is not customer-production or production-certified evidence.',
    providerKey: profile.connectorId,
    vectorCandidateSha: exactCandidateSha,
    connectorRegistryEvidenceLevelBeforeRun: connector.evidenceLevel,
    configurationFingerprint: plan.configurationFingerprint,
    sourceInstanceIdDigest: sha256(sourceInstanceId),
    request: redactRequest(request),
    response: {
      status: response.status,
      contentType,
      bodySha256: sha256(body),
      bodyBytes: body.length
    },
    providerAssertion,
    connectionValidation: validation,
    observedAt
  });
}

export function providerCertificationProfiles() {
  return Object.keys(PROFILES);
}
