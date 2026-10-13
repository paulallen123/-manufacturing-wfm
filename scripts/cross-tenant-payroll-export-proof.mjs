const SHA = /^[0-9a-f]{40}$/;

function oneHeader(headers, name) {
  if (!Array.isArray(headers)) return null;
  const values = headers.filter(h => h && String(h.name).toLowerCase() === name).map(h => h.value);
  return values.length === 1 && typeof values[0] === 'string' ? values[0] : null;
}

// The caller must supply an authenticated tenant-B request context and an
// independently read back tenant-A batch. This function performs one GET only.
export async function probeCrossTenantPayrollExport({
  request, baseURL, actorTenantId, batchTenantId, batchId, candidateSha,
} = {}) {
  const failures = [];
  if (!request || typeof request.get !== 'function') failures.push('missing_authenticated_request_context');
  if (!actorTenantId || !batchTenantId || actorTenantId === batchTenantId) failures.push('invalid_cross_tenant_scope');
  if (typeof batchId !== 'string' || !batchId.trim() || batchId.length > 180) failures.push('invalid_batch_id');
  if (typeof candidateSha !== 'string' || !SHA.test(candidateSha)) failures.push('invalid_candidate_sha');
  let origin;
  try {
    origin = new URL(baseURL);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash) throw new Error();
  } catch {
    failures.push('invalid_https_origin');
  }
  if (failures.length) return { status: 'FAIL', failures, responseStatus: null, hostedProof: false };

  const url = new URL('/api/payroll-export/' + encodeURIComponent(batchId), origin);
  let responseStatus;
  let headers;
  try {
    const response = await request.get(url.href, { failOnStatusCode: false, maxRedirects: 0 });
    responseStatus = response.status();
    headers = await response.headersArray();
  } catch {
    return { status: 'FAIL', failures: ['response_capture_failed'], responseStatus: null, hostedProof: false };
  }
  if (responseStatus !== 403 && responseStatus !== 404) failures.push('cross_tenant_export_not_denied');
  if (!Array.isArray(headers)) failures.push('raw_headers_unavailable');
  else {
    const expected = {
      'x-wfm-source-sha': candidateSha,
      'x-wfm-source-binding': 'build-file-matched',
      'x-wfm-fixture-only': 'true',
    };
    for (const [name, value] of Object.entries(expected)) {
      if (oneHeader(headers, name) !== value) failures.push('source_identity_mismatch:' + name);
    }
    for (const name of ['content-disposition', 'x-export-sha256']) {
      if (headers.some(h => String(h?.name).toLowerCase() === name)) failures.push('export_artifact_header_leaked:' + name);
    }
    const contentTypes = headers.filter(h => String(h?.name).toLowerCase() === 'content-type');
    if (contentTypes.length > 1 || contentTypes.some(h => /(?:text\/csv|application\/octet-stream)/i.test(String(h.value)))) {
      failures.push('export_content_type_leaked');
    }
  }
  return {
    status: failures.length ? 'FAIL' : 'PASS',
    failures,
    responseStatus,
    hostedProof: false,
  };
}
