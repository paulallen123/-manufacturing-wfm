# Automatic Attendance — privacy / DPIA release gate

Status: mandatory release evidence for the isolated invisible-attendance candidate. This document does not approve production processing.

Checked against current UK ICO worker-monitoring and biometric guidance on 18 September 2026. The ICO notes that parts of its guidance are under review following the Data (Use and Access) Act, so legal/compliance review must re-check the current guidance before production promotion.

## Default data posture

- Use customer infrastructure already needed for work/access; do not introduce surveillance merely to improve attendance confidence.
- Collect event-level attendance provenance only. Do not retain continuous location trails, SSIDs, raw credential values, imagery, audio, biometric templates, or unrelated device activity.
- Provider source time and server receipt time are retained separately because they are necessary to explain/reconcile attendance decisions.
- Evidence that cannot safely identify a worker/site or satisfy the attendance policy remains evidence-only/review-required.
- Presence evidence is not itself a pay rule and cannot silently change contractual paid time.
- Biometrics/facial recognition are excluded from the default v1 path.

## Customer DPIA / governance evidence required before enablement

The production release gate must retain evidence that the customer/controller has, for the intended sites and worker population:

1. documented the specific attendance purpose and necessity of each monitoring source;
2. considered less intrusive means and can justify why the selected sources are proportionate;
3. identified the applicable lawful basis and documented it;
4. completed a DPIA where required, including consultation/worker impacts where applicable;
5. provided clear worker transparency information covering sources, purpose, retention, recipients, automated processing and review/correction routes;
6. defined retention/deletion periods for attendance evidence and audit provenance;
7. restricted access by tenant/site/role and defined access-review procedures;
8. documented how workers exercise access, correction, objection and other applicable rights;
9. verified that automatic attendance decisions have an accessible human review/correction route before payroll impact;
10. documented processors/sub-processors and international-transfer safeguards where relevant;
11. assessed security, integrity, availability and breach-response controls for evidence sources;
12. confirmed the source configuration does not capture unrelated high-risk content such as message contents, webcam footage or raw location history.

## Additional biometric prohibition / gate

Biometric recognition used to identify workers for timekeeping is special-category processing under UK GDPR. It is not accepted as a default evidence provider in this release.

Any future biometric provider must be a separately approved design and must not be enabled by this v1 gate. At minimum it requires a dedicated DPIA, lawful basis plus an applicable special-category condition, an evidence-based necessity/proportionality assessment, worker transparency, security/accuracy/fairness controls, rights handling, and a viable non-biometric alternative where required. Raw biometric templates must not enter the attendance evidence engine.

## Release evidence

The executable attendance release control must keep the `privacyDpia` gate red until the relevant deployment has a traceable evidence identifier for the completed privacy/DPIA review. A generic product document or this checklist alone is not sufficient to green a customer deployment.
