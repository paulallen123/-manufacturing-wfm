# WFM Adaptive Immune Defence Mesh

Status: architecture + staged defensive controls. Not a claim of invulnerability.

## Mission

Assume a determined attacker may eventually obtain a valid credential, exploit a workload, compromise a dependency, poison telemetry, or interfere with a defensive agent. The system must prevent one compromise from becoming durable control of the customer environment.

The design follows five goals: anticipate, withstand, contain, recover and adapt.

## 1. Security control plane is separate from the application plane

The WFM application cannot be trusted to defend itself after compromise. Security policy, immutable evidence, recovery authority and emergency containment live in an independently administered control plane with separate identities and credentials.

Application workloads may REQUEST a defensive action, but they cannot change the rules that decide whether the action is permitted.

## 2. Customer blast-radius cells

Each customer/tenant is placed in an independent security cell with separate runtime identity, policy state, session-revocation namespace, audit chain, containment budget, recovery manifest and deception objects.

A compromised customer workload must not gain credentials or control-plane authority over another customer cell.

## 3. Deterministic reflex engine

Low-blast-radius, reversible actions are pre-authorised and require no AI decision: revoke a session/token, invalidate an authentication cache entry, temporarily rate-limit an identity/source, isolate a workload, stop a confirmed malicious process, remove temporary unauthorised privilege, quarantine an artifact/deployment, block malicious ingress/egress, freeze a deployment, or preserve a forensic snapshot.

Every reflex requires explicit evidence predicates, TTL, customer scope, action budget, immutable audit entry and rollback path.

## 4. Deception / attacker tripwires

Deploy objects with no legitimate business use: decoy session tokens, credentials, API resources, files/configuration records and privileged identities. Any use is high-signal because legitimate software has no reason to touch them. Tripwires never grant production authority and lead only to monitored decoy/quarantine resources.

## 5. Moving-target identity and session strategy

Reduce attacker dwell time with short-lived workload credentials, frequent session-key rotation, per-service identities, just-in-time privilege, automatic invalidation after deployment/security-boundary changes and ephemeral instance identities where infrastructure permits.

## 6. Independent immutable evidence plane

Security logs are streamed out of the workload trust boundary in near real time. Application administrators cannot rewrite past security evidence. Evidence records include event hash, previous-record hash, policy version, customer cell, actor/workload identity, action, reason, sequence and timestamps. Loss of telemetry is itself a security incident.

## 7. Recovery plane survives production compromise

Recovery credentials and authority are independent from normal production administration. Backups/recovery points require immutability or soft-delete, version history, independent access, protected encryption-key recovery and routine isolated restore tests.

## 8. AI is not root of trust

AI/agents can correlate evidence, research threats, explain events, propose policies and generate candidate detection logic. AI cannot change policy roots, create itself privileges, disable immutable logging, destroy production data, mass-disable users, change payroll/workforce records, or approve its own proposed policy.

## 9. Two-key rule for catastrophic actions

Actions capable of customer-wide or organisation-wide outage/destruction require two independent authorities. One compromised administrator, agent or workload must not be sufficient.

## 10. Survival invariants

The platform is not Last Line ready unless these are demonstrated:
1. one compromised tenant cannot administer another tenant;
2. compromised app runtime cannot rewrite historical security evidence;
3. compromised production admin cannot destroy the final recovery path alone;
4. AI cannot promote its own security policy;
5. loss of security telemetry triggers fail-safe containment/escalation;
6. emergency rules expire automatically;
7. automatic containment is scoped, auditable and reversible;
8. decoy objects carry zero production authority;
9. recovery is tested from isolated infrastructure;
10. defence-plane compromise has its own detection and recovery procedure.
