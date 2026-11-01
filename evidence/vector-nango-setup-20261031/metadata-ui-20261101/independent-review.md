# Independent review: provider metadata field checks

Date: 2026-11-01 UTC  
Reviewer: `/root/nango_release_reconcile`  
Repository: `paulallen123/-manufacturing-wfm`

## Decision

**ACCEPT the frozen eight-path source increment for the existing draft PR #569.** No blocking finding remains within the reviewed scope. Acceptance is subject to the exact source and publication conditions below. It is not canonical adoption, freeze authority, deployment approval, a verified provider connection, or live-sync proof.

The sole writer's candidate is based on donor `cbc5bce85e8a380e89d3b1e670e86a73a50890c2`, with canonical checkpoint `ca6e36b4efd1099b56250fb790943db4b533fee5`. The writer froze source at `2026-11-01T20:47:12.295887+00:00`. This reviewer did not edit product source or perform any external mutation.

## Accepted source identities

All eight candidate Git blobs, SHA-256 digests and byte counts were independently computed and matched the frozen manifest. The five modified-file baseline blobs also matched the exact GitHub donor source previously read by this reviewer. Full SHA-256 identities and raw reviewer outputs are in `independent-review-receipt.json`.

| Path | Accepted Git blob |
| --- | --- |
| `integration/runtime/provider-metadata-review.cjs` | `c8b090d375e81ef420d63d8416d942d252e2a9c3` |
| `integration/runtime/provider-metadata-review.test.cjs` | `c3027be271364deb46a94ade2f212e1a9d2d5f21` |
| `ux-overlay/vector-shell.js` | `3941e00ec1de7a6055ed8cae226ae26633cd8bd9` |
| `ux-overlay/vector-provider-metadata.test.cjs` | `40501fde62775c22eb5bfd0d6fc5203d2163c260` |
| `scripts/compose-vector-local-runtime.mjs` | `65f9f66e684bc23fcb00d97e54fd97a1b39e691e` |
| `scripts/nango-metadata-wiring.test.cjs` | `b07fbf779c0157ba0c55ecd9ec4329b348903f4d` |
| `Dockerfile` | `96bf2c732ba09a9dcfaadf7a37dbd424c0dd0699` |
| `scripts/run-forge-ci.mjs` | `2d66aee046d62ea140098401e3aeae3ac3430fbd` |

The accepted shell SHA-256 is `149f8d49f417c3f43aa2cb6656ec0dd8d6886b9e5c9fbc67a4da032b11e3f774`.

## Authority, privacy, and behavior

The existing session actor is resolved from server-side session/user records. The existing integrations report requires `company.configure`; the preview route independently requires the same permission. The new status helper adds an explicit server-side projection of profiles owned by that actor's tenant. It reports `configured` from the projected rows, returns only profile ID/provider/system plus fixed presentation flags, and omits foreign tenants and raw configuration. It does not read credentials or invoke collection. A tenant with no owned profiles receives the same projected status whether foreign profiles exist or not.

The preview handler remains byte-for-byte unchanged. It accepts only `profileId`, checks tenant ownership before permit/credential work, consumes the existing signed permit before provider access, and returns a review-only result. The UI uses this exact endpoint and does not introduce configuration, credential, URL, query, tenant, or permit inputs. Entry and refresh perform status reads; collection requires an explicit action. No connector activation, payroll action, import, Nango scope, or live-connected flag is introduced.

The new panel requires `F.ready === true`, a current `F.actor`, tenant/account identity, configure permission, and the existing Integrations route. It does not fall back to legacy `me()`/`data` authority. Its lifetime is bound to actor, tenant, role, permissions, root, route and attached card. Requests use same-origin credentials and no-store behavior. A bounded escaped field summary is displayed only for the expected profile/provider/system and a fresh review-only metadata response. Raw metadata payloads, credential fields and review seals are not rendered.

## Review findings resolved before freeze

Two lifecycle problems were reproduced on intermediate shell SHA-256 `4689e8726546a0374bd726b14f0ed594b38753548643d71cb7506bb089814b6b`:

1. After one profile succeeded, a current 401/403 from another left the first profile's fields and actions visible. The frozen code clears all cached profiles/results/actions and requires an explicit authorized status refresh before another preview.
2. A rejected transport after a tenant change left the stale card mounted and its request un-aborted. The frozen code invalidates and aborts stale rejected transport/JSON responses, while preserving a replacement tenant's current panel.

The initial author fake-DOM fixture also created click targets without attaching them to its child tree; the writer corrected this so the real containment guard and action handler execute. A reviewer harness initially omitted `queueMicrotask`; that fixture error was corrected before the product findings were reproduced. These harness failures are not product-test counts.

## Independent verification

Node.js `v24.22.1`. The reviewer executed **5/5 held-out test groups**, exit 0, zero failures/skips, from `independent-heldouts.cjs`:

- Foreign configuration and unused secret-bearing fields are not inspected or exposed; empty-tenant status does not reveal foreign profiles; projections do not retain mutable source aliases.
- Current 401 and 403 clear every cached result/action; explicit status recovery performs no automatic collection.
- Transport rejection after tenant or readiness change removes and aborts the stale panel.
- JSON consumption rejection after actor change also removes and aborts the stale panel.
- An obsolete authorization failure cannot clear or downgrade a newly mounted tenant's successful panel.

These are reviewer-authored cases using the author's corrected fake-DOM execution fixture, with the author's tests suppressed. The actual four-component composer bundle is evaluated. Test override environment variables were absent. This is synthetic client behavior, not native-browser, real-session, or provider proof.

The reviewer also executed the actual Forge dispatcher with only child-process execution stubbed: **all 19 prior commands are preserved in order, exactly two new suites are selected, and all six failure cases at the two new positions stop immediately without a success marker**. Existing loop, environment, current Node executable, and inherited-output behavior are preserved. The full 848-case suite was not repeated.

Independent byte checks restored the entire original shell after removing only the metadata block and its two lifecycle calls; restored the composer outside its metadata hook; restored Docker after removing the declared additive hooks; and restored Forge after removing the two entries. Twelve other recovered baseline paths, the Nango resolver and the sealed archive are unchanged. This preserves all old Gusto, Staffology and intake panel bodies, including their existing limitations.

The writer separately reports projection 5/5, composer-bundle UI 13/13, wiring 4/4, installed-helper 5/5 and installed six-component bundle UI 13/13, plus unchanged Gusto/Staffology/intake checks. Installed results replay the source cases. These are writer receipts, not additional executions claimed by this reviewer. The coordinator independently ran its affected verification. The author manifest and verification receipt contain their exact commands and source bindings.

## Status consumer and assembly review

All text members of the hash-verified sealed archive were scanned: `providerMetadataBroker` appears only in the server constructor, collection/revalidation calls and GET response. No archived browser asset reads the old status fields. Exact-donor adaptive-coach, implementation journey, shell, reporting, demand intelligence, realtime, workflow and kiosk source likewise contain no old-field references. The existing Staffology consumer reads its separate `.staffology` response. No known in-product HTTP consumer depends on the removed global/private fields; external API clients are outside this bounded audit. Private `broker.status()` remains unchanged.

Both composition paths retain the existing Nango hook, which now copies/imports the projection helper and wraps only the existing GET status field with the authenticated actor. Unique anchors and repeat-application refusal remain. Docker copies the helper before composition, tests its installed module, and selects the UI tests after final bundle composition/sanitation. The active UI remains the existing `vector-ui.js` entry point. No sealed archive is repackaged.

## Publication conditions and limits

Publish only to the existing #569 donor, using expected parent/head `cbc5bce85e8a380e89d3b1e670e86a73a50890c2` and `force=false`. Only the eight accepted source paths plus coordinator-owned non-secret docs/evidence may differ. Preserve these current baseline blobs:

- CircleCI configuration: `65f5647b94271f9bed8649aff9791b8d7e2273fa`.
- Freeze marker: `31981cef7e79ebf505b477316393995a4d442490`.
- Freeze gate: `b14ccaa1f3826a579b175e20010cd5dccb95437c`.
- Gate tests: `671792fa420d4dbe3ea03d47aefb92b75d0d77d1`.
- Nango resolver: `a5b1015c3462ba1221782ef32bfdae6b59623b77`.
- Sealed archive: `0c8bb0251d207ec0af0808dd2627360a946a2cb3`; SHA-256 `3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d`.

The marker must remain identical to the new commit's first parent, so this source increment must not create freeze admission. The coordinator must verify the actual remote tree, parent graph, expected old branch ref and protected blobs after publication. This review did not create a remote commit or approve canonical adoption.

No full composer/image build, new pinned Node 22 run, native-browser/accessibility check, hosted role workflow, real signed-permit lifecycle, security/recovery gate, live credentials or API request was performed by this reviewer. Provider account authorization, bindings, canonical admission and deployment remain separate prerequisites. No deployed field-check functionality or live connection is claimed.
