# Autonomous release gates

A Northstar release is automatically rejected if any gate fails.

1. **Isolation** — attempt cross-tenant reads/writes and confirm denial.
2. **Production egress** — attempt DNS/IP/URL access outside the allowlist and confirm denial.
3. **Synthetic-only** — seed scans must find no real customer records or production secrets.
4. **Authentication** — anonymous/expired/forged credentials must fail closed.
5. **Authorization** — every tool is exercised against wrong tenant, wrong role and wrong resource.
6. **Destructive-action exposure** — public MCP inventory must contain no destructive production action.
7. **Fault containment** — injected latency, duplicate messages, invalid payloads and expired tokens stay inside the selected environment.
8. **Reconciliation** — input, output and persisted state totals must reconcile or the run fails.
9. **Rollback** — a deliberately bad candidate must automatically revert to the last known-good build.
10. **Spend guard** — runaway loops and oversized simulations must terminate at configured budgets.
11. **Evidence** — every successful claim must point to a run receipt with build, inputs, outputs, checks and timestamps.
12. **Negative tests** — unsafe prompts must be rejected without weakening policy.
13. **Dependency/security scan** — critical findings block promotion.
14. **Retention** — expired environments/data are automatically removed according to policy.
15. **Recovery** — loss of a worker or provider emulator must be recoverable without corrupting the evidence chain.

Continuous evolution may create candidate changes automatically, but only a candidate passing every applicable gate can be promoted.
