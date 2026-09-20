# Frontier experiment: Loss-Prevention-Aware Workforce Orchestration

## New connection
Combine property/fire-protection impairment state, permit-to-work and hot-work controls, current workforce competence/availability, maintenance restoration plans and production commitments.

The product question is not simply "do we have enough people?" It is: **while a protection system is impaired, do we have the exact temporary control roles required by the site's authoritative policy, and is there a safe restoration option that reduces exposed time while releasing more workforce capacity than it displaces?**

This is deliberately different from generic safety-role coverage. The trigger is a live loss-prevention impairment and the objective is to coordinate temporary risk controls, restoration work and workforce/production capacity without converting insurance or safety guidance into autonomous operating authority.

## Falsifiable hypothesis
A deterministic impairment-aware workforce planner can identify safe earlier-restoration opportunities that reduce protection-impaired time and temporary control-person minutes without reducing protected customer, process-safety or quality commitments.

### Simple alternatives
1. Keep the production/maintenance plan unchanged until the impairment is restored naturally.
2. Always restore immediately, regardless of the labour/production displacement created.

### Success threshold
Continue only if realistic replay can show all of the following:
- zero recommendations when mandatory temporary-control coverage is absent;
- zero use of cross-site competence unless an authoritative assignment exists;
- at least 20% median reduction in temporary-control person-minutes in qualifying impaired scenarios;
- no degradation of protected customer, process-safety or quality commitments;
- no conversion of modelled exposure reduction into an insurance-premium or loss-probability claim without authoritative customer/insurer evidence.

### Stop criterion
Stop or redesign if authoritative impairment/policy/restoration evidence is unavailable, local policy cannot be represented without unsafe generalisation, realistic replay creates material production harm, or the feature pressures users to bypass permit-to-work, fire-protection or process-safety authority.

## Scale inversion
- **1 employee / 1 site:** if site policy requires a second dedicated watcher/control role, the correct output is "no safe internal staffing solution" with approved external-cover/cold-work/defer options. The engine must not make the same person count twice when policy prohibits it.
- **10,000+ employees / many sites:** evidence remains site-scoped. Jurisdiction, insurer engineering requirements, local PTW policy, competency expiry, language and legal-entity context are resolved locally; competence is never borrowed silently across sites.

## Safety boundary
Advisory/orchestration only. This component cannot approve hot work, issue/close permits, command fire-protection systems, change OT state, waive a fire watch, declare an impairment safe, or determine insurance coverage. Consequential authority remains with deterministic site policy, PTW, engineering, EHS and insurer/customer controls.

## Self-learning path
Capture recommendation -> accepted/rejected action -> actual restoration time -> temporary-control staffing actually used -> production/maintenance outcome -> incident/near-miss evidence -> realised labour/downtime effect -> calibration update. Predicted, simulated and realised outcomes stay distinct. Learning may improve estimates but may not relax safety rules automatically.

## Market/research evidence used for qualification
- FM impairment services: fire-protection impairment increases property risk; impairments are tracked until protection is restored and loss-prevention engineers help minimise risk and interruption.
- FM hot-work resources: hot-work permits are designed for manufacturing facilities and hot work remains a leading property-loss cause.
- UK HSE welding guidance: where hot work cannot be isolated from combustible risk, a fire watch should be maintained during and after work.
- US OSHA 1910.252: specified hot-work conditions require fire watchers, trained and equipped, and supervisors must ensure required fire watches are available.
- OSHA shipyard fire-watch guidance is an example of a jurisdiction-specific rule where the hot worker cannot simultaneously perform fire-watch duty; the engine therefore models this only as local authoritative policy, never as a universal rule.

## Current evidence state
Source-level prototype and synthetic falsification only. No customer impairment data, insurer integration, legal-compliance certification, realised insurance saving or production deployment is claimed.
