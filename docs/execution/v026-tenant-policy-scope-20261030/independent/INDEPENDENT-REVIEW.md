# V026 independent review

Verdict: approve the bounded tenant-scope repair on exact PR #501 source. No remaining Critical or Important finding was identified in that slice. This is local independent review, not GitHub approval, canonical adoption, release admission, or V026 completion.

The V026 record requires ordered policy reconciliation retaining population/provenance guards, approved effective-dated customer policy evidence, and country/timezone/currency consumer proof. The candidate closes one concrete prerequisite: the graph ignored an explicitly supplied tenant scope, and preflight omitted its tenant when resolving each worker. Same site identifiers could therefore acquire another tenant's policy coverage. The candidate admits valid scalar/list tenant scopes, excludes missing/malformed/foreign context, forwards the preflight tenant, and rejects tenant identity coercion/truncation. Public rules without a tenant scope remain public. Execution and customer mutation authority remain false.

Exact baseline source is `61718e1862fa650136e1952f622c9d8dd4c22af8`. All ten supplied baseline policy files independently matched the manifest's Git blobs and SHA-256 hashes. Final reviewed bytes:

| File | SHA-256 |
| --- | --- |
| `jurisdiction-policy-graph.cjs` | `e5c80b05bff8231a2980b60b55bffa3c20751a55984ce15a9e1e17f3e082964c` |
| `global-site-policy-preflight.cjs` | `595da9692df35e389fb5581029131be3757d76e0ff73c69aec50a506f927f878` |
| `v026-tenant-policy-scope.test.cjs` | `b3652978342c2cb7e607bf4b4404ab2c94af8200e988cd1daaa7f62c378fe782` |

The patch SHA-256 is `73070fbb91fe474d1834885f914f681ab5d9c46223dab5ee2b480b6f5be341ec`. Independent application to a separate exact baseline succeeded and produced byte-identical candidate files.

| Independent execution on Node v22.23.2 | Result |
| --- | --- |
| Heldouts against exact baseline | 3 pass, 12 fail; exit 1 |
| Same heldouts against final candidate | 15 pass, 0 fail/skip; exit 0 |
| Complete candidate policy suite | 29 pass, 0 fail/skip; exit 0 |
| Same heldouts against independently replayed patch | 15 pass, 0 fail/skip; exit 0 |
| Existing calendar consumer regressions | 3 pass, 0 fail/skip; exit 0 |

Heldouts cover tenant and site isolation, missing/non-string contexts, malformed and disappearing serialized tenant scopes, scalar/list exact matching, public/private composition, preflight forwarding and identity aliasing, legal/knowledge boundaries, missing policy fail-closed, caller-input preservation, raw currency-bearing values, and JSON round trips. Review caught an explicit `tenant: undefined` scope becoming global after JSON normalization; the corrected candidate rejects it. The superseded-candidate red transcript remains separate from final acceptance evidence.

Calendar tests use independently fetched exact-commit `operations/runtime/tenant-calendar.cjs`, whose bytes match the existing source fixture. They cover London spring gap/autumn repeated-hour instants and Kolkata fractional-hour date rollover. They are unchanged-consumer regression evidence; they do not establish a new site-policy configuration bridge. Currency tests preserve synthetic JPY/KWD/EUR values across tenant/site boundaries; they establish neither FX conversion nor payroll/legal authenticity. Existing country-code truncation and full country configuration are outside this repair.

Concrete integration limit: freshly read donor #436 head `c92d1321f1f88c6300b8600522dca06a078a9f7c` retains #385 population validation and #395 recursive provenance freezing. The V026 patch does not apply directly to either donor module because the contexts overlap. The canonical owner must reconcile the tenant additions while preserving those guards; replacing those files wholesale with this #501-based candidate would remove them. The isolated overlap check is recorded in `donor436-patch-overlap.txt`; no donor, shared branch, or live state was changed. #435/#436/#429 isolated image receipts are not reassigned to these candidate bytes.

No Docker build, installed-image admission, legal-source authentication, provider acceptance, durable hosted workflow, fresh-login readback, deployment, or customer-readiness proof was performed by this review. Qualified customer policy evidence and the accepted ordered integration stack remain necessary.
