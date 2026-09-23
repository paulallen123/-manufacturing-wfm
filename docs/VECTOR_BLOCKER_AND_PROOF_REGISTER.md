# VECTOR Blocker & Proof Register

Updated: 2026-09-23

## Operating rule

A blocker never stops the programme. It changes the route.

No fallback may weaken:
- authentication or tenant isolation;
- payroll/data integrity;
- source-of-truth ownership;
- safety/compliance hard constraints;
- release provenance;
- approval/authority boundaries.

Statuses in this register use the product programme meanings:
- **PROVEN** — repeatably working in the approved real environment with evidence.
- **BUILT** — implemented, but exact hosted/product proof is incomplete.
- **DESIGNED** — agreed design, implementation incomplete.
- **RESEARCHED** — evidence/research only.
- **BLOCKED** — no safe route exists for that exact claim; an alternate route must continue immediately.

## 2026-09-23 acceleration hardening

- RC1 source is frozen at `ac7a2f7d22fdd30202dff2e86e36d2b0cf31b868` on `release/vector-eow-rc1-20260923`.
- Forward work continues from `feature/vector-post-rc1-20260923`; new development must not move RC1 proof identity.
- Railway Forge, Autopilot and Demand Decision candidate services now use explicit proof-trigger watch patterns instead of rebuilding on every development commit.
- The mandatory tenant encryption/runtime signing key-binding repair has been converged into FORGE and is required by both core CI and exact Docker admission.
- GitHub-hosted runner fallback probing with `ubuntu-latest` also failed before any step received a runner. Treat GitHub Actions as a control-plane/account execution blocker, not as a failed VECTOR test.
- The checked-in CircleCI exact-runtime fallback has not produced a status for a fresh `staging/*` push; do not count it as executable resilience until the provider integration is actually connected and emitting proof.
- No provider failure may cause a product security/provenance gate to be relaxed. Development continues; promotion waits for exact-candidate evidence.

## Current proof layers

### 1. Sealed full-product hosted baseline — PROVEN
Railway service: `wfm-customer-proof-0676`

Latest successful deployment observed: `451b7c15-815c-4570-841d-eeb15537e1f0`.

This remains the stable hosted/customer-proof baseline. It proves the existing authenticated hosted product lane; it does not prove newer FORGE convergence code.

### 2. FORGE development convergence — BUILT
Branch: `feature/vector-eow-convergence-20260925`.

Latest proof-lane restoration commit at this register revision: `8efd91ec6d576b64fd3af3217f5932f52e1c6e8f`.

Railway is receiving the correct branch/commit, but recent attempts fail before Docker/BuildKit execution while scheduling the Metal builder. This is an external execution-lane failure, not a passed or failed product test.

### 3. Independent demand/decision hosted verifier — PROVEN for bounded algorithm behaviour
Independent hosted proof plane executes synthetic demand prioritisation, hard-constraint filtering, shadow-authority and deterministic-replay scenarios.

It is supporting evidence only. It explicitly does **not** claim:
- integrated latest FORGE deployment;
- customer production behaviour;
- real customer savings;
- payroll/schedule/production mutation.

### 4. Provider-neutral full-runtime fallback — BUILT
CircleCI fallback restored on the FORGE convergence branch.

It performs:
1. current source validators;
2. demand/decision unit/security checks;
3. exact Docker build;
4. non-root/runtime-hardening checks;
5. refusal to run staging candidate as production;
6. isolated hosted HTTP health proof;
7. unauthenticated bootstrap refusal;
8. unauthenticated Decision Intelligence refusal;
9. source SHA + image inspection artifacts.

This lane is the immediate fallback when Railway cannot allocate a builder.

## Active blockers and routes

### B1 — Railway builder scheduling fails before BuildKit
**Type:** external infrastructure.

**Observed:** multiple correct FORGE commits reach Railway, then terminate after `scheduling build on Metal builder` with no Docker output.

**Primary route:** Railway retries only on meaningful new candidate commits; do not modify product code to chase the scheduler.

**Fallback route:** provider-neutral CircleCI exact Docker/runtime proof.

**Continuing work:** source validation, independent hosted algorithm proof, security repairs, convergence and regression work continue.

**Promotion condition:** exact current FORGE SHA completes Docker admission and hosted runtime checks on at least one approved full-runtime hosted lane.

### B2 — GitHub Actions jobs fail/queue before runner execution
**Type:** external CI execution.

**Route:** CircleCI provider-neutral proof + Railway hosted proof. GitHub remains source/review/governance; proof is not single-provider-dependent.

**Promotion condition:** current source must have reproducible exact-runtime evidence from an approved lane. GitHub runner availability is not required for development progress, but required checks cannot be falsely reported green.

### B3 — Repository branches are unprotected
**Type:** GitHub account/control-plane configuration.

**Observed 2026-09-22:** `main` and `feature/vector-eow-convergence-20260925` report `protected:false`; repository rulesets are empty.

**Safe route:** development and proof continue using exact immutable commit identities, source-bound built-asset provenance, fail-closed release manifests and hosted proof receipts.

**Cannot be safely bypassed for production release:** branch/ruleset enforcement must be enabled at the GitHub account/repository administration layer. The connected GitHub application does not expose administration writes.

**Production promotion condition:** protected release lane requiring PR + proof checks, with force-push/deletion restrictions and an explicit break-glass owner route.

### B4 — Built UI marker spoof could previously pass
**Type:** proof defect.

**Status:** BUILT repair.

**Repair:** canonical `vector-ui.js`, `vector-ui.css` and `vector-workflows.js` are reconstructed from approved source inputs and byte-compared. Marker-only arbitrary JS fails the negative regression.

Demand Intelligence is now included in both the canonical provenance composition and its independent fixture.

**Promotion condition:** exact current Docker candidate executes the provenance suite in a hosted/full-runtime lane.

### B5 — Provisioning plan could previously omit mandatory key bindings — CONVERGED
**Type:** security defect.

**Status:** CONVERGED into FORGE on 2026-09-23; the repaired planner and negative validator are admitted by core CI and exact Docker build admission.

**Repair:** both `tenant-encryption-key` and `runtime-signing-key` are mandatory before readiness. The independent verifier also requires exactly one matching bind action per declared secret in every regional plan.

Negative regressions cover:
- zero secret references;
- each mandatory key missing independently;
- duplicate secret references;
- receipt metadata with missing mandatory secret;
- missing regional bind action;
- duplicate regional bind action.

**Promotion condition:** repaired exact branch executes its proof lane, then the isolated delta is converged into the canonical implementation path if still required.

### B6 — Latest FORGE has source evidence but not exact integrated hosted proof
**Type:** proof gap.

**Route:**
1. preserve last healthy hosted candidate;
2. never replace it with a candidate whose build/health proof did not pass;
3. use CircleCI full Docker/runtime proof while Railway is unavailable;
4. when Railway build execution returns, deploy the exact same SHA;
5. authenticate through the real runtime and exercise:
   - health + release identity;
   - login and role boundary;
   - tenant isolation;
   - Today/Factory presentation;
   - Decision Intelligence read path;
   - absence-recovery shadow decision;
   - payroll/time-review regression;
   - refresh/new-login persistence;
   - no production authority;
6. retain exact source SHA, image digest, UI asset digests and proof receipt.

## Evidence standard for every new feature

No feature becomes PROVEN from code, unit tests or a screenshot alone.

Required progression:
`source -> deterministic tests -> security/negative tests -> exact image -> hosted health -> authenticated role/tenant proof -> real workflow -> persistence/reload -> outcome evidence -> regression -> proof receipt`.

For decision/value features, the receipt must separate:
- projected outcome;
- simulated outcome;
- verified operational outcome;
- realised customer financial outcome.

Only the last category may be described as realised customer ROI.

## Automatic blocker routing

- CI provider unavailable -> alternate CI/provider-neutral proof.
- hosting builder unavailable -> preserve healthy release + alternate exact image proof.
- integration unavailable -> fallback adapter/file/SFTP/manual-safe ingestion while preserving provenance.
- source data stale -> degrade to read-only/unknown, never invent certainty.
- AI unavailable -> deterministic rules/solver continues.
- downstream write unavailable -> recommendation/approval remains queued; no false success.
- customer environment incompatible -> isolated adapter or bounded sidecar, not a second product.
- proof lane unavailable -> claim remains BUILT; development continues through another safe lane.
