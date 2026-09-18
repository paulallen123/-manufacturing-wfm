# UX Cycle 10 Railway snapshot refresh — 18 Sep 2026

Purpose: create a harmless source change on the isolated Cycle 10 branch so Railway must resolve a new GitHub commit instead of reusing the previously observed stale snapshot.

Verified before this commit:
- `ux/planner-focus-20260917` contained `WFM_UX_RESET_CYCLE10` composition in `Dockerfile`.
- `ux-overlay/ux-reset-cycle10.js` existed on the branch.
- Railway deployments `d41cb593-4a80-4202-a1bc-049df7cba8e5` and `b61e5431-8dcb-4bfa-9c14-9365f4b7f6d3` both fetched stale snapshot `sha256:2097daa08008d29bccdba63aca15b3a5585c7074b1b5c029e87956c39a6276c1` and built only through Cycle 9.
- Both deployments passed `/api/health`; that health result is not accepted as Cycle 10 UX proof because Cycle 10 markers were absent.

This documentation-only commit does not change runtime logic, permissions, payroll, tenant controls, scheduling authority or customer-facing services. It exists solely to force a fresh source revision for the isolated UX proof lane.
