# Isolated lane03 authority-helper port

Work baseline: frozen `f32ca1a2672d47dcff8ef6cd1c3d71c77cf60560`. `provenBaseSha=null`; `convergenceBaseSha=null`. No frozen or Staffology review source is edited. Nothing is published, deployed, wired into provider calls, or granted authority.

Select only the 25 missing `integration-fabric/runtime/` authority helpers and their existing meaningful adversarial test pairs from PR194 exact head `70f0657a018b3d33763bd8ad873bb4c1187eb5ff`. Preserve source bytes and modes. Reuse frozen canonical modules for dependency closure; never replace the 16 shared helpers already byte-identical in freeze. Catalogue promotions and provider requests are outside this port.

Establish baseline provenance using the verified local review snapshot, exact Git blob identities, and GitHub's f32-to-935 compare proving no integration-fabric changes. Record every baseline/support and added path/hash/mode. Inspect all helper/test imports and matching overlapping source identities before selection.

Materialize tests first and record baseline missing-module admission failures honestly; those are feature-availability evidence, not claimed behavioural reds. This is an authorised reuse port of existing tested implementations, not new implementation. Copy selected implementation bytes only after tests and dependency review. Run the meaningful existing tests, then the complete isolated fabric runtime test suite and fabric validation/conformance with official Node22.23.2. Any source/test/API incompatibility must be reported or repaired only after a meaningful failing regression; no authority weakening or invented store.

Deliver exact local port manifest, source blob identities, raw test logs and counts, and independent-review requirements. Keep all shipping paths confined to these 25 helper/test pairs; provenance/support files are isolated under this workspace and not part of the shipping delta. Hosted/customer/provider proof and promotion remain root-owned and withheld.
