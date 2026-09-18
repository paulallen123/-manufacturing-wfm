# Railway source refresh evidence — 2026-09-18 20:54 BST

Purpose: generate a source-change webhook on `feature/one-day-enterprise-implementation-v1` after Railway GitHub access was verified restored, so the two existing proof services fetch the current branch rather than reusing an older deployment snapshot.

Scope and safety constraints:

- No application/runtime code changed by this commit.
- No customer-proof/frozen release changed.
- No new Railway service, database, volume, domain, or paid resource created.
- No readiness flag or security control changed.
- Target services remain `wfm-one-day-enterprise-v1` and `wfm-integration-fabric-v1-proof` only.
- Functional candidate immediately below the previous evidence-only commit is `6d391d319c378c60ac38cfa27540afee1f81cb1a`.
- This commit exists only to force a fresh source fetch and make deployed provenance observable.

A deployment is not considered proven merely because this file exists; Railway deployment metadata and cloud proof gates must still pass independently.
