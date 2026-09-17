# Manufacturing WFM — isolated customer-proof staging transport

This private repository carries the exact `0.6.76-hosted-staging-rc1` customer-proof staging runtime as an immutable tarball. The active artifact, size and SHA-256 are defined in `DEPLOYMENT_MANIFEST.json` and are verified before extraction during the container build.

The staging container uses an immutable digest-pinned Node 22.23.2 image, runs as the unprivileged `node` user, and is validated by the every-push security gate and runtime-integrity/resilience gate. Runtime critical modules are checked against the embedded runtime manifest before the candidate can be treated as verified staging evidence.

This remains a staging/customer-proof candidate only: `production_approved=false`, `pilot_ready=false`, `fixture_only=true`, and `staging_only=true`. Genuine live-provider evidence, independent external security/performance assurance, production persistence/disaster recovery and customer production acceptance remain separate release gates.

Source evolution remains isolated from this staging transport. Candidate changes should be promoted through a hardening branch, pass the security and runtime gates against the exact artifact, and only then be merged to `main`.
