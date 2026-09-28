# VECTOR Customer-Free Integration Certification Factory

Status: BUILT AS AN ISOLATED PROOF-LANE FRAMEWORK. This branch is not release authority and does not change the frozen customer-proof candidate.

## Purpose

Prove VECTOR integration behaviour against genuine third-party developer/sandbox environments without requiring customer production access.

## Claim levels

- L0 SIMULATED: Northstar/local fixture only. Useful for logic, not provider acceptance.
- L1 OFFICIAL PROVIDER SANDBOX CONTRACT: VECTOR reaches an official vendor sandbox/test endpoint and validates auth, transport, API contract and response schema.
- L2 STATEFUL PROVIDER DEV TENANT: VECTOR reads and writes synthetic data in a genuine provider-owned development/demo tenant and independently reads the state back.
- L3 PROVIDER FAILURE/RECOVERY: L2 plus safe credential-expiry, timeout/retry, duplicate/idempotency, partial-response and reconnect/reconciliation proof. Never intentionally load-test or rate-limit a vendor.
- L4 CUSTOMER PRODUCTION: Evidence from an authorised real customer production environment. This cannot be claimed without a customer.

No lower level may be described as a higher level.

## First provider targets

1. SAP Business Accelerator Hub — official SAP API sandbox. Target L1 immediately after an SAP API key is supplied. SAP documents sandbox APIs for S/4HANA and SuccessFactors. Some sandbox resources are read-only, so this does not automatically become L2.
2. Workday Developer Program — personal cloud development tenant. Target L2 for HCM read/write/read-back once a personal developer tenant and API client are available.
3. Gusto Embedded Payroll Demo — genuine vendor demo environment at api.gusto-demo.com. Target L2/L3 for payroll onboarding and payroll-cycle integration with synthetic companies/employees.
4. Xero Demo Company — genuine vendor demo company and OAuth 2.0 API. Target L2 for finance/accounting integration and read-back.
5. Oracle NetSuite SDN Development Account — target L2/L3 after SuiteCloud Developer Network provisioning. Oracle documents that ISVs use SDN development/testing accounts; this is not an instant anonymous public sandbox.
6. Industrial protocols — use an isolated Northstar protocol lab for OPC UA, MQTT and SFTP failure/recovery. This proves protocol behaviour only and must not be presented as Siemens/Tulip/etc provider certification unless a genuine vendor environment is attached.

## Evidence contract

Every certification run must bind:
- provider + environment identity
- exact VECTOR source/candidate SHA under test
- exact run plan digest
- start/end timestamps
- request method + route without secrets
- response status, content type and body SHA-256
- extracted non-secret identifiers required for read-back
- independent read-back result
- failure/recovery outcome where applicable
- terminal PASS/FAIL/BLOCKED state

Secrets, bearer tokens, API keys, refresh tokens and raw payroll/employee payloads must never be written into evidence.

## Safety

- Only explicit provider sandbox/demo/development hosts are allowed.
- Production hosts fail closed.
- No destructive calls outside synthetic tenants.
- No customer data.
- No intentional provider abuse, stress, rate-limit generation or security testing.
- A provider HTTP 2xx is not enough: state-changing claims require independent read-back.
- Railway/platform SUCCESS is not an integration PASS.
- Northstar/local proof is not provider proof.
- This lane cannot set releaseAuthority or productionApproved.

## Promotion

This proof branch may produce evidence and implementation changes. Only reviewed changes may later merge into integration/canonical. Staging and production remain governed by docs/RELEASE_CONTROL.md.
