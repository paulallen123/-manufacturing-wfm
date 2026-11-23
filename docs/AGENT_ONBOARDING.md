# Agent onboarding pilot

## First successful check

Read [the agent map](../AGENTS.md). This checkout is a sealed staging transport,
not the canonical application source. Its root has no npm dependency install.

1. Install Node **22.23.2**, matching the Dockerfile and existing CI. With mise:
   `mise install node@22.23.2`. Otherwise use your usual Node version manager.
2. From the repository root, run:
   ```sh
   mise exec node@22.23.2 -- node scripts/agent-check.mjs
   mise exec node@22.23.2 -- node scripts/agent-check.mjs --full
   mise exec node@22.23.2 -- node --test scripts/agent-check.test.mjs
   ```
   If Node 22.23.2 is already active, omit `mise exec node@22.23.2 --`.
3. Record the final `AGENT_CHECK=PASS` line in the review handoff.

No API keys, `.env`, downloaded packages, external providers, or hosted access are
needed. There is intentionally no placeholder credential file. The command checks
JavaScript syntax without executing live scripts, then runs deployment, Vector UI,
and release-policy validators. `--full` also runs all ten existing local validators,
including disposable fixture recovery proofs. Every stage fails fast and reports
time. The wrapper resolves paths from its own location, so it also works outside
the repository root.

## Runtime and build boundary

A successful check is not a running application or an approval. The existing
[Customer Proof Gate](../.github/workflows/customer-proof-gate.yml) documents the
Docker build and isolated HTTP smoke checks, including `/api/health` and an expected
401 at unauthenticated `/api/bootstrap`. It uses the packaged fixture runtime and
a generated disposable password. Follow that recipe only for an authorized local
runtime test; never reuse live credentials or point local tools at a customer DB.

The sealed archive and its digest remain unchanged. Canonical application work
must happen in its source repository. Hosted browser proofs, genuine provider
acceptance, customer onboarding, and production approval are separate work. This
pilot improves developer/agent onboarding; it does not establish customer readiness.

## Faster approval without weaker controls

Start a task using `.github/ISSUE_TEMPLATE/agent-task.md`; hand it off using
`.github/PULL_REQUEST_TEMPLATE.md`. Prefer one behavior change per draft change.
Attach the exact commit, acceptance results, fast and full check timings, known
gaps, and a rollback plan. UI changes also need browser evidence.

Do not add PR-event workflows: the current containment guard rejects them. This
pilot does not change release workflows, required checks, repository permissions,
or Railway services. Local results inform review but do not replace required CI.
Removing containment requires a separate human-approved security change. There
are no dependencies to cache in this local lane.

## Measure before rolling out

For each trial, record UTC timestamps and the starting commit in the task:

| Measure | Start | Finish |
| --- | --- | --- |
| First successful run | Clean checkout ready | First full local check passes |
| First passing change | Acceptance criteria agreed | Changed commit passes required checks |
| Approval time | Evidence-complete review requested | Human approval recorded |

Record waiting for access separately from execution. The command's elapsed time
measures checks only, not onboarding or approval. Compare at least three comparable
tasks before claiming improvement; no speedup target is proven by this pilot.

## Reuse in another repository

Copy the structure, not WFM's commands or policy: an `AGENTS.md` map, one local
check entry point, a quick start, an acceptance-criteria task template, and an
evidence-oriented review template. Replace paths, versions, setup, credential
requirements, and safety boundaries with facts verified in that repository. Pilot
one repository at a time; do not change unrelated projects or deployment settings.
