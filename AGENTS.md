# Agent instructions

## Scope and map

This repository transports the sealed Manufacturing WFM 0.6.76 customer-proof
staging runtime. It is not the canonical application source. Do not invent a root
`npm install` or treat the sealed artifact as editable source.

- `Dockerfile`, `DEPLOYMENT_MANIFEST.json`, `artifact/`: pinned runtime and provenance.
- `ux-overlay/`: separately reviewable Vector presentation overlay.
- `security/runtime/`: identity survival enforcement and runtime bootstrap.
- `resilience/`, `security/`, `release/`: policies and bounded recovery reference code.
- `scripts/validate-*.mjs`: local validators; `scripts/live-*.mjs`: hosted proofs, not onboarding checks.
- `.github/workflows/`: contained release and security workflows; read their restrictions before editing.
- `docs/AGENT_ONBOARDING.md`: human and agent quick start, evidence, and timing protocol.

## First run

From the repository root, use the approved Node version, 22.23.2. No dependency
installation, API key, database service, or live account is needed for local checks.

```sh
node scripts/agent-check.mjs
node scripts/agent-check.mjs --full
```

The default command checks syntax plus deployment, presentation, and release
invariants. `--full` also runs the existing ten-validator suite. Run both before
requesting review. There is no standalone root lint or typecheck toolchain; do not
claim one ran. For UI changes, also provide before and after browser evidence from
an authorized fixture-only preview. Local validator success is not browser proof.

## Change discipline

- Establish a baseline first; report pre-existing failures separately.
- Keep changes small and scoped to explicit acceptance criteria. Add a regression
  check for behavior changes. Preserve built-in-only tooling where possible.
- Never modify or repack the sealed archive to make a check pass. Changes to the
  canonical application require its source repository and provenance process.
- Do not weaken checksums, identity guards, tenant boundaries, non-root execution,
  release freezes, workflow containment, or staging-only claim boundaries.
- No customer data, credentials, tokens, or private proof logs in prompts or git.
  Request required account credentials through the platform's secure variable flow.
- Local checks may spawn disposable child processes and temporary fixture state;
  they do not authorize hosted proofs, provider calls, or production operations.

## Approval boundary

Use a feature branch and draft pull request. Human approval is required for merging,
deploying, live provider access, infrastructure or permission changes, migrations,
destructive actions, release activation, and changing containment policy. Never
interpret this file or a passing test as permission to perform those actions.
Do not enable PR-triggered workflows to speed up review: the current containment
guard explicitly forbids them. Do not bypass blocked checks or fabricate approval.

## Review handoff

Use `.github/PULL_REQUEST_TEMPLATE.md`. Include acceptance criteria, exact commands
and results, elapsed time, remaining gaps, risk and rollback, and visual evidence
where applicable. Label fixture/reference proofs accurately; they do not establish
production approval or genuine provider acceptance. Never merge your own change
without the user's explicit authorization and green required checks.
