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
  return Object.entries(REQUIRED_CAPABILITY).every(([key, expected]) => capability?.[key] === expected)
    && validDigest(capability?.eligibilityEvidenceDigest);
}

function capabilityDigest(capability = {}) {
  return digest({
    ...Object.fromEntries(Object.keys(REQUIRED_CAPABILITY).sort().map((key) => [key, capability?.[key]])),
    eligibilityEvidenceDigest: validDigest(capability?.eligibilityEvidenceDigest)
      ? String(capability.eligibilityEvidenceDigest).toLowerCase()
      : null,
    storeIdentityDigest: validDigest(capability?.storeIdentityDigest)
      ? String(capability.storeIdentityDigest).toLowerCase()
      : null,
  });
}

function createT4ForensicFailoverStore({ stores = [], maxAttempts = 2 } = {}) {
  if (!Array.isArray(stores) || stores.length === 0) {
    throw fail('WFM_T4_FORENSICS_FAILOVER_CONFIG', 'At least one explicitly configured forensic store is required.');
  }
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 4) {
    throw fail('WFM_T4_FORENSICS_FAILOVER_CONFIG', 'Forensic failover maxAttempts must be between 1 and 4.');
  }

  const seenIds = new Set();
  const configured = stores.map((entry, index) => {
    const id = clean(entry?.id || `store-${index + 1}`, 48);
    if (!id || seenIds.has(id)) {
      throw fail('WFM_T4_FORENSICS_FAILOVER_CONFIG', 'Forensic store IDs must be unique and non-empty.');
    }
    seenIds.add(id);
    const capability = entry?.capability && typeof entry.capability === 'object' ? { ...entry.capability } : {};
    const store = entry?.store;
    const preserveMethod = typeof store?.preserve === 'function' ? store.preserve : null;
    const verifyMethod = typeof store?.verify === 'function' ? store.verify : null;
    return Object.freeze({
      id,
      capability: Object.freeze(capability),
      capabilityDigest: capabilityDigest(capability),
      preserve: preserveMethod ? preserveMethod.bind(store) : null,
      verify: verifyMethod ? verifyMethod.bind(store) : null,
      eligible: capabilityEligible(capability) && Boolean(preserveMethod) && Boolean(verifyMethod),
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
      throw fail('WFM_T4_FORENSICS_NO_ELIGIBLE_STORE', 'No pre-existing zero-incremental-cost forensic store has explicit eligibility evidence satisfying the safety contract.', {
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
        const receipt = await entry.preserve(input);
        const independentlyVerified = await entry.verify(receipt);
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
      return await entry.verify(receipt) === true;
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

function createT4RuntimeForensicStore({ stores = [], maxAttempts = 2, requiredEligibleStores = 2 } = {}) {
  if (!Number.isSafeInteger(requiredEligibleStores) || requiredEligibleStores < 2 || requiredEligibleStores > 4) {
    throw fail('WFM_T4_FORENSICS_RUNTIME_CONFIG', 'Zero-engineer T4 runtime requires between 2 and 4 independently attested eligible forensic stores.');
  }

  const genericEligible = (Array.isArray(stores) ? stores : [])
    .filter((entry) => capabilityEligible(entry?.capability)
      && typeof entry?.store?.preserve === 'function'
      && typeof entry?.store?.verify === 'function')
    .map((entry) => ({
      id: clean(entry?.id, 48),
      eligibilityEvidenceDigest: String(entry.capability.eligibilityEvidenceDigest).toLowerCase(),
      storeIdentityDigest: validDigest(entry?.capability?.storeIdentityDigest)
        ? String(entry.capability.storeIdentityDigest).toLowerCase()
        : null,
    }));

  if (genericEligible.length < requiredEligibleStores) {
    throw fail('WFM_T4_FORENSICS_RUNTIME_REDUNDANCY', 'Zero-engineer T4 runtime requires an independently eligible primary and secondary forensic sink at startup.', {
      eligibleStoreCount: genericEligible.length,
      requiredEligibleStores,
    });
  }

  const runtimeAttested = genericEligible
    .filter((entry) => entry.id && entry.storeIdentityDigest)
    .map((entry) => ({
      ...entry,
      attestationBindingDigest: digest({
        storeIdentityDigest: entry.storeIdentityDigest,
        eligibilityEvidenceDigest: entry.eligibilityEvidenceDigest,
      }),
    }));

  if (runtimeAttested.length < requiredEligibleStores) {
    throw fail('WFM_T4_FORENSICS_RUNTIME_ATTESTATION', 'Each zero-engineer runtime forensic sink requires an explicit store identity digest bound to eligibility evidence.', {
      runtimeAttestedStoreCount: runtimeAttested.length,
      requiredEligibleStores,
    });
  }

  const selected = runtimeAttested.slice(0, requiredEligibleStores);
  if (new Set(selected.map((entry) => entry.storeIdentityDigest)).size !== selected.length) {
    throw fail('WFM_T4_FORENSICS_RUNTIME_IDENTITY', 'Primary and secondary forensic sinks must have distinct attested store identities.');
  }
  if (new Set(selected.map((entry) => entry.attestationBindingDigest)).size !== selected.length) {
    throw fail('WFM_T4_FORENSICS_RUNTIME_ATTESTATION', 'Primary and secondary forensic sink attestations must bind to distinct store identities.');
  }

  const failoverStore = createT4ForensicFailoverStore({ stores, maxAttempts });
  if (failoverStore.eligibleStoreCount < requiredEligibleStores) {
    throw fail('WFM_T4_FORENSICS_RUNTIME_REDUNDANCY', 'Configured forensic stores do not satisfy the required runtime redundancy contract.');
  }

  const runtimeReadinessDigest = digest({
    schemaVersion: 1,
    failoverContractDigest: failoverStore.contractDigest,
    requiredEligibleStores,
    eligibleStoreCount: failoverStore.eligibleStoreCount,
    storeIdentityDigests: selected.map((entry) => entry.storeIdentityDigest),
    attestationBindingDigests: selected.map((entry) => entry.attestationBindingDigest),
    productionWriteAuthority: false,
    modelAuthorityGranted: false,
    createsResources: false,
  });

  return Object.freeze({
    ...failoverStore,
    runtimeReady: true,
    zeroEngineerFailoverReady: true,
    requiredEligibleStores,
    runtimeReadinessDigest,
  });
}

module.exports = {
  REQUIRED_CAPABILITY,
  capabilityEligible,
  createT4ForensicFailoverStore,
  createT4RuntimeForensicStore,
  digest,
};
