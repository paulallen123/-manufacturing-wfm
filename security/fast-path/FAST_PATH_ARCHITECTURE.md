# Last Line Defence — Microsecond-Class Fast Path

Status: design + safety contract only. Not production enabled.

## Objective

Reduce the *first defensive enforcement decision* from millisecond-scale orchestration to a microsecond-class hot path where the infrastructure supports it. This is a target, not a guaranteed latency claim.

The fast path is deliberately deterministic. AI, LLMs and remote control-plane calls must never sit between an inbound event and the first allow/drop/isolate decision.

## Layered response path

### L0 — NIC / XDP pre-stack enforcement

Target: microsecond-class packet decision on supported Linux hosts/NICs.

Use precompiled eBPF/XDP rules and bounded BPF-map lookups for already-known malicious or explicitly denied traffic. Permitted actions are PASS, DROP and REDIRECT to an authorised quarantine/scrubbing path. No external retaliation is permitted.

This layer is suitable for:
- explicit denylisted addresses/prefixes derived from validated evidence;
- malformed or protocol-impossible traffic that can be identified without application context;
- emergency traffic suppression rules with a short TTL;
- line-rate rate-limit/redirect controls where supported.

It must not make payroll, workforce, identity-ownership, legal, disciplinary or other business decisions.

### L1 — host / workload eBPF enforcement

Target: microsecond-to-low-millisecond decision on supported hosts.

Use tc/cgroup/socket hooks for workload identity, egress restrictions and service-to-service policy. Enforcement uses local maps only; no synchronous network dependency is allowed in the hot path.

### L2 — application request guard

Target: sub-millisecond local decision for precomputed identity/session policy.

At the first application middleware boundary, check locally cached revocation/session/device/risk keys and deterministic tenant-policy rules. The hot-path cache is populated asynchronously by the security control plane. A remote database, AI model or external API must never be required to decide whether a request is immediately blocked.

### L3 — orchestration / containment

Target: milliseconds to seconds.

Perform token revocation, workload quarantine, deployment pause, credential rotation within approved scope, forensic capture, rollback and recovery. This layer may coordinate multiple services but remains deterministic and auditable.

### L4 — AI / threat-intelligence analysis

Target: seconds to minutes; never part of first enforcement.

AI may correlate events, summarise evidence, propose new detections and prepare candidate policies. It cannot directly authorise broad or irreversible production actions. Candidate rules are validated, signed and promoted through deterministic policy gates before they can enter L0-L2.

## Control-plane rules

1. **Last-known-good enforcement** — dataplane continues using the last valid signed policy if the control plane is unavailable.
2. **Atomic policy updates** — maps/configuration are swapped atomically; never partially apply a policy.
3. **TTL on emergency rules** — temporary blocks expire automatically unless revalidated.
4. **Per-customer blast radius** — tenant/customer cells have independent policy state and action budgets.
5. **No AI-authored direct execution** — AI outputs are untrusted candidate data until deterministic validation succeeds.
6. **Immutable evidence** — every policy promotion records source evidence, signer, checksum, timestamps and rollback version.
7. **Kill switch** — fast-path enforcement can revert to the previous signed policy without deleting evidence.
8. **No hack-back** — no rule may redirect traffic into, damage or access third-party attacker infrastructure.

## Latency SLOs

These are engineering objectives to measure on the eventual target infrastructure, not claims about the current Railway environment.

| Layer | Target decision budget | Measurement |
|---|---:|---|
| L0 XDP/NIC | <= 100 µs p99 | packet ingress to XDP verdict |
| L1 host/workload | <= 250 µs p99 | hook entry to verdict |
| L2 app request guard | <= 500 µs p99 | middleware entry to local verdict |
| L3 containment dispatch | <= 50 ms p99 | validated event to executor receipt |

A deployment must publish measured p50/p95/p99 and false-block rate before any latency or protection claim is made.

## Current WFM/Railway position

The present Railway test services use managed containers and are suitable for staging/browser/testing work, but they are not currently verified as exposing the kernel/NIC privileges required for XDP/eBPF fast-path enforcement. Therefore no XDP deployment should be claimed there.

The immediate implementable path for WFM is:
1. preserve the current private staging posture;
2. build L2 local request/session guard into the real WFM runtime once the immutable runtime artifact is restored;
3. keep L3 containment asynchronous and reversible;
4. benchmark L2 locally;
5. add L0/L1 only on infrastructure explicitly verified to support eBPF/XDP safely.
