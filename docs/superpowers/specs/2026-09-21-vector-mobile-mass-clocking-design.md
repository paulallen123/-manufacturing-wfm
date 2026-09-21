# VECTOR mobile workforce and mass clocking design

Date: 21 September 2026  
Status: DESIGNED — architecture and blue-and-white concept family approved by the user on 21 September 2026; implementation and deployed proof remain outstanding.  
Baseline: `paulallen123/-manufacturing-wfm@5ea6d4664e52348557e7e6284fe75a1c98d8a976`

## Outcome

Evolve the existing approved Vector interface, kiosk, clock-event API and Digital Twin into one role-aware operational system:

- Employee: My Work Assistant.
- Manager/supervisor: My Shift Copilot.
- Plant operations: Live Factory Control.
- Operations director: Multi-Site Command.
- CEO/MD/CFO: Business Outcome View.

This is additive. It does not reintroduce retired presentation code, create a disconnected mobile data model, weaken tenant/security controls, or represent forecasts as realised savings.

## User approval and authoritative concept art

The user approved this specification with the instruction: “Approve, but use the the concept arts from yesterday”, then resolved the visual selection explicitly: “Blue and white, green one was meant to have been deleted”. The blue-and-white family below is the sole approved visual direction for this workstream across desktop, mobile and tablet. No further colour-family approval is required.

The selected original images are dated 19 September 2026 and their pixels have been inspected. The user's explicit selection, not the creation date or existing shell, establishes their authority. Do not blend in the rejected green-and-black branding or use that concept as a fallback.

| Approved scope | Original reference | Persistent reference | Visual identity |
|---|---|---|---|
| Blue/white factory and mobile | Vector Factory Operations Dashboard Showcase.png | libfile_33da4b7756d8819199d2f94ace41d109 | Blue Vector mark, navy sidebar, white cards, blue actions; Today / People / Plan / Factory / Improve; light mobile screens |
| Blue/white leadership | Vector Directors & Ops AI Dashboard.png | libfile_cb7aadc34e9c81918ec2466924c1439f | AI summary, site comparison, decision list, Operations / Finance / MD-Executive views |
| Blue/white employee/shift detail | Vector Shift Pattern Dashboard.png | libfile_5bc8faf92d9c8191bee1e31feba1adef | Employee profile tabs, shift calendar, quick actions, rules-and-checks panel |
| Blue/white workflow board | Vector Workforce Management Dashboard Mockup.png | libfile_7d0b36fec9f881919c2b82d7bce92089 | Today, People, Plan, live factory, line detail, forecast, what-if and improvement screens |

The rejected green-and-black image (retired reference ID `libfile_c2829f0714088191b4352d292342dd09`) was confirmed still present and moved to recoverable trash on 21 September 2026. It is not an active design reference and must not be restored, offered again, or included in build/visual-test reference inputs unless the user explicitly changes this decision. Its local downloaded copy was removed from active references. Other source images are preserved. This records the removal of this identified asset, not a claim that every historical copy or deployed screen has been audited.

Visual acceptance rules for the blue-and-white family:

- Match the blue Vector mark, navy navigation, white/light content panels, blue primary actions, hierarchy, card geometry, spacing and action emphasis. Preserve the Today / People / Plan / Factory / Improve structure where appropriate to role authority, and the detailed leadership/profile layouts shown in their specific references. Mobile/tablet adaptations preserve identity while reducing density and retaining accessible touch targets.
- Green status indicators already present in the approved blue-and-white art (for example, available staff or covered shifts) remain legitimate semantic colours. Retiring the green-branded concept does not mean deleting green success indicators, data, or business functionality.
- Use the original reference images as comparison inputs, not generated replacements. Treat every illustrative person, company, date, chart and financial number as example content, never a live product claim.
- Keep role permissions and working engine actions intact. The kiosk must not expose leadership or employee-private information merely to resemble a dashboard.
- Capture actual desktop, tablet and phone screens alongside the mapped concept. Record deliberate responsive differences and fix clipping, text overflow, inaccessible controls or unapproved visual substitutions.
- A screenshot looking similar is visual evidence only. Functional acceptance still requires authenticated actions, saved state, refresh/restart and downstream assertions.

## Source-inspected foundation

The previous inspection found the following composition code and proof scripts in the repository. These scripts describe expected behaviour; they were not rerun during the architecture inspection and do not establish current end-to-end or physical-device acceptance:

- the Vector-only shell composed through `ux-overlay/vector-shell.js` and `vector-shell.css`;
- responsive authenticated role rendering on desktop and a 390x844 mobile viewport;
- a shared tablet/browser kiosk at `/kiosk.html`;
- tenant-scoped kiosk registration and revocation;
- one-time device credentials that are not returned by device listing;
- append-oriented clock-in/out ingestion through `POST /api/kiosk/sync`;
- idempotent replay, ordered device sequences and held sequence gaps;
- session-derived tenant authority that ignores or rejects client-supplied tenant selection;
- employee personal, manager time-review and attendance-correction surfaces.

The inspected manifest identifies a fixture-only release with `productionApproved=false` and `pilotReady=false`. The inspected Railway service metadata listed no attached volumes. Durable hosted storage still needs verification; these observations do not prove either successful persistence or data loss.

## Recommended architecture

### One engine, five projections

Keep one authoritative workforce event and state model. Role experiences are server-authorised projections of that state, not separate stores:

1. Clock, schedule, leave, skills, production and cost events enter authenticated commands.
2. Deterministic business rules validate tenant, person, site, role, time order, duplicate identity, skill/compliance and payroll consequences.
3. Events and their audit records commit durably and atomically.
4. Digital Twin projections update presence, staffing coverage, skills, line readiness, labour cost and exception state.
5. Each role receives only the projection and actions it is authorised to use.

The initial implementation should extend existing endpoints and presentation hooks. A mobile-native wrapper can follow only if browser/PWA limitations are proven; the first customer outcome should not wait for parallel iOS and Android codebases.

### Experience contract

| Role | First mobile outcome | Safe actions | Evidence shown |
|---|---|---|---|
| Employee | Today card with shift, line, clock state, break, entitlement and next required action | Clock, availability, leave, shift-swap interest, training acknowledgement | Own hours, balance, request status and audit trail |
| Manager | Shift exceptions ordered by production impact | Approve/reject, request replacement, accept suggested redeployment, correct attendance with reason | Staffing gap, skill gap, overtime/cost forecast and decision basis |
| Plant operations | Live line readiness and labour-to-output view | Rebalance qualified labour, open contingency, confirm operational intervention | Required vs present, skills, capacity, labour cost/unit and forecast confidence |
| Operations director | Multi-site exception and trend view | Drill down, assign action, approve governed cross-site response | Site comparison, cause, forecast/actual distinction and data freshness |
| Executive | Outcome and opportunity view | Set target/guardrail and request explanation | Reconciled savings, avoided cost, released capacity, margin effect and assumptions |

No role may see a control merely because the client renders it. The API remains the authority.

## Tablet Mass Clock Mode

The existing kiosk becomes a purpose-built shift-change surface:

- locked kiosk mode with site/device identity established during controlled registration;
- NFC/badge, QR and PIN adapters behind one employee-identification contract;
- immediate local acknowledgement and reset for the next person;
- encrypted offline queue with monotonically increasing device sequence;
- exact replay by event ID and content; changed reuse conflicts;
- visible offline/sync state without exposing other employees;
- server timestamp, captured timestamp, clock offset, device, site and method recorded;
- automatic hold for sequence gaps, impossible travel, revoked device, unknown worker, wrong site, duplicate/conflicting identity or excessive clock drift;
- no browser-supplied tenant authority;
- accessible fallback for employees unable to use the primary identification method.

Target service levels are acceptance targets until measured on representative hardware:

- acknowledgement displayed within 1 second at p95 while online;
- next-person-ready within 1 second after acknowledgement;
- no lost accepted events during network interruption or device restart;
- concurrent tablets at one entrance do not duplicate an employee event;
- 500-person shift-change simulation completes without a server-side queue becoming the bottleneck.

Biometrics, camera recognition, Bluetooth and silent presence remain optional adapters. They require explicit lawful basis, consent/works-council review where applicable, anti-spoofing and a non-biometric fallback. They are not prerequisites for the first Mass Clock release.

## Mobile delivery shape

Start as an installable responsive web app using the current Vector shell and engine:

- mobile bottom navigation and role-specific home;
- offline application shell and queued kiosk events only where the device is registered;
- push-capable notification contract, with SMS/email fallback outside the client;
- large touch targets, glove-friendly kiosk controls, high contrast and multilingual text keys;
- no sensitive workforce data cached beyond the minimum required for the authorised offline workflow.

Native apps are a later packaging decision for capabilities that require stronger OS integration such as managed-device NFC, background notifications or enterprise mobile-device management.

## Data and command boundaries

New or extended records must include tenant derived from authenticated authority, site, actor/device, server time, client capture time, business date, source method, idempotency key, correlation ID and correction relationship. Payroll and labour money use exact minor units. Effective-dated contracts, pay rules and skills prevent later edits from rewriting historical results.

Recommended interfaces:

- `GET /api/mobile/home` returns a role projection and allowed actions.
- `POST /api/time-events` accepts authorised personal clocking.
- `POST /api/kiosk/sync` remains the registered-device batch contract.
- `GET /api/shift-command` returns manager/operations exceptions and recommendations.
- `POST /api/recommendations/:id/decision` records accept/reject plus reason and expected effect.
- `GET /api/outcomes` separates actual, reconciled, forecast and opportunity values.

Exact endpoint names may follow the existing sealed runtime conventions, but the authority, idempotency, audit and response contracts are mandatory.

## First implementation slice

Deliver one complete event fan-out:

1. A registered tablet clocks a synthetic employee into their planned site and line.
2. The event is accepted once, audited and remains present after refresh and controlled restart.
3. The employee mobile home changes to “clocked in” with today's assignment.
4. The manager view updates present/required staffing and removes the missing-person exception.
5. Plant operations sees line readiness and labour cost update.
6. Director and executive views update their authorised aggregate only; no personal detail leaks upward.
7. An exact replay causes no second effect; a conflicting replay is rejected.
8. A different tenant cannot read or influence any state.

This is the smallest slice that proves the “one engine, five experiences” claim.

## Failure behaviour

- Offline: queue locally, show pending state, sync in order when reachable.
- Unknown outcome: reconcile by event ID before retrying.
- Sequence gap: hold later events and request missing sequence.
- Device revoked: reject immediately and preserve queued data for authorised recovery.
- Duplicate/conflict: exact replay returns the prior result; changed payload returns conflict.
- Projection delay/failure: retain authoritative event, report stale projection and rebuild from the event log.
- Recommendation unavailable: keep deterministic exception data usable; AI must not be required to clock, pay or enforce policy.

## Verification and release gates

Use test-first development. Required evidence:

- unit/contract tests for authority, event validation, projection and outcome classification;
- API tests for success, replay, conflict, sequence gap, clock drift, revoked device and cross-tenant denial;
- browser proof for all five role projections using the same release identity;
- offline/reconnect and controlled-restart proof;
- concurrency test with multiple devices and a 500-person shift-change workload;
- accessibility and mobile viewport checks;
- console/network capture, screenshots, trace, business-state assertions and immutable build identity;
- three repeatable first-attempt runs in the hosted preview lane before promotion.

The feature is BUILT when implemented with local/preview tests. It is PROVEN only after repeatable hosted evidence on the approved environment. Production and pilot flags stay false until persistent storage, restore and the wider release gates pass.

## Release approach

Implement on a short-lived feature branch, deploy to an isolated preview, then merge through `integration/canonical` and the documented release-control path. Do not change the current canonical staging service, security holds, or frozen artifact until the replacement candidate has equivalent or stronger regression, security, provenance and customer-journey evidence.

## Deferred, not discarded

- native iOS/Android packaging;
- silent Bluetooth/Wi-Fi presence;
- camera/biometric identification;
- cross-site automatic redeployment;
- real push providers;
- reconciled payroll and financial outcome certification;
- full 10,000-employee/50-site performance proof.

Each remains in the additive roadmap and must use the same event, authority and projection contracts.
