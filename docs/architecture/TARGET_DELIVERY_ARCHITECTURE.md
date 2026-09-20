# Target Delivery Architecture

## Objective
Reduce engineering drag by separating source control, CI verification, artefact creation, deployment and runtime evidence.

## Canonical path
GitHub -> CircleCI -> immutable container image -> DEV -> STAGING -> PRODUCTION

## Rules
- GitHub is the source of truth for code and reviewed change.
- CircleCI is the primary heavy test and proof lane.
- GitHub Actions should remain lightweight governance/security where useful, not a critical dependency for every proof.
- Build the runtime once. Promote the exact same image digest between environments.
- Permanent environments are DEV, STAGING and PRODUCTION. Temporary preview environments are allowed only when they are automatically expired.
- Railway is a deployment target, not the source of build truth.
- Browser, integration, security, performance and 10k/50-site simulation evidence must bind to the exact image/source identity.
- Provider-specific services sit behind interfaces so the runtime can move between Railway, Azure, AWS, GCP or OCI.
- Do not create a new permanent service merely to prove a branch.

## Near-term workstreams
1. Collapse legacy UI and duplicate runtime paths into the Vector product.
2. Introduce the Factory Graph schema and entity relationship contract.
3. Standardise connector evidence tiers and authentication receipts.
4. Unify recommendations and automations through one action/policy engine.
5. Make the Savings Ledger the canonical proof of customer value.
6. Convert implementation and support workflows into productised autonomous journeys.
7. Replace fragmented proof services with a deterministic proof pipeline tied to one artefact digest.

## Cloud decision principle
Select cloud based on enterprise distribution, managed data/AI services, edge/industrial integration, compliance, resilience and total cost. Keep the application layer portable unless a provider-specific capability produces material customer value.
