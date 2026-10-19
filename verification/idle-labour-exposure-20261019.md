# Bounded idle labour exposure review — 2026-10-19

Requirement: issue #202 lists idle labour among savings opportunities and asks for evidence, attribution, and prevention of double counting. This slice computes only potential surplus staffing time from a declared complete site staffing snapshot. It does not claim actual idle labour, payroll leakage, savings, productivity, or a recommendation to change a shift.

Ownership check: open PR searches for `idle labour`, `idle labour exposure`, `surplus worker`, and related training/scheduling work found no focused owner. Historical #75 uses idle labour as one input to material disruption economics; this assessor has a separate staffing-window contract. The release/integration owner remains canonical.

Contract: a caller supplies one tenant/site, an as-of instant, a bounded window, source name/revision/digest/observation time and a complete, contiguous set of distinct staffing intervals. Each interval gives aggregate assigned and required counts with an evidence reference. Counts are never converted into a worker score or identity. A gap, overlap, duplicate reference, invalid count, foreign scope, invalid time, future observation, or incomplete source fails closed. Output separates potential surplus from shortfall in worker-minutes.

Evidence boundary: source completeness and digest are caller declarations. `sourceAuthenticated: false` and `actionAuthority: false` remain explicit. Authoritative WFM and production-demand adapters, role/site authorization, source readback, exact merged image proof, and hosted synthetic verification are required before any operational use. No tenant write, payroll operation, schedule change, deploy or customer-ready claim is made by this package.

Local proof: TDD first failed on the missing module. Focused test covers positive, zero-surplus, and malformed/adversarial evidence. The final test and release state are recorded in the PR, because this file is not proof of a hosted release.
