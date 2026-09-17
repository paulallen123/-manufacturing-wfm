# 0.6.76 customer-proof staging deployment trigger

This file intentionally does not modify the sealed runtime artifact.

Frozen release: `0.6.76-hosted-staging-rc1`
Runtime artifact: `artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz`
Runtime SHA-256: `3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d`

Purpose: trigger the first deployment of the dedicated isolated Railway customer-proof staging service after completed hosted acceptance and regression gates.

Retrigger: `2026-09-17T15:06:00+01:00` after Railway API confirmed the dedicated repo-linked proof service is configured but has never received its first deployment. The service is isolated in the existing `manufacturing-wfm-test` project; the stale running 0.6.70-era staging service is not modified. This commit is a deployment signal only; it does not alter the candidate payload, provenance, autonomy safety kernel, tenant boundary or claim boundary.

Expected proof target after merge: `https://wfm-staging-0670-customer-proof-production.up.railway.app`, exact release `0.6.76-hosted-staging-rc1`. A healthy HTTP response without matching release identity is not sufficient proof.

Claim boundary: staging/customer proof only; not production approval or genuine provider Level-A certification.
