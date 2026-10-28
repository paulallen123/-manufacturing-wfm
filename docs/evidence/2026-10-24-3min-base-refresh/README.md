# 3Min base refresh — 24 October 2026, Saint Lucia

Execution occurred 25 October UTC. This continues the existing PR509 donor;
PR501 remains the sole release integration lane. No new deployment, service,
controller, tenant or provider webhook was created.

## Source reconciliation

Previous donor: a8d917f1454429e5f596238e050a04918fd737d0.
New PR501 base: 5d8b3f11fe04a09b63f258c34bbb8b9568942859.
Base tree: 967f4c02b5869bb52313a089e79aeb5c79a95dde.

The base adds hardened-runtime ancestry, a proof-only installed-archive stage,
mandatory source-bound admission into the final image and repaired packaging
test parsing. Dockerfile is the only overlapping donor path. The five existing
3Min Docker changes are applied to the exact new base: UI test admission,
composed test admission, runtime module copy, source-test copy and test invocation.
Removing those five edits reproduces the base Dockerfile byte-for-byte, including
line endings. All six other changed base source files match remote Git blob hashes.
All 27 previous donor files matched their published Git hashes before this merge.
Publication retains the full new parent tree and both Git parents.

Merged Docker SHA256:
c18765fe5da70a6f2bb84a7664d210ed947fd7cb01e98c99f64d97ac384beb8a

## Executed verification

Official Node22.23.2 Linux archive downloaded from nodejs.org and verified against
its published SHA256 checksum. Restored local dependencies remain cached dependencies.

- affected-node22.tap: 172/172 pass, exit0, zero failures/skips. Includes receiver,
  existing integration hub/provider controls, new/existing UI controls, setup-only
  policy, workspace compiler composition and final-runtime packaging.
- composed-node22.tap: 1/1 pass, exit0, zero failures/skips. Real local synthetic
  bootstrap/login, served exact UI source, intake, receipt inspection, restart,
  replay and tenant isolation.
- Independent read-only merge review: ACCEPT, no Critical/Important findings;
  nine static ancestry/admission assertions passed. See review.md.

These source/composed results do not establish a complete Docker build or the
installed archive proof gate. Prior donor CI1098/1099 success belongs to a8d917f,
not to this successor. Current-image, provider and customer proof remain open.

## Browser verification attempt and reproducible next step

Playwright's Chromium download failed with invalid/truncated ZIP responses.
Official Google Chrome stable was downloaded from
https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb and
extracted locally; reported version156.0.8078.47. Launch then failed with
socket() Operation not permitted, SIGABRT, before any UI assertion. See
browser-launch-failed.txt. No sandbox workaround or escalation was attempted.

scripts/three-min-feed.browser-proof.mjs is a pending-run verifier for a permitted
browser runner. It creates only a temporary loopback synthetic runtime, admits
accepted/rejected fixture deliveries, authenticates a synthetic manager and checks
receipt rendering, collapsed details, no payload/secret display, overflow,
refresh failure/recovery and navigation cleanup at1440px and390px. The latter is
a narrow Chromium viewport, not mobile-device or Safari coverage. It never targets
the hosted tenant or the real 3Min provider.

Run with installed Playwright and a supported browser:

```sh
CHROMIUM_EXECUTABLE=/path/to/chromium node scripts/three-min-feed.browser-proof.mjs
```

Independent review requested robust nested cleanup; that cleanup-only correction
is included after the failed attempt and syntax-checked. The final verifier has
not passed browser execution. Final verifier SHA256:
b1508202c77a1a48e2fae39ced6fd1f7d9ba89682215ea5229f590bff737b8c5

## Remaining release dependencies

Adoption through the existing PR501 owner, current full image admission, formal
release review, actual tenant/site/source configuration, dashboard-only webhook
authentication, source-specific import mapping/authority and hosted recovery and
customer verification remain unfinished. No live integration completion is claimed.
