# Exact-lot acceptance sampling admission

**State:** DESIGNED for canonical QMS/quality owner review. This document grants no lot acceptance authority.

**Source:** Accepted VECTOR research/convergence requirement, issue #265 comment 6076069514: a passing sample or stated AQL does not prove that the exact lot was accepted under an authorised plan. This is one distinct requirement, not a new feature for each historical discussion record.

## Existing boundary

At canonical `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`, `operations/runtime/quality-workforce-shadow.cjs` (Git blob `534509723101069c43990ade22b56e1beadf34e3`) produces an aggregate quality-review shadow and advisory options. It is not a lot acceptance writer or QMS approval record. Its quality events, alert and recommendation cannot be promoted into a released-lot decision. PR #361's separate context-provenance work retains ownership of that shadow.

## Authoritative inputs before any implementation can say ACCEPTED

1. A QMS-owned lot identity: tenant, site, product/revision, lot identifier, lot size and source record/version. A request-supplied string or sourceRef alone is insufficient.
2. An approved sampling-plan version and effective interval for the lot, product/revision, inspection class, risk/inspection level, AQL and selection method. The plan owner must define the actual acceptance/rejection numbers and switching rules; VECTOR must not derive them from a generic AQL label.
3. A custody-linked sample frame: sampled unit identifiers, selection time/method, inspector/device identity, inspection results, defects by plan category and complete exceptions. A passing subset must not silently stand for the declared frame.
4. A distinct, authorised QMS disposition event for that exact lot source version and plan revision, citing the provider-issued inspection/sample-frame ID, results version or digest and lot-size snapshot it actually approved. Retain actor and decision-time authority, recorded time, policy version and immutable audit identity. A sample result is evidence for the disposition, not the disposition itself; a later frame, result, lot-size or plan change requires a new authorised disposition.
5. An independently current QMS read at publication, or a provider-scoped monotonic sequence/revision stream with a verifiable high-watermark, gap detection and reconciliation. A disconnected or lagging stream cannot establish current acceptance. Conditional source-version checks at publication must distinguish absent, superseded, conflicting, explicitly revoked and subsequently rejected decisions. Tenant/site scope and lot revision must be checked at read and publication time.

## Fail-closed transition contract

| Observed input | Admissible state | Reason |
| --- | --- | --- |
| AQL label or plan draft only | `PLAN_UNVERIFIED` | No approved plan and effective lot binding. |
| Passing measurements without complete frame/custody | `SAMPLE_INCOMPLETE` | Selection and denominator unproven. |
| Complete sample under approved plan, no disposition | `AWAITING_DISPOSITION` | Sampling result cannot approve a lot. |
| Disposition for another lot, revision, tenant or plan | `SCOPE_CONFLICT` | No cross-lot or cross-version borrowing. |
| Conflicting, explicitly revoked, expired or superseded decision; stream gap or unknown current watermark | `REVIEW_REQUIRED` | The most favourable historic result cannot win by arrival order or stale delivery. |
| Independently current QMS disposition, exact lot/plan/inspection snapshot and audit readback | `ACCEPTED` or `REJECTED` as recorded | Only after decision-time authority, conditional current-source check and durable confirmation. |

The eventual product adapter must return a reasoned unavailable/review state during source outage or sequence gap until a current authoritative reread reconciles the provider watermark. It must not convert `PLAN_UNVERIFIED`, `SAMPLE_INCOMPLETE`, `AWAITING_DISPOSITION` or `REVIEW_REQUIRED` into `ACCEPTED` through defaults, AI inference or an aggregate quality score. `REJECTED` is a distinct state and must never be overwritten by a late passing sample without a new authorised disposition. Decision-time approver authority, current reader/publisher permission, and explicit QMS revocation of a historical disposition are separate checks; later role loss does not rewrite a valid historical decision.

## Minimum executable acceptance cases for the owner

- Same passing sample with a changed lot identifier, tenant, product revision, plan version or sample frame remains unaccepted.
- A disposition is not reusable with a changed lot source version/size, inspection ID, sampled-unit frame, result digest or plan effectivity; mixed revisions stay unaccepted pending a new QMS disposition.
- A 100% passing sampled set with no signed disposition remains `AWAITING_DISPOSITION`.
- AQL text without plan acceptance/rejection numbers and approved effectivity remains `PLAN_UNVERIFIED`.
- Duplicate provider delivery is idempotent; equal-time contradictory dispositions require explicit conflict handling, not last-write-wins. Missing/out-of-order sequence including a later rejection or revocation withholds acceptance until an independently current QMS reread closes the gap.
- A rejection followed by an older passing event stays rejected/review-required. Current reader/publisher role loss denies that actor's access, while an explicit QMS revocation changes the disposition state; neither conflates with the historical approver's decision-time authority.
- After restart and fresh authenticated login, the same lot decision, source version and audit event read back. Cross-tenant and lower-privilege reads fail closed.

## Integration and proof gate

The canonical owner first confirms the genuine QMS/inspection provider schema, plan and disposition authority, then reuses the existing integration-fabric identity/replay/audit contracts. The owner must identify the actual lot-disposition consumer and separately determine whether it controls production release; sampling acceptance alone is not release authority. It must not be wired to the advisory workforce shadow as a substitute. Run source fixtures and negative cases, native Node 22 and exact combined image checks, then approved synthetic hosted QMS event→authorised disposition→durable readback→fresh login→audit proof on one serving SHA. Actual customer lots, approvals and production release are outside this design package.
