# Agency Labour Orchestration v1 proof

Purpose: prove a manufacturing-facing orchestration layer that turns a labour shortage into compliant agency cover with minimal factory and agency touches.

## Implemented proof capabilities
- supplier cascade with configurable response windows and preferred tiers
- role/skill/certification eligibility checks
- explainable worker-fit bands rather than a permanent global worker score
- new-worker neutral baseline and capped site-history advantage
- same-day / short-notice risk flagging with evidence capture hooks
- commitment ladder: FORECAST -> SUPPLIER_RESERVED -> WORKER_OFFERED -> WORKER_CONFIRMED
- anti-evasion guard: forecast/reservation must not disguise a worker-specific request or be used to avoid worker rights
- no-show and late-arrival exception detection
- approved-hours/rate versus invoice reconciliation
- transparent touchless-fulfilment savings calculator

## API
- GET /api/health
- GET /api/policy
- POST /api/requirements/plan
- POST /api/attendance/exceptions
- POST /api/invoices/reconcile
- POST /api/value/touchless

## Important compliance design
The Employment Rights Act 2025 creates future agency-worker rights around guaranteed hours, notice of shifts, changes/cancellations and short-notice payments, but the detailed secondary-legislation thresholds are not final. Therefore the proof never hard-codes a statutory notice threshold: policy values are configurable and clearly marked as customer/test configuration until final regulations are known.

Worker recommendations are decision-support only. Protected characteristics and health data are excluded. Human review remains required for worker choice in this proof, and each recommendation is accompanied by reasons and confidence based on comparable role/site history.

## Next integration targets
1. Feed labour gaps directly from production demand, roster, absence and overtime modules.
2. Add agency API adapters (Bullhorn / Vincere / generic webhook) and a lightweight supplier portal.
3. Persist requirement, supplier-response, worker-notice and cancellation events for full audit evidence.
4. Add worker mobile one-tap availability/acceptance and agency roster bulk upload.
5. Connect confirmed workers to site access / clocking and trigger immediate replacement on no-show.
6. Reconcile approved time to supplier invoices and surface verified savings in the manager cost cockpit.
