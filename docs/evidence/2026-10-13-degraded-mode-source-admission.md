# Degraded-mode readiness source admission — 2026-10-13

## Requirement and ownership

The `degraded-mode-readiness` row in `release/research-convergence-ledger.json` derives from Frontier PR #212. It proposes advisory, shift-specific workforce readiness for **independently approved** OT degraded/manual modes, using the existing resilience and implementation authorities. PR #212 is a historical isolated prototype. At selection, the open-PR search for `degraded`, local worktrees and remote branches found no active row-specific convergence writer; PR #377 separately owns asset schema admission and remains a dependency. This package owns only the row's theory/source admission evidence. It does not take the canonical integration or release lease.

Exact candidate base: `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`. Prototype under test: PR #212 head `edf17bfa4c089022348b024f843c89172d47b6f2`. Candidate changed files: this evidence and `release/research-convergence-ledger.json`. No prototype or production engine is copied into the candidate.

## Result

The historical algorithm's original 5 tests pass and its deterministic simulation reproduces 361 scenarios, with the risk-weighted option better than rarity-only in 67.867% and median modelled reductions of 92.345% versus 5.418%. The historical rarity-only comparator omits shift filtering in its site-level count and omits both site and shift filtering when choosing a worker. These percentages therefore mix ranking quality with a broken comparator scope; they are neither a clean algorithm comparison nor value evidence. The synthetic simulation creates its own `degradedModeApproved`, qualifications, shifts and risk values. No existing current candidate source binds these assertions to an OT engineering approval, effective competency verification, unique workers, asset identity, tenant, or independently governed risk value. The implementation Digital Twin has generic `competency` nodes but no admitted asset/manual-mode approval type. The current resilience failure-scenario contract handles safe containment and recovery, not an authority to enable machine operation. PR #377's asset schema work must be reconciled first.

Direct adversarial replays against the PR #212 module produced:

| Input mutation | Actual result | Required admission result |
| --- | --- | --- |
| Duplicate the same `p1` on one shift with `minimumOperators: 2` | `covered`, coverage 2 | Reject duplicate person identity; one human counts once |
| Set `degradedModeApproved: true` and `approvalRef: 'caller-asserted'` | Asset evaluated as eligible for manual-mode workforce coverage | Require independently verified, current, site/asset/mode-bound engineering approval; do not trust the boolean or free-text ref |
| Give an unqualified worker `eligibleTraining: ['manual']`, budget 1 | `afterExposure: 0` and one recommendation | Recommendation may estimate a future option; it must not represent current qualified coverage without completed, verified competence |
| Repeat asset id `line` with conflicting competency | Two effects share `assetId: 'line'`; recommendation looks up first match | Reject conflicting duplicate asset identities before ranking |

The two source assertions and identity defects falsify safe production-readiness admission. No safe adapter can be claimed until authoritative inputs and time semantics exist. The design remains **DESIGNED**, theory `FAIL_SOURCE_ADMISSION`, implementation `QUEUED_BLOCKED`. The prototype's original safety statement remains valid as intent, but is not enforcement.

## Tests actually run

- In a detached PR #212 worktree at `edf17bfa`, `node --test test/frontier/degraded-mode-readiness.test.mjs`: **5 passed, 0 failed**.
- `node simulation/frontier/degraded-mode-simulation.mjs`: **361 non-trivial synthetic scenarios**; output figures above. Its `unsafeManualRecommendations: 0` field is a hard-coded literal, not a computed check, so it provides no safety proof. A fixed unit fixture separately checks one unapproved asset.
- `node --input-type=module` adversarial replay importing `src/frontier/degraded-mode-readiness.mjs`: **4 unsafe/ambiguous results observed** as tabulated above. This was an exploratory assertion check, not a passing regression suite.
- Candidate ledger validator and diff check are recorded in the PR review handoff after execution.

## Review, integration and proof

Independent read-only review found two ledger consistency issues (`QUEUED` implied ready implementation, and `evidenceRef` differed from other admission rows); both were corrected to `QUEUED_BLOCKED` and `evidence`. It also found scope errors in the comparator; the simulation claim above was narrowed accordingly. It found no remaining issue with the replay findings. Canonical integration: pending sole owner reconciliation with PR #377 and other ledger edits. Exact-candidate deployment: none. Hosted/customer proof: none. No real OT, personnel, payroll or customer operation was attempted.

Next action: the canonical owner and asset/integration owners should define provenance-bound tenant/site/asset/mode approval and competency evidence with validity windows; separate **current coverage** from **hypothetical training benefit**; then rerun normal, edge and adversarial theory tests and only then consider an advisory adapter within existing resilience and implementation paths.
