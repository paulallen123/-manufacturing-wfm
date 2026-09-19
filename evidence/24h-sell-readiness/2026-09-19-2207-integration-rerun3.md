# Integration exact-gated release — third runner attempt

Candidate: `fce08f3018c73037ffff46b2d4e7c6c3d7d23085`

GitHub Actions run `35468957257` was explicitly rerun again after the exact-current one-day Railway deployment and five-role browser matrix had both reached `SUCCESS`.

The resulting release job was `105967329330`. It completed with conclusion `failure` and `steps=null`, i.e. no workflow step executed. This is consistent with the two immediately preceding attempts on the same run, which also failed before step execution. No Railway token, source upload, application build or provider call was reached.

The existing integration-service security hold remains intact and no attempt was made to weaken or bypass it. Sell-readiness therefore remains `CONDITIONAL` on exact integration deployment plus the separate authorised-provider and genuine zero-human provisioning gates.
