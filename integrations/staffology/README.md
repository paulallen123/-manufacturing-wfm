# Isolated Staffology integration preparation

This directory is a non-deploying implementation seam derived from the frozen artifact's existing boundaries:

- employee acquisition returns the integration hub's `people` envelope and retains provider, employer, employee, source path, revision, acquisition time, and employment effective dates;
- payroll mapping retains VECTOR tenant/batch provenance and Staffology employer/employee/payroll-code identities;
- provider response validation fails closed on identity drift;
- the delivery coordinator requires a durable provider-receipt store, uses a stable delivery id, and makes uncertain writes reconcile before any possible resend;
- independent financial snapshots recursively retain relevant monetary, hours, rate, and value fields and produce field-level differences plus canonical SHA-256 digests.

The module is intentionally not wired into the runnable/deployed application. Wiring, configuration changes, and hosted execution are separately controlled release actions.

## Offline test

```sh
node --test integrations/staffology/staffology-adapter.test.cjs
```

The tests use injected fake transports and fake credentials. They perform no network call or provider write.

## Reconciled repair proposal

The adapter bytes now match the verified boundary repair d91bafb8db1a98a5f3f65fdf37259c59e57e631c68f0f4a74f0939f54b21a6a1. Run the three offline suites using Node 22.16.0 or a supported Node 22 runtime:

```sh
node --test integrations/staffology/staffology-adapter.test.cjs integrations/staffology/sqlite-contract.test.cjs integrations/staffology/independent-boundaries.test.cjs
```

`test-support/sqlite-store-fixture.cjs` is disposable test storage only. No production runtime imports this directory. The adapter requires the existing canonical boundaries described in STORE_INTEGRATION_CONTRACT.md before activation. Passing these tests does not certify the canonical store, server authority, employee import, payroll release or hosted journey.

## Canonical sealed-runtime assembly

`scripts/compose-vector-local-runtime.mjs` is the supported, fail-closed assembly step for the sealed staging source. It verifies the retained runtime manifest and the exact `server.cjs`, outbound-store and transactional-payroll bridge hashes before copying the adapter and `canonical-runtime-bridge.cjs` into an extracted runtime. It then exposes only a dormant integration status through the existing server integration report. The Dockerfile invokes this step after verifying and extracting the unchanged sealed archive.

The bridge can stage only a complete reviewed people envelope through a caller-supplied existing integration-gateway boundary. Its payroll preparation reads the exact retained released batch, verifies the CSV checksum again, requires current `payroll.export` permission and an explicit mapping, and rejects sent batches, multiple lines, allowances and non-basic components. The assembled production boundary uses the application's existing SQLite database for private evidence, durable ownership and one-shot exact approval. No provider route, client, credentials or worker is constructed, so activation remains unavailable.
