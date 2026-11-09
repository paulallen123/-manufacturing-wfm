# V026 tenant-scoped policy resolution repair

This is an independently reviewed source patch against PR #501 `61718e1862fa650136e1952f622c9d8dd4c22af8`. It fixes one bounded defect: the jurisdiction graph ignored an explicit tenant scope, while the existing global-site preflight omitted its tenant from worker resolution. Tenants sharing a site ID could receive another tenant's advisory policy coverage or constraints.

V026 remains **INTEGRATION / REVIEWED_TENANT_SCOPE_PATCH_AWAITING_RECONCILIATION**. This documentation commit contains the patch and evidence; it does not apply the product patch, adopt policy owners' branches, admit an image, deploy a service, or complete V026.

## Changes and contract

The patch changes only `policy/runtime/jurisdiction-policy-graph.cjs`, `policy/runtime/global-site-policy-preflight.cjs`, and a new `policy/runtime/v026-tenant-policy-scope.test.cjs`.

- Explicit tenant scopes must contain a nonblank string tenant ID of at most 120 characters without control characters, or a nonempty list of such IDs.
- Missing, non-string, or foreign context tenants cannot match a scoped policy. Matching is exact. Truly absent tenant scopes remain available as public policy.
- Scope admission validates before and after JSON cloning, so an explicit undefined or malformed tenant cannot disappear into a global policy.
- Preflight rejects tenant coercion/truncation and forwards its existing normalized string tenant into each worker context. Existing trimming of valid tenant strings is retained.
- Existing site/country selectors, legal and knowledge timestamps, policy composition, raw currency-bearing values, and advisory-only authority remain unchanged. Execution and customer mutation authority stay false.

The tenant added to preflight context intentionally changes its context and preflight digests. Previously saved receipts must be revalidated against the reconciled source; no live receipt or tenant data was migrated.

## Exact bytes

| Candidate file | Git blob | SHA-256 |
| --- | --- | --- |
| jurisdiction-policy-graph.cjs | 37cca4a4af62edccdc532d513ecc1f9d05267e83 | e5c80b05bff8231a2980b60b55bffa3c20751a55984ce15a9e1e17f3e082964c |
| global-site-policy-preflight.cjs | d41c09312774010e10081896ff8cb92f1d074603 | 595da9692df35e389fb5581029131be3757d76e0ff73c69aec50a506f927f878 |
| v026-tenant-policy-scope.test.cjs | 9532276d22eff245acec2155eb5d3b80ec3b2531 | b3652978342c2cb7e607bf4b4404ab2c94af8200e988cd1daaa7f62c378fe782 |

Patch SHA-256: `73070fbb91fe474d1834885f914f681ab5d9c46223dab5ee2b480b6f5be341ec`. All ten baseline policy files matched exact Git blobs and SHA-256 values in [source-manifest.json](source-manifest.json). The exact PR501 recursive tree was untruncated and contained no AGENTS.md. Fresh final PR501 read still reported the same source commit. Visible #527/related-owner checks found no conflicting V026 writer; external chat/job liveness is not globally observable.

## Executed verification

All below used local Node **v22.23.2**. They are source-level synthetic checks, with overlapping suites reported separately.

| Check | Baseline | Final candidate |
| --- | --- | --- |
| Existing policy tests | 20/20 pass, exit 0 | Included in 29/29 below |
| Primary focused tests | 0/9 pass, exit 1 | 9/9 pass as part of complete suite |
| Complete policy suite | — | 29/29 pass, exit 0, zero skip |
| Independent heldouts | 3/15 pass, 12 fail, exit 1 | 15/15 pass, exit 0, zero skip |
| Independent complete policy suite | — | 29/29 pass, exit 0 |
| Patch applied to fresh exact source, primary | — | 29/29 pass; resulting files byte-identical |
| Independently replayed patch | — | 15/15 heldouts pass; resulting files byte-identical |
| Existing unchanged calendar consumer | — | 3/3 pass, separate unchanged-source test |

The reviewer caught `scope.tenant: undefined` being erased during JSON normalization in a superseded candidate. The corrected candidate rejects this case; its red transcript is retained separately. An early primary apply-check encountered the temporary copied RED fixture already present in the baseline directory. That verified-identical authored test copy was removed, after which clean apply-check and fresh patch replay succeeded. The original source bytes were unchanged.

Independent verdict: **APPROVE bounded exact-PR501 source repair**, no remaining Critical/Important finding in scope. See [independent review](independent/INDEPENDENT-REVIEW.md), [verification manifest](independent/verification-manifest.json), fixtures, and full TAP logs. Primary worker `/root/site_policy_unblock`; separate reviewer `/root/site_policy_verifier`. Runtime model variant was not exposed; the requested Sol selection is not claimed as verified. These were bounded session tasks, not persistent leases.

## Reproduce on the exact source

From a clean checkout of the named PR501 commit, with the packet available outside the source root, use Node22.23.2:

```sh
node --version
git apply --check /path/to/packet/v026-tenant-policy-scope.patch
git apply /path/to/packet/v026-tenant-policy-scope.patch
node --test policy/runtime/*.test.cjs
V026_SOURCE_ROOT="$PWD" node --test /path/to/packet/independent/tenant-isolation-heldouts.cjs
V026_SOURCE_ROOT="$PWD" node --test /path/to/packet/independent/calendar-regression-heldouts.cjs
```

The primary focused RED run copied the new test into an otherwise exact baseline, ran that test alone, and removed only the copied fixture afterward. The calendar fixture uses `operations/runtime/tenant-calendar.cjs` at the same commit; its source manifest is included. London DST spring-gap/autumn repeated-hour and Kolkata rollover checks do not establish a saved-site-policy bridge or ambiguous local wall-time conversion.

## Owner reconciliation required

Existing PR #385/#395/#435/#436/#429 owners retain their packages; PR #501 retains sole canonical integration/release ownership. No owner product branch, live tenant, customer policy, provider, personnel, payroll, or deployment configuration was changed.

**Do not replace donor modules wholesale with these PR501-based files.** Fresh donor #436 head `c92d1321f1f88c6300b8600522dca06a078a9f7c` retains #385 workforce-population validation and #395 recursive provenance freezing. This patch does not apply directly to either donor module because its contexts overlap; [recorded overlap](independent/donor436-patch-overlap.txt). The existing owners must transplant/reconcile the tenant additions while preserving those guards, review the resulting exact bytes, and run affected/full-image/security/recovery checks.

The current policy factories still lack demonstrated trusted operational runtime wiring. Approved effective-dated customer policies, saved site country/timezone/currency binding, complete country validation, currency semantics, authoritative sources and intended-role durable hosted readback remain open. No FX conversion, statutory correctness, real-provider acceptance, installed-image admission, authenticated customer workflow, deployment, or customer-readiness proof is claimed.
