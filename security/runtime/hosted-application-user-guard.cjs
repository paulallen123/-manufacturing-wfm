'use strict';

function enforceHostedApplicationUser({ hosted, geteuid = process.geteuid } = {}) {
  if (!hosted) return { enforced: false };
  if (typeof geteuid !== 'function') throw new Error('WFM_HOSTED_APPLICATION_UID_UNAVAILABLE');
  const uid = geteuid();
  if (!Number.isSafeInteger(uid) || uid < 1) throw new Error('WFM_HOSTED_APPLICATION_ROOT_FORBIDDEN');
  return { enforced: true, uid };
}

module.exports = { enforceHostedApplicationUser };
