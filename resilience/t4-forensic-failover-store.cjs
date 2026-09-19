'use strict';

const { createHash } = require('node:crypto');

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
}

function validDigest(value) {
  return /^[a-f0-9]{64}$/.test(String(value ?? '').toLowerCase());
}

function clean(value, max = 120) {
  return String(value ?? '').trim().replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').slice(0, max);
}

function fail(code, message, detail = {}) {
  return Object.assign(new Error(message), { code, detail });
}

const REQUIRED_CAPABILITY = Object.freeze({
  preExisting: true,
  sameTenantOnly: true,
  isolated: true,
  writeOnce: true,
  independentlyVerifiable: true,
  incrementalCostZero: true,
  productionWriteAuthority: false,
  modelVisibleReusableSecrets: false,
  createsResources: false,
});

function capabilityEligible(capability = {}) {
  return Object.entries(REQUIRED_CAPABILITY).every(([key, expected]) => capability?.[key] === expected);
}

function capabilityDigest(capability = {}) {
  return digest(Object.fromEntries(Object.keys(REQUIRED_CAPABILITY).sort().map((key) => [key, capability?.[key]])));
}

function createT4ForensicFailoverStore({ stores = [], maxAttempts = 2 } = {}) {
  if (!Array.isArray(stores) || stores.length === 0) {
    throw fail('WFM_T4_FORENSICS_FAILOVER_CONFIG', 'At least one explicitly configured forensic store is required.');
  }
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 4) {
    throw fail('WFM_T4_FORENSICS_FAILOVER_CONFIG', 'Forensic failover maxAttempts must be between 1 and 4.');
  }

  const configured = stores.map((entry, index) => {
    const id = clean(entry?.id || `store-${index + 1}`, 80);
    const capability = entry?.capability && typeof entry.capability === 'object' ? { ...entry.capability } : {};
    return Object.freeze({
      id,
      store: entry?.store,
      capability: Object.freeze(capability),
      capabilityDigest: capabilityDigest(capability),
      eligible: capabilityEligible(capability)
        && typeof entry?.store?.preserve === 'function'
        && typeof entry?.store?.verify === 'function',
    });
  });

  const eligible = configured.filter((entry) => entry.eligible);
  const contractDigest = digest({
    schemaVersion: 1,
    maxAttempts,
    stores: configured.map((entry) => ({
      id: entry.id,
      eligible: entry.eligible,
      capabilityDigest: entry.capabilityDigest,
    })),
  });

  async function preserve(input = {}) {
    const tenant = clean(input.tenant, 100);
    if (!tenant) throw fail('WFM_T4_FORENSICS_INPUT', 'Forensic failover requires an explicit tenant.');
    if (eligible.length === 0) {
      throw fail('WFM_T4_FORENSICS_NO_ELIGIBLE_STORE', 'No pre-existing zero-incremental-cost forensic store satisfies the safety contract.', {
        contractDigest,
      });
    }

    const expectedTenantDigest = digest(`tenant:${tenant}`);
    const attempts = [];
    for (const entry of eligible.slice(0, maxAttempts)) {
      const attempt = {
        storeId: entry.id,
        capabilityDigest: entry.capabilityDigest,
        status: 'failed',
        failureCode: null,
      };
      try {
        const receipt = await entry.store.preserve(input);
        const independentlyVerified = await entry.store.verify(receipt);
        const receiptValid = receipt?.verified === true
          && receipt?.immutable === true
          && validDigest(receipt?.forensicDigest)
          && validDigest(receipt?.storageKey)
          && receipt?.tenantDigest === expectedTenantDigest
          && independentlyVerified === true;
        if (!receiptValid) {
          attempt.failureCode = 'WFM_T4_FORENSICS_FAILOVER_VERIFY';
          attempts.push(attempt);
          continue;
        }

        attempt.status = 'verified';
        attempts.push(attempt);
        const attemptDigest = digest(attempts);
        return {
          ...receipt,
          storageMode: `write-once-failover:${entry.id}`,
          selectedStoreId: entry.id,
          selectedStoreCapabilityDigest: entry.capabilityDigest,
          failoverUsed: attempts.length > 1,
          attemptCount: attempts.length,
          attemptDigest,
          failoverContractDigest: contractDigest,
          failoverDigest: digest({
            contractDigest,
            selectedStoreId: entry.id,
            selectedStoreCapabilityDigest: entry.capabilityDigest,
            attemptDigest,
            forensicDigest: receipt.forensicDigest,
            tenantDigest: receipt.tenantDigest,
            storageKey: receipt.storageKey,
          }),
        };
      } catch (error) {
        attempt.failureCode = clean(error?.code || 'WFM_T4_FORENSICS_STORE_FAILURE', 100);
        attempts.push(attempt);
      }
    }

    throw fail('WFM_T4_FORENSICS_FAILOVER_EXHAUSTED', 'All eligible bounded forensic preservation attempts failed closed.', {
      contractDigest,
      attemptCount: attempts.length,
      attemptDigest: digest(attempts),
      attempts,
    });
  }

  async function verify(receipt = {}) {
    if (!validDigest(receipt?.forensicDigest)
      || !validDigest(receipt?.storageKey)
      || !validDigest(receipt?.tenantDigest)
      || !validDigest(receipt?.selectedStoreCapabilityDigest)
      || !validDigest(receipt?.attemptDigest)
      || !validDigest(receipt?.failoverContractDigest)
      || !validDigest(receipt?.failoverDigest)
      || receipt.failoverContractDigest !== contractDigest) return false;
    const entry = configured.find((candidate) => candidate.id === receipt.selectedStoreId);
    if (!entry?.eligible || entry.capabilityDigest !== receipt.selectedStoreCapabilityDigest) return false;
    const expectedFailoverDigest = digest({
      contractDigest,
      selectedStoreId: receipt.selectedStoreId,
      selectedStoreCapabilityDigest: receipt.selectedStoreCapabilityDigest,
      attemptDigest: receipt.attemptDigest,
      forensicDigest: receipt.forensicDigest,
      tenantDigest: receipt.tenantDigest,
      storageKey: receipt.storageKey,
    });
    if (expectedFailoverDigest !== receipt.failoverDigest) return false;
    try {
      return await entry.store.verify(receipt) === true;
    } catch {
      return false;
    }
  }

  return Object.freeze({
    preserve,
    verify,
    contractDigest,
    eligibleStoreCount: eligible.length,
    configuredStoreCount: configured.length,
    maxAttempts,
    productionWriteAuthority: false,
    modelAuthorityGranted: false,
    createsResources: false,
  });
}

module.exports = {
  REQUIRED_CAPABILITY,
  capabilityEligible,
  createT4ForensicFailoverStore,
  digest,
};
