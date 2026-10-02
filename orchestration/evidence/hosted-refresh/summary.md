# Read-only hosted proof truth refresh

Latest executor log: **2026-10-02T09:54:03.214004689Z**, collected from Railway. The same frozen application source f32ca1a2672d47dcff8ef6cd1c3d71c77cf60560 and deployment54e96e40-5fc2-428b-b96d-7453a5fa1810 remain observed. Railway lists application and executor deployments as SUCCESS; this is deployment status, not customer completion.

Existing executor reports northstar-demo / run09c83c6c-ddc6-4ba7-b8aa-adaa5d80295e, **5/21** requirements complete, state SLA_MISSED, operationalReady=false, activeWorkerLeases=0, customerProofComplete=false and productReady=false. Reported health is200 with fixtureOnly=true and productionApproved=false. Eight open requirements need revalidation, seven are missing, and absence policies remain WARN.

Executor deployment0255e65b-e501-4f83-9c04-8433ccf15471 still reports codeSHA2569fe6397209f8ee9c4c1b8d493534d3032193f5022e7fb637db9f6ff2d83d4438. These fields match the inherited08:20Z tuple, which is preserved separately in observations.json. No new deployed application head was observed.

Filtered OpenAI/openai/usage/error application log searches returned zero matching entries in the06:58–09:52:27Z window. This does not establish OpenAI availability, budget, absence of errors, or any provider proof. The logged Gusto metadata was acquired06:58:50.375Z and explicitly says stored application metadata only; it reports zero connection rows and provides no fresh provider authorization/data evidence.

Exact readback, requests, bounded executor log windows and gaps are in readback.json, logs.json and observations.json. No Railway variables or service configuration were fetched; no browser, direct provider request, write, deployment or configuration change was performed.
