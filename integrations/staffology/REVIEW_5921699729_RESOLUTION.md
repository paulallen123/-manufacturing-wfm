# Independent review 5921699729 — offline resolution

The eight synthetic regressions are executable in `review-5921699729-regressions.test.cjs`. The pre-fix implementation from commit `a223248` was materialized in a disposable directory with the unchanged adapter and the regression suite. It produced eight failures; the complete TAP output is retained in `evidence/review-5921699729-red.tap`. No network, credential, provider or payroll operation was used.

| Regression | Corrected invariant |
| --- | --- |
| R01 | Production authority/store binding uses the adapter's canonical `tenant`, `implementationRunId`, full `candidateSha`, `deploymentId`, `configurationId` and `employerId` fields. |
| R02 | The former alias binding is rejected and cannot bypass full source-commit validation. |
| R03 | Malformed or incomplete permits fail authority checks closed by returning `false`; they do not escape as parsing exceptions. |
| R04 | An uncertain row with a live lease cannot be stolen by a recovery worker. |
| R05 | The original complete baseline is immutable; a different second baseline is rejected. |
| R06 | An acknowledged receipt is immutable; a different receipt cannot overwrite it. |
| R07 | An acknowledged delivery cannot be downgraded back to uncertain. |
| R08 | The production coordinator accepts the exact binding contract already enforced by the adapter. |

The green suite must be run with supported Node 22:

```sh
node --test integrations/staffology/review-5921699729-regressions.test.cjs
```

This resolves offline source failures only. `activationAvailable` remains false, and the container build, deployment and live-payroll gates remain separate.
