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
  const finalReadbackRecoveryMaxAttempts = 1;
  const contractDigest = digest({
    schemaVersion: 3,
    maxAttempts,
    finalReadbackRecoveryMaxAttempts,
    stores: configured.map((entry) => ({
      id: entry.id,
      eligible: entry.eligible,
      capabilityDigest: entry.capabilityDigest,
    })),
  });

  const makeFailoverDigest = ({
    selectedStoreId,
    selectedStoreCapabilityDigest,
    attemptCount,
    attemptedStoreIds,
    attemptDigest,
    forensicDigest,
    tenantDigest,
    storageKey,
    finalReadbackRecoveryUsed = false,
    finalReadbackRecoveryFromStoreId = null,
    finalReadbackRecoveryAttemptDigest = null,
  }) => digest({
    contractDigest,
    selectedStoreId,
    selectedStoreCapabilityDigest,
    attemptCount: Number.isSafeInteger(attemptCount) ? attemptCount : null,
    attemptedStoreIds: Array.isArray(attemptedStoreIds) ? attemptedStoreIds.map((id) => clean(id, 48)) : null,
    attemptDigest,
    forensicDigest,
    tenantDigest,
    storageKey,
    finalReadbackRecoveryUsed: finalReadbackRecoveryUsed === true,
    finalReadbackRecoveryFromStoreId: finalReadbackRecoveryFromStoreId || null,
    finalReadbackRecoveryAttemptDigest: finalReadbackRecoveryAttemptDigest || null,
  });

  function recoveryAuthority(priorReceipt = {}, expectedTenantDigest) {
    const priorStoreId = clean(priorReceipt?.selectedStoreId, 48);
    const attemptedStoreIds = Array.isArray(priorReceipt?.attemptedStoreIds)
      ? priorReceipt.attemptedStoreIds.map((id) => clean(id, 48)).filter(Boolean)
      : [];
    const validBase = priorStoreId
      && priorReceipt?.failoverContractDigest === contractDigest
      && validDigest(priorReceipt?.forensicDigest)
      && validDigest(priorReceipt?.tenantDigest)
      && validDigest(priorReceipt?.storageKey)
      && validDigest(priorReceipt?.selectedStoreCapabilityDigest)
      && validDigest(priorReceipt?.attemptDigest)
      && validDigest(priorReceipt?.failoverDigest)
      && priorReceipt?.tenantDigest === expectedTenantDigest
      && priorReceipt?.finalReadbackRecoveryUsed !== true
      && priorReceipt?.finalReadbackRecoveryFromStoreId == null
      && priorReceipt?.finalReadbackRecoveryAttemptDigest == null
      && Number.isSafeInteger(priorReceipt?.attemptCount)
      && priorReceipt.attemptCount === attemptedStoreIds.length
      && attemptedStoreIds.length >= 1
      && attemptedStoreIds.length <= maxAttempts
      && new Set(attemptedStoreIds).size === attemptedStoreIds.length
      && attemptedStoreIds.at(-1) === priorStoreId;
    if (!validBase) return null;

    const expectedPrefix = eligible.slice(0, attemptedStoreIds.length).map((entry) => entry.id);
    if (expectedPrefix.length !== attemptedStoreIds.length
      || expectedPrefix.some((id, index) => id !== attemptedStoreIds[index])) return null;

    const priorEntry = eligible[attemptedStoreIds.length - 1];
    if (!priorEntry
      || priorEntry.id !== priorStoreId
      || priorEntry.capabilityDigest !== priorReceipt.selectedStoreCapabilityDigest) return null;

    if (makeFailoverDigest(priorReceipt) !== priorReceipt.failoverDigest) return null;
    return Object.freeze({ priorStoreId, attemptedStoreIds: Object.freeze([...attemptedStoreIds]), priorEntryIndex: attemptedStoreIds.length - 1 });
  }

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
        const attemptedStoreIds = attempts.map((item) => item.storeId);
        const result = {
          ...receipt,
          storageMode: `write-once-failover:${entry.id}`,
          selectedStoreId: entry.id,
          selectedStoreCapabilityDigest: entry.capabilityDigest,
          failoverUsed: attempts.length > 1,
          attemptCount: attempts.length,
          attemptedStoreIds,
          attemptDigest,
          failoverContractDigest: contractDigest,
          finalReadbackRecoveryUsed: false,
          finalReadbackRecoveryFromStoreId: null,
          finalReadbackRecoveryAttemptDigest: null,
        };
        result.failoverDigest = makeFailoverDigest(result);
        return result;
      } catch (error) {
        attempt.failureCode = clean(error?.code || 'WFM_T4_FORENSICS_STORE_FAILURE', 100);
        attempts.push(attempt);
      }
    }

    throw fail('WFM_T4_FORENSICS_FAILOVER_EXHAUSTED', 'All eligible bounded forensic preservation attempts failed closed.', {
      contractDigest,
      attemptCount: attempts.length,
      attemptedStoreIds: attempts.map((item) => item.storeId),
      attemptDigest: digest(attempts),
      attempts,
    });
  }

  async function recoverAfterFinalReadbackFailure({ priorReceipt = {}, input = {} } = {}) {
    const tenant = clean(input.tenant, 100);
    if (!tenant) {
      throw fail('WFM_T4_FORENSICS_FINAL_RECOVERY_INPUT', 'Final forensic recovery requires a contract-bound prior receipt and explicit tenant.');
    }

    const expectedTenantDigest = digest(`tenant:${tenant}`);
    const authority = recoveryAuthority(priorReceipt, expectedTenantDigest);
    if (!authority) {
      throw fail('WFM_T4_FORENSICS_FINAL_RECOVERY_AUTHORITY', 'Final forensic recovery refused an unauthenticated, replayed or contract-drifted prior failover receipt.');
    }

    const candidate = eligible[authority.priorEntryIndex + 1];
    if (!candidate || authority.attemptedStoreIds.includes(candidate.id)) {
      throw fail('WFM_T4_FORENSICS_FINAL_RECOVERY_UNAVAILABLE', 'No previously untried independently attested forensic sink is available for bounded final read-back recovery.', {
        contractDigest,
        priorStoreId: authority.priorStoreId,
        attemptedStoreIds: authority.attemptedStoreIds,
      });
    }

    const recoveryAttempt = {
      fromStoreId: authority.priorStoreId,
      toStoreId: candidate.id,
      capabilityDigest: candidate.capabilityDigest,
      status: 'failed',
      failureCode: null,
    };
    try {
      const receipt = await candidate.preserve(input);
      const independentlyVerified = await candidate.verify(receipt);
      const receiptValid = receipt?.verified === true
        && receipt?.immutable === true
        && validDigest(receipt?.forensicDigest)
        && validDigest(receipt?.storageKey)
        && receipt?.tenantDigest === expectedTenantDigest
        && independentlyVerified === true;
      if (!receiptValid) {
        recoveryAttempt.failureCode = 'WFM_T4_FORENSICS_FINAL_RECOVERY_VERIFY';
        throw fail('WFM_T4_FORENSICS_FINAL_RECOVERY_VERIFY', 'Different forensic sink failed independent preservation verification.');
      }

      recoveryAttempt.status = 'verified';
      const finalReadbackRecoveryAttemptDigest = digest(recoveryAttempt);
      const attemptedStoreIds = [...authority.attemptedStoreIds, candidate.id];
      const result = {
        ...receipt,
        storageMode: `write-once-failover:${candidate.id}`,
        selectedStoreId: candidate.id,
        selectedStoreCapabilityDigest: candidate.capabilityDigest,
        failoverUsed: true,
        attemptCount: attemptedStoreIds.length,
        attemptedStoreIds,
        attemptDigest: digest({
          priorAttemptDigest: priorReceipt.attemptDigest,
          finalReadbackRecoveryAttemptDigest,
        }),
        failoverContractDigest: contractDigest,
        finalReadbackRecoveryUsed: true,
        finalReadbackRecoveryFromStoreId: authority.priorStoreId,
        finalReadbackRecoveryAttemptDigest,
      };
      result.failoverDigest = makeFailoverDigest(result);
      return result;
    } catch (error) {
      recoveryAttempt.failureCode = recoveryAttempt.failureCode || clean(error?.code || 'WFM_T4_FORENSICS_FINAL_RECOVERY_STORE_FAILURE', 100);
      throw fail('WFM_T4_FORENSICS_FINAL_RECOVERY_EXHAUSTED', 'The single bounded final read-back recovery attempt failed closed.', {
        contractDigest,
        priorStoreId: authority.priorStoreId,
        attemptedStoreIds: authority.attemptedStoreIds,
        recoveryAttemptDigest: digest(recoveryAttempt),
        recoveryAttempt,
      });
    }
  }

  async function verify(receipt = {}) {
    const attemptedStoreIds = Array.isArray(receipt?.attemptedStoreIds)
      ? receipt.attemptedStoreIds.map((id) => clean(id, 48)).filter(Boolean)
      : [];
    if (!validDigest(receipt?.forensicDigest)
      || !validDigest(receipt?.storageKey)
      || !validDigest(receipt?.tenantDigest)
      || !validDigest(receipt?.selectedStoreCapabilityDigest)
      || !validDigest(receipt?.attemptDigest)
      || !validDigest(receipt?.failoverContractDigest)
      || !validDigest(receipt?.failoverDigest)
      || receipt.failoverContractDigest !== contractDigest
      || !Number.isSafeInteger(receipt?.attemptCount)
      || receipt.attemptCount !== attemptedStoreIds.length
      || attemptedStoreIds.length < 1
      || attemptedStoreIds.length > maxAttempts + finalReadbackRecoveryMaxAttempts
      || new Set(attemptedStoreIds).size !== attemptedStoreIds.length
      || attemptedStoreIds.at(-1) !== receipt.selectedStoreId) return false;

    const expectedPrefix = eligible.slice(0, attemptedStoreIds.length).map((entry) => entry.id);
    if (expectedPrefix.length !== attemptedStoreIds.length
      || expectedPrefix.some((id, index) => id !== attemptedStoreIds[index])) return false;

    const recoveryUsed = receipt.finalReadbackRecoveryUsed === true;
    if (recoveryUsed) {
      if (!clean(receipt.finalReadbackRecoveryFromStoreId, 48)
        || attemptedStoreIds.length < 2
        || receipt.finalReadbackRecoveryFromStoreId !== attemptedStoreIds.at(-2)
        || receipt.finalReadbackRecoveryFromStoreId === receipt.selectedStoreId
        || !validDigest(receipt.finalReadbackRecoveryAttemptDigest)) return false;
    } else if (receipt.finalReadbackRecoveryFromStoreId != null || receipt.finalReadbackRecoveryAttemptDigest != null) {
      return false;
    }
    const entry = configured.find((candidate) => candidate.id === receipt.selectedStoreId);
    if (!entry?.eligible || entry.capabilityDigest !== receipt.selectedStoreCapabilityDigest) return false;
    const expectedFailoverDigest = makeFailoverDigest(receipt);
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
    recoverAfterFinalReadbackFailure,
    contractDigest,
    eligibleStoreCount: eligible.length,
    configuredStoreCount: configured.length,
    maxAttempts,
    finalReadbackRecoveryMaxAttempts,
    productionWriteAuthority: false,
    modelAuthorityGranted: false,
    createsResources: false,
  });
}

function createT4RuntimeForensicStore({ stores = [], maxAttempts = 2, requiredEligibleStores = 2 } = {}) {
  if (!Number.isSafeInteger(requiredEligibleStores) || requiredEligibleStores < 2 || requiredEligibleStores > 4) {
    throw fail('WFM_T4_FORENSICS_RUNTIME_CONFIG', 'Zero-engineer T4 runtime requires between 2 and 4 independently attested eligible forensic stores.');
  }
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < requiredEligibleStores || maxAttempts > 4) {
    throw fail('WFM_T4_FORENSICS_RUNTIME_ATTEMPTS', 'Zero-engineer T4 runtime maxAttempts must cover every required forensic sink and remain bounded to four attempts.', {
      maxAttempts,
      requiredEligibleStores,
    });
  }

  const runtimeAttested = (Array.isArray(stores) ? stores : [])
    .map((entry, index) => {
      const capability = entry?.capability && typeof entry.capability === 'object' ? entry.capability : {};
      return {
        source: entry,
        index,
        id: clean(entry?.id, 48),
        eligible: capabilityEligible(capability)
          && typeof entry?.store?.preserve === 'function'
          && typeof entry?.store?.verify === 'function',
        eligibilityEvidenceDigest: validDigest(capability?.eligibilityEvidenceDigest)
          ? String(capability.eligibilityEvidenceDigest).toLowerCase()
          : null,
        storeIdentityDigest: validDigest(capability?.storeIdentityDigest)
          ? String(capability.storeIdentityDigest).toLowerCase()
          : null,
      };
    })
    .filter((entry) => entry.eligible && entry.id && entry.storeIdentityDigest)
    .map((entry) => ({
      ...entry,
      attestationBindingDigest: digest({
        storeIdentityDigest: entry.storeIdentityDigest,
        eligibilityEvidenceDigest: entry.eligibilityEvidenceDigest,
      }),
    }));

  if (runtimeAttested.length < requiredEligibleStores) {
    throw fail('WFM_T4_FORENSICS_RUNTIME_ATTESTATION', 'Zero-engineer T4 runtime requires an independently attested primary and secondary forensic sink at startup.', {
      runtimeAttestedStoreCount: runtimeAttested.length,
      requiredEligibleStores,
    });
  }

  const ids = runtimeAttested.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) {
    throw fail('WFM_T4_FORENSICS_RUNTIME_IDENTITY', 'Runtime forensic sink IDs must be unique across every executable sink.');
  }
  const storeIdentityDigests = runtimeAttested.map((entry) => entry.storeIdentityDigest);
  if (new Set(storeIdentityDigests).size !== storeIdentityDigests.length) {
    throw fail('WFM_T4_FORENSICS_RUNTIME_IDENTITY', 'Every executable runtime forensic sink must have a distinct attested store identity.');
  }
  const attestationBindingDigests = runtimeAttested.map((entry) => entry.attestationBindingDigest);
  if (new Set(attestationBindingDigests).size !== attestationBindingDigests.length) {
    throw fail('WFM_T4_FORENSICS_RUNTIME_ATTESTATION', 'Every executable runtime forensic sink attestation must bind to a distinct store identity.');
  }

  const selected = runtimeAttested.slice(0, maxAttempts);
  if (selected.length < requiredEligibleStores) {
    throw fail('WFM_T4_FORENSICS_RUNTIME_REDUNDANCY', 'Bounded forensic execution set does not contain the required independently attested sinks.', {
      executableStoreCount: selected.length,
      requiredEligibleStores,
    });
  }

  const failoverStore = createT4ForensicFailoverStore({
    stores: selected.map((entry) => entry.source),
    maxAttempts,
  });
  if (failoverStore.eligibleStoreCount < requiredEligibleStores) {
    throw fail('WFM_T4_FORENSICS_RUNTIME_REDUNDANCY', 'Configured forensic stores do not satisfy the required runtime redundancy contract.');
  }

  const runtimeReadinessDigest = digest({
    schemaVersion: 3,
    failoverContractDigest: failoverStore.contractDigest,
    requiredEligibleStores,
    eligibleStoreCount: failoverStore.eligibleStoreCount,
    executableStoreCount: selected.length,
    maxAttempts,
    finalReadbackRecoveryMaxAttempts: failoverStore.finalReadbackRecoveryMaxAttempts,
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
    runtimeAttestedStoreCount: runtimeAttested.length,
    executableStoreCount: selected.length,
    runtimeReadinessDigest,
  });
}

function createT4RuntimeContainmentController({
  stores = [],
  maxAttempts = 2,
  requiredEligibleStores = 2,
  containmentExecutor,
  rollbackExecutor,
  now = Date.now,
  maxActions = 4,
} = {}) {
  const forensicStore = createT4RuntimeForensicStore({ stores, maxAttempts, requiredEligibleStores });
  if (forensicStore.runtimeReady !== true
    || forensicStore.zeroEngineerFailoverReady !== true
    || !validDigest(forensicStore.runtimeReadinessDigest)
    || !validDigest(forensicStore.contractDigest)
    || typeof forensicStore.recoverAfterFinalReadbackFailure !== 'function'
    || forensicStore.finalReadbackRecoveryMaxAttempts !== 1
    || forensicStore.productionWriteAuthority !== false
    || forensicStore.modelAuthorityGranted !== false
    || forensicStore.createsResources !== false) {
    throw fail('WFM_T4_RUNTIME_FORENSICS_NOT_READY', 'T4 runtime containment requires a strict, independently attested forensic failover store.');
  }

  const pinnedRuntimeReadinessDigest = forensicStore.runtimeReadinessDigest;
  const pinnedFailoverContractDigest = forensicStore.contractDigest;
  const pinnedRequiredEligibleStores = forensicStore.requiredEligibleStores;
  const pinnedExecutableStoreCount = forensicStore.executableStoreCount;
  const pinnedFinalReadbackRecoveryMaxAttempts = forensicStore.finalReadbackRecoveryMaxAttempts;
  const { createT4ContainmentController } = require('./t4-containment-controller.cjs');
  const innerController = createT4ContainmentController({
    containmentExecutor,
    rollbackExecutor,
    forensicStore,
    now,
    maxActions,
  });
  const innerHandle = innerController?.handle;
  const innerVerifyReceipt = innerController?.verifyReceipt;
  if (typeof innerHandle !== 'function' || typeof innerVerifyReceipt !== 'function') {
    throw fail('WFM_T4_RUNTIME_CONTROLLER_CONFIG', 'T4 runtime containment requires the existing verified containment controller.');
  }

  const runtimeStillReady = () => forensicStore.runtimeReady === true
    && forensicStore.zeroEngineerFailoverReady === true
    && forensicStore.runtimeReadinessDigest === pinnedRuntimeReadinessDigest
    && forensicStore.contractDigest === pinnedFailoverContractDigest
    && forensicStore.requiredEligibleStores === pinnedRequiredEligibleStores
    && forensicStore.executableStoreCount === pinnedExecutableStoreCount
    && forensicStore.finalReadbackRecoveryMaxAttempts === pinnedFinalReadbackRecoveryMaxAttempts
    && forensicStore.productionWriteAuthority === false
    && forensicStore.modelAuthorityGranted === false
    && forensicStore.createsResources === false;

  async function handle(input = {}) {
    if (!runtimeStillReady()) {
      throw fail('WFM_T4_RUNTIME_FORENSICS_DRIFT', 'T4 forensic runtime readiness changed before containment execution.');
    }
    const innerReceipt = await innerHandle(input);
    if (innerReceipt?.safeTerminal !== true || innerVerifyReceipt(innerReceipt) !== true) {
      throw fail('WFM_T4_RUNTIME_INNER_VERIFY', 'T4 runtime cannot claim a safe terminal without a verified inner containment receipt.');
    }
    if (!runtimeStillReady()) {
      throw fail('WFM_T4_RUNTIME_FORENSICS_DRIFT', 'T4 forensic runtime readiness changed during containment execution.');
    }

    const innerContainmentReceiptDigest = innerReceipt.receiptDigest;
    const runtimeForensicBindingDigest = digest({
      innerContainmentReceiptDigest,
      forensicDigest: innerReceipt.forensicReceipt?.forensicDigest || null,
      runtimeForensicReadinessDigest: pinnedRuntimeReadinessDigest,
      runtimeForensicFailoverContractDigest: pinnedFailoverContractDigest,
      requiredEligibleStores: pinnedRequiredEligibleStores,
      executableStoreCount: pinnedExecutableStoreCount,
      finalReadbackRecoveryMaxAttempts: pinnedFinalReadbackRecoveryMaxAttempts,
    });
    const receipt = {
      ...innerReceipt,
      innerContainmentReceiptDigest,
      runtimeForensicReady: true,
      runtimeForensicReadinessDigest: pinnedRuntimeReadinessDigest,
      runtimeForensicFailoverContractDigest: pinnedFailoverContractDigest,
      runtimeRequiredEligibleStores: pinnedRequiredEligibleStores,
      runtimeExecutableStoreCount: pinnedExecutableStoreCount,
      runtimeFinalReadbackRecoveryMaxAttempts: pinnedFinalReadbackRecoveryMaxAttempts,
      runtimeForensicBindingDigest,
    };
    delete receipt.receiptDigest;
    receipt.receiptDigest = digest(receipt);
    return receipt;
  }

  function verifyReceipt(receipt = {}) {
    if (!runtimeStillReady()
      || receipt.runtimeForensicReady !== true
      || receipt.runtimeForensicReadinessDigest !== pinnedRuntimeReadinessDigest
      || receipt.runtimeForensicFailoverContractDigest !== pinnedFailoverContractDigest
      || receipt.runtimeRequiredEligibleStores !== pinnedRequiredEligibleStores
      || receipt.runtimeExecutableStoreCount !== pinnedExecutableStoreCount
      || receipt.runtimeFinalReadbackRecoveryMaxAttempts !== pinnedFinalReadbackRecoveryMaxAttempts
      || !validDigest(receipt.innerContainmentReceiptDigest)
      || !validDigest(receipt.runtimeForensicBindingDigest)
      || !validDigest(receipt.receiptDigest)) return false;

    const expectedBindingDigest = digest({
      innerContainmentReceiptDigest: receipt.innerContainmentReceiptDigest,
      forensicDigest: receipt.forensicReceipt?.forensicDigest || null,
      runtimeForensicReadinessDigest: pinnedRuntimeReadinessDigest,
      runtimeForensicFailoverContractDigest: pinnedFailoverContractDigest,
      requiredEligibleStores: pinnedRequiredEligibleStores,
      executableStoreCount: pinnedExecutableStoreCount,
      finalReadbackRecoveryMaxAttempts: pinnedFinalReadbackRecoveryMaxAttempts,
    });
    if (receipt.runtimeForensicBindingDigest !== expectedBindingDigest) return false;

    const outer = { ...receipt };
    const outerDigest = outer.receiptDigest;
    delete outer.receiptDigest;
    if (digest(outer) !== outerDigest) return false;

    const inner = { ...receipt };
    delete inner.innerContainmentReceiptDigest;
    delete inner.runtimeForensicReady;
    delete inner.runtimeForensicReadinessDigest;
    delete inner.runtimeForensicFailoverContractDigest;
    delete inner.runtimeRequiredEligibleStores;
    delete inner.runtimeExecutableStoreCount;
    delete inner.runtimeFinalReadbackRecoveryMaxAttempts;
    delete inner.runtimeForensicBindingDigest;
    inner.receiptDigest = receipt.innerContainmentReceiptDigest;
    return innerVerifyReceipt(inner) === true;
  }

  return Object.freeze({
    handle,
    verifyReceipt,
    runtimeForensicReady: true,
    runtimeReadinessDigest: pinnedRuntimeReadinessDigest,
    failoverContractDigest: pinnedFailoverContractDigest,
    requiredEligibleStores: pinnedRequiredEligibleStores,
    executableStoreCount: pinnedExecutableStoreCount,
    finalReadbackRecoveryMaxAttempts: pinnedFinalReadbackRecoveryMaxAttempts,
    productionWriteAuthority: false,
    modelAuthorityGranted: false,
    createsResources: false,
  });
}

module.exports = {
  REQUIRED_CAPABILITY,
  capabilityEligible,
  createT4ForensicFailoverStore,
  createT4RuntimeForensicStore,
  createT4RuntimeContainmentController,
  digest,
};