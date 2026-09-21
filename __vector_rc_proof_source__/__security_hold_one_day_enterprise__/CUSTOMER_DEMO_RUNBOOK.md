# Manufacturing WFM — Live Customer Demonstration Runbook

**Environment:** isolated fictional-data customer-proof staging  
**URL:** `https://wfm-staging-runtime-0670-production.up.railway.app`  
**Build:** `0.6.76-hosted-staging-rc1`

## Before the customer joins

1. Open `/api/health` and confirm a healthy response.
2. Open the application in a clean browser session.
3. Sign in with the current Railway `WFM_STAGING_PASSWORD`. The password must remain a non-derived 20+ character staging credential; never use the retired deterministic URL-derived credential pattern.
4. Confirm the application clearly states that the environment contains fictional/demo data and is not production approved.
5. Keep this runbook open so the demonstration follows a repeatable path.

## 12-minute proof journey

### 1. The operating picture — 60 seconds

Start on the main operations/readiness view. Explain that the system connects people, skills, availability, production demand, labour cost, compliance, decisions and outcomes rather than acting as a rota-only application.

Show the active operational/readiness indicators and the weekly review surface. The purpose is to establish one operating picture before drilling into individual workflows.

### 2. Onboarding and workforce data — 90 seconds

Open onboarding/company administration. Show how workers, organisational context and related workforce data are represented. Explain the target operating model: post-sale requirements drive configuration and workforce/integration onboarding with automation rather than repetitive implementation administration.

### 3. Skills + availability + demand — 90 seconds

Show resource/skills and availability information, then manufacturing demand. Explain that a worker is evaluated in the context of qualification, availability, work rules and production requirement rather than simply as a name on a shift.

### 4. Labour planning + schedule publication — 90 seconds

Open scheduling and schedule publication. Demonstrate how workforce requirements become a publishable plan. Highlight exception visibility and the principle that the system should present managers with evidence-backed decisions rather than force them to manually reconcile data across spreadsheets.

### 5. Clocking / kiosk — 60 seconds

Open `/kiosk.html`. Show the low-friction clocking surface and the separate administrative controls around kiosk/attendance behaviour. Explain that the product is designed to support low-cost browser/tablet-based clocking rather than requiring an expensive proprietary terminal.

### 6. Disruption, exception and recovery — 90 seconds

Return to operations/readiness and show how an operational exception is surfaced. Walk through the relevant recommendation/decision view and explain that the target behaviour is: detect → understand operational/cost impact → propose safe actions → manager approves where required → retain evidence of the decision and outcome.

### 7. Time review + payroll control — 90 seconds

Open time review and payroll-control surfaces. Demonstrate that attendance exceptions can be reviewed before payroll handoff, with reconciliation/status visibility intended to make payroll issues traceable back to workforce/time evidence.

Do **not** claim a genuine live NetSuite/SAP/Oracle HCM production integration in this demonstration unless a separately authorised provider test has been completed and evidenced.

### 8. Cost / ROI decision intelligence — 90 seconds

Show cost/economic views, overtime monitoring and recommendation surfaces. Explain the product objective: quantify avoidable workforce cost and make the saving/action understandable enough that the customer can make a simple evidence-backed decision.

### 9. Audit + support — 60 seconds

Close on evidence/audit behaviour and support surfaces. Explain the intended operating model: customer actions, changes, exceptions, decisions and recovery steps should leave traceable evidence; support automation is designed to diagnose and guide/fix bounded issues while maintaining security controls.

## Questions the demo must answer

By the end, a buyer should have seen evidence for these questions:

- Is this a real hosted application rather than a slide deck? **Yes — show the live HTTPS environment.**
- Can it represent manufacturing workforce context rather than only shifts? **Show skills, availability, demand and operations together.**
- Can the user get from demand to a labour plan and published schedule? **Demonstrate the workflow.**
- Is clocking available without specialist hardware? **Show the kiosk/browser experience.**
- Can attendance feed a controlled payroll process? **Show time review/payroll-control evidence.**
- Can it explain financial impact and recommended action? **Show cost/recommendation surfaces.**
- Is the build reproducible and tested? **Reference the sealed 0.6.76 manifest and 1878/1878 regression result.**
- Are you claiming more than is proven? **No — state clearly that genuine provider certification, independent assurance and production approval are separate gates.**

## Demonstration pass criteria

The customer-proof demo is considered successful only if all of the following are observed in the live environment:

- HTTPS loads successfully.
- `/api/health` is healthy.
- unauthenticated protected data is rejected.
- valid staging login succeeds.
- dashboard/bootstrap data loads.
- readiness/operations and weekly-review data load.
- scheduling/publication view loads.
- kiosk page loads.
- time review/payroll-control surfaces load.
- cost/recommendation surfaces load.
- no blocking console/runtime error interrupts the journey.

Record screenshots/video and the deployment/build identifiers from the same run when producing customer evidence.
