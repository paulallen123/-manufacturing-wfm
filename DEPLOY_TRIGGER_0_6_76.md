# 0.6.76 customer-proof staging deployment trigger

This file intentionally does not modify the sealed runtime artifact.

Frozen release: `0.6.76-hosted-staging-rc1`
Runtime artifact: `artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz`
Runtime SHA-256: `3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d`

Purpose: trigger the first deployment of the dedicated isolated Railway customer-proof staging service after completed hosted acceptance and regression gates.

Retrigger: `2026-09-17T14:56:00+01:00` after the legacy pre-deploy containment hold was verified cleared on the existing repo-linked test service. This is a deployment signal only; it does not alter the candidate payload, provenance or claim boundary.

Claim boundary: staging/customer proof only; not production approval or genuine provider Level-A certification.
