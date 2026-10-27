# Independent proof-wrapper repair review

Reviewer `/root/build_route_review`; integration owner `/root`. Verdict **ACCEPT** for the exact two-file local delta. Baseline source fetched independently at PR501 c60b2d97; source blobs3337ec236e64df9552f881fd5be40132f9794646 and e8c79eb3e51e50b5df156486c72921703e21efac verified.

The server change catches only construction/parsing of the request URL. Malformed targets receive generic JSON400 with no-store and return before state handling; input is not reflected. Proof outcome/state, asset binding, proof imports, readiness503 condition and PARTIAL semantics are untouched. Test changes expose the fixture port and add malformed-target survival coverage. No authority expansion or product-readiness claim was introduced.

Independent actual Node22.23.2 replay passed6/6 tests with0 failures/skips/cancellations: existing amended suite5 plus an additional heldout. The heldout sends four malformed absolute/network-path variants, including a credential-bearing invalid authority, to the actual wrapper HTTP process. All return generic400 without reflecting the credential marker; subsequent liveness remains200/PARTIAL, productReady=false and endToEndVerified=false. Readiness remains503 for /ready, query form and absolute-form /ready after every rejection. External network is blocked by the existing loopback-only fixture.

Scope: real local HTTP wrapper with synthetic imported proof evidence only. No actual browser journey, hosted runtime, provider action, credentials or customer proof. This is a bounded source review, not a formal GitHub approval or authorization to deploy. No remote mutation or deployment occurred. Source identities and evidence hashes recorded in hashes.json.
