# VECTOR Agency Operating System V2

Status: DEVELOPMENT / SHADOW ONLY  
Branch: `feature/agency-operating-system-v3-20260925`  
Parent: `frontier/agency-labour-exchange-v1`

## Purpose

Agency labour is a core VECTOR operating domain, not a separate VMS-style add-on.

The target closed loop is:

```
production demand
→ required capability
→ internal alternatives
→ agency decision
→ supplier selection
→ worker selection
→ preparation / compliance
→ attendance
→ output / quality / safety
→ cost / invoice
→ outcome
→ learning
```

Existing agency exchange, supplier compliance, right-to-work, work-start, schedule-preflight, portal and delivery controls remain authoritative hard gates. The V2 layer adds decision intelligence above them and must not weaken them.

## New capabilities

### 1. Portable worker capability passport

`src/frontier/agency-worker-passport.mjs`

- verified skills and qualifications
- site / role / line familiarity
- verified training progression
- attendance, punctuality, quality and productivity evidence
- worker shift/site/role preferences
- improvement opportunities for first-site / first-line support
- explicit rule that declining an optional shift is not a reliability failure
- sensitive/protected attributes excluded from ranking inputs
- evidence confidence and deterministic passport hash

### 2. Contextual worker intelligence

`src/frontier/agency-operations-intelligence.mjs`

Eligible workers are ranked only after deterministic compliance checks pass.

Context considers:
- proven shift performance
- site, role and line familiarity
- worker preferences
- evidence confidence
- bounded exploration for new workers so missing history does not create permanent lock-out

Outputs explain strongest drivers and uncertainty.

### 3. Realised-outcome supplier intelligence

Supplier ordering now has a model that can consider:
- fill reliability
- attendance
- response speed
- invoice accuracy
- first-shift success
- repeat-worker continuity
- quality-adjusted production outcomes
- production failures
- cost per good unit

This is deliberately different from “lowest charge rate wins”.

### 4. Scenario simulation

VECTOR can compare flexible-labour alternatives using deterministic stochastic simulation.

Example options:
- internal redeployment
- overtime
- agency only
- mixed internal + agency
- production-plan change

The simulator returns:
- expected net value
- downside (P10)
- upside (P90)
- service-success probability
- risk-adjusted value

No simulation may override compliance or worker-rights gates.

### 5. Risk-based autonomy

Autonomy requires all of:
- compliance PASS
- action within customer authority policy
- decision confidence above class threshold
- safe reversibility
- acceptable data quality
- non-high-risk context
- no adverse employment decision

Otherwise VECTOR remains recommend / prepare / approval-gated.

### 6. Decision + outcome ledger

`src/frontier/agency-decision-ledger.mjs`

Every material decision records:
- context
- alternatives considered
- selected alternative
- evidence available at decision time
- policy and model versions
- approval state

Actual outcome is appended separately:
- attendance
- production
- quality
- safety
- labour cost
- invoice
- manager intervention
- realised value
- attribution quality

The decision-time hash is preserved when the outcome is recorded.

### 7. Three-sided experience model

`src/frontier/agency-operating-system.mjs`

**Operations**
- sees demand gaps, alternatives, cost, risk, confidence and outcome evidence
- receives a recommended labour mix
- can approve or allow bounded execution
- learns from the result

**Agency**
- receives precise machine-readable demand
- gets candidate eligibility feedback and rejection reasons
- gets live supplier outcome feedback
- supports faster fulfilment and dispute prevention

**Worker**
- sees one clear shift packet
- receives readiness / induction / training information
- carries verified capability forward
- retains preferences and optional-shift choice
- can build evidence that improves future matching

## Hard boundaries

- compliance and safety are deterministic hard gates
- protected/sensitive attributes are not ranking inputs
- optional-shift declines do not reduce reliability
- AI ranking cannot directly alter worker pay or payroll
- high-impact or non-reversible actions require human authority
- cold-start / low-evidence workers receive uncertainty handling rather than silent exclusion
- every automated decision must be auditable and reversible where the decision class permits it

## Proof added

`test/frontier/agency-operating-system-v2.test.mjs`

Covers:
- optional-shift fairness
- sensitive-field exclusion
- verified capability progression
- hard-gate preservation
- new-worker exploration
- realised-outcome supplier ranking
- deterministic stochastic simulation
- risk-based autonomy
- immutable decision/outcome evidence
- unified Operations / Agency / Worker closed loop

CI:
`.github/workflows/agency-operating-system-v2-shadow.yml`

The gate runs the new tests plus retained agency exchange and performance tests on pinned Node 22.23.2.

## Integration rule

This branch is isolated from the protected VECTOR customer-readiness lane.

Do not merge into the canonical release until:
1. shadow tests pass,
2. existing agency regression remains green,
3. data-model and UI integration is reviewed,
4. hosted private-Test proof exists,
5. agency + worker + operations journeys are browser-proven,
6. persistence / restart / recovery is proven,
7. fairness, privacy and automated-decision controls are reviewed,
8. no release/security/payroll gate is weakened.

Agency labour is nevertheless a **core product pillar** in the target architecture and should be represented in the product navigation, Operations Control Tower, Golden Journey and value proof once these gates pass.


### 8. Zero-touch temporary clocking after worker confirmation

`src/frontier/agency-temp-clocking-profile.mjs`

A finally confirmed agency worker who passes the existing work-start readiness gate automatically receives a temporary clocking identity and a placement-bound clocking entitlement. The intended worker journey is:

```
agency confirms worker
→ VECTOR revalidates readiness
→ temporary clocking profile/entitlement created
→ secure QR/PIN or verified badge made available
→ worker arrives
→ clocks in / breaks / clocks out
→ raw events flow to attendance review
→ profile expires or is revoked automatically
```

Rules:
- no manager setup is required on the day of the shift;
- a supplier nomination alone never activates clocking;
- worker, agency, site, request and placement scope must all match;
- the profile is time-limited to the placement plus configured early/late clocking grace;
- the stable temporary-worker principal can be reused on a later booking, but each placement gets a new entitlement;
- cancellation, replacement, lost site access or readiness revocation blocks new clock-ins;
- an already-open session can still clock out safely after revocation/expiry so VECTOR never traps a worker in an open shift;
- raw kiosk events are preserved and remain subject to attendance review;
- the clocking profile never grants payroll, schedule, invoice, worker-master or management authority;
- credentials use a secure QR/PIN/badge mechanism and plaintext credentials are not stored in the profile;
- kiosk data contains only the minimum identity and placement linkage needed for clocking.

This closes the deliberate gap between agency confirmation and arrival: the customer should not have to manually create a worker in the clocking system for every temporary placement.
