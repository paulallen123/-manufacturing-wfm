'use strict';

// Presentation of existing broker status only. No credential or collection authority.
const PROVIDERS = new Set(['netsuite', 'successfactors']);
function refuse(status) {
  const error = new Error(status === 403 ? 'Company configuration permission required.' : 'Provider field checks are unavailable.');
  error.status = status;
  error.code = status === 403 ? 'WFM_METADATA_REVIEW_FORBIDDEN' : 'WFM_METADATA_REVIEW_UNAVAILABLE';
  throw error;
}
function boundedText(value, maximum) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function statusForActor(brokerStatus, actor) {
  if (!actor || !boundedText(actor.tenant, 120) || !Array.isArray(actor.permissions) ||
      !actor.permissions.includes('company.configure')) refuse(403);
  if (!brokerStatus || !Array.isArray(brokerStatus.profiles)) refuse(503);
  const own = brokerStatus.profiles.filter(row => row && row.tenant === actor.tenant);
  if (own.length > 100) refuse(503);
  const ids = new Set();
  const profiles = own.map(row => {
    if (!boundedText(row.id, 100) || !/^[A-Za-z0-9_.:-]{3,100}$/.test(row.id) || ids.has(row.id) ||
        !PROVIDERS.has(row.provider) || !boundedText(row.system, 120) || row.activationAuthority !== false) refuse(503);
    ids.add(row.id);
    return Object.freeze({ id: row.id, provider: row.provider, system: row.system });
  });
  return Object.freeze({
    schemaVersion: 'vector-provider-metadata-review-v1',
    configured: profiles.length > 0,
    profiles: Object.freeze(profiles),
    reviewOnly: true,
    liveSyncVerified: false
  });
}

module.exports = { statusForActor };
