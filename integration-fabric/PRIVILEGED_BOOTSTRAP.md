# Privileged bootstrap separation

Some providers require elevated authority to create an integration object (for example a webhook, subscription, SCIM app, API client, export job or callback) even though the steady-state WFM integration only needs read access or a verification secret.

The Manufacturing WFM integration fabric treats **bootstrap authority** and **runtime authority** as separate security planes.

## Rules

1. **Do not retain elevated bootstrap credentials in the WFM runtime.** Administrator, manage-all-data, impersonation, write/delete/archive/control or equivalent credentials must not become normal connector secrets.
2. **Do not reuse bootstrap credentials for steady-state reads.** Successful setup is not evidence that the same credential is appropriate for ongoing ingestion.
3. **Prefer lower-privilege vendor setup routes.** If the provider supports a dedicated subscription creator, webhook registrar, app installer or scoped service account, use that path and prove its effective operations.
4. **Customer-controlled pre-provisioning is allowed.** Where elevated setup is unavoidable, a customer administrator may create the integration object out of band and hand WFM only the bounded data-plane credential or verification material required at runtime.
5. **Verification material must be separable.** A webhook signature secret, subscription ID, callback ID or equivalent runtime verifier must be usable without keeping the privileged bootstrap token.
6. **Fail closed when separation is not possible.** Use authenticated polling/reconciliation, a customer-controlled gateway, or leave the surface disabled until the vendor provides a safer contract.
7. **Evidence remains surface-specific.** A connector may prove a REST read round-trip while its webhook surface remains disabled; do not let optional privileged setup block a safer independent read route unless both share the same unavoidable authority.

The machine-enforced helper is `runtime/privileged-bootstrap-guard.mjs`. Generated connector security defaults keep `bootstrapCredentialRetentionAllowed:false`, `bootstrapCredentialReuseAtRuntimeAllowed:false`, and `customerControlledBootstrapAllowed:true`.

## Mitti example

Mitti (formerly SafetyCulture) is the first catalogued provider exercising this pattern explicitly. Provider documentation states that webhook registration/receipt requires either a user with **Administrator** permission or a service user with **Override permissions: Manage all data**. That authority can edit/archive/delete data and override access rules, so the normal WFM runtime must not hold it.

Safe options are:

- run Mitti as scheduled authenticated REST sync only; or
- have an authorised customer administrator pre-register the webhook and provide WFM the HMAC verification secret separately, while WFM continues to use its own constrained read-only service-user token for reconciliation.

Mitti webhooks are best-effort, may be duplicated or out of order, and therefore remain signals rather than completeness proof. Scheduled incremental reconciliation is still required.
