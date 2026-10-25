# Independent final review: disabled federated sign-in increment

Reviewer: `/root/build_route_review`; integration owner remains `/root`; existing PR501.

Verdict: acceptable to publish the reviewed source increment with Google and Apple unconfigured. This does not authorize provider activation, merge around required reviews, customer release, or reuse of the older installed-image admission for changed source.

I inspected the settled bootstrap, federation implementation, identity guard, sign-in asset order, composer and Docker gate. Bootstrap constructs the verifier synchronously before accepting requests. Absent provider configuration yields no providers and rejects start/callback; malformed critical configuration fails closed. The resource guard checks current mapping, local identity, role, tenant, epoch, policy, freeze, binding, metadata and verifier, rejecting mixed session classes. Provider claims never provision or link accounts by email. Callback state is browser-bound, expiring and durably consumed before the token exchange. Provider requests are fixed-origin, bounded and redirect-disabled; Apple incoming forms have a bounded body and deadline.

The corrected completion response is a first-party 200 HTML document with a fixed '/' link, no inline script or secrets, restrictive CSP and a Strict session cookie. This avoids relying on an immediate cross-site redirect chain for session continuation. Federated UI now reads invitation context before passkey UI strips it. Composer and Docker packaging include the new auth/UI module, and Docker's existing authentication gate now includes federation tests.

Independent verification: Node 22.23.2 sequential execution of federated-auth, federated-session-boundary and federated-ui suites completed exit 0: 36 tests passed, zero failed, skipped or cancelled. Exact TAP: independent-federated-final.tap. Also inspected the integration owner's completed 148/148 zero-skip TAP; that larger run was not independently rerun here. No provider traffic, credentials, deployment changes or remote jobs were used.

Remaining admission requirements: exact successor source/image build and existing release gates; secure provider registrations and approved fixed callback origin; deliberate provider subject-to-existing-local-user/tenant mappings; pre-existing tenant-control provisioning (missing control intentionally rejects login); trusted ingress that strips/sets forwarded transport headers; real browser Google GET and Apple form-post flows including the first-party Continue link, fresh login, revocation and invitation separation. Provider activation also requires operational handling of Apple client-secret expiry. These are activation/proof prerequisites, not evidence that the current disabled increment is live.

The proof-access preflight remains offline configuration validation only: it does not establish hosted reachability, issue access, verify provider identity or demonstrate customer proof.

Reviewed file identities are recorded in independent-federated-final-hashes.json. This is a bounded source/security review, not a formal GitHub approval or full penetration test.
