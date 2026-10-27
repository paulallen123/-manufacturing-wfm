# Independent runner-package review

Reviewer: `/root/runner_package_review`. Existing PR501, target product source `4ed5eb3668452a0229469b8e1d426e84eea18187`. Read-only review of deployment preparation; no Railway/GitHub mutation, secret read, network install, hosted browser action or provider/customer action.

## Result

ACCEPT for exact-byte deployment preparation. The one review finding is resolved: npm spawnSync now uses killSignal:'SIGKILL' with its120000ms timeout. Parent also made generator defaults portable; both changes were independently re-read and regenerated. No known blocking issue remains in this bounded preparation scope.

Independent held-outs: **5/5 passed**, Node22.23.2. Separate replay of launcher and canonical authentication/wrapper tests: **49/49 passed**, zero skipped. After the final timeout hardening, the exact final launcher plus independent held-outs replayed **17/17**, zero skipped. Counts overlap; do not add them as distinct product scenarios.

Verified:

- The bundle's four files independently match the Git blob IDs and SHA256 values in the existing exact4ed5 source manifest.
- Regeneration from canonical source gives the exact same bundle, command and manifest. Shell command is58624 bytes, with properly escaped literal source; running it with missing bindings fails before npm/materialization. No source-fetch token is embedded or needed.
- All files are validated before materialization, exact paths only, unique temporary directory0700, files0600, exclusive writes. No tar extraction or path traversal exists. Bundle and per-file integrity checks both hold; outer-hash recomputation cannot admit altered canonical source.
- Exact existing runner/environment/isolated origin/source are required. Signed profile and both strict proof flags cannot silently downgrade. Presence checks do not replace canonical actor/signer/tenant/run/configuration validation.
- A mock npm installer produces an offline fake Playwright package only for process tests. The actual canonical wrapper then rejects invalid asset digests before any fetch/browser action; exit1 propagates and temporary files are removed. The synthetic private sentinel never appears in captured output.
- SIGTERM reaches an actual running canonical wrapper child; parent exits143 and cleans temporary files. This test uses no browser or network.
- Existing canonical tests demonstrate signed auth is PARTIAL, business checks remain false and `/ready` stays503; the launcher does not rewrite this result or launch the obsolete second child.

## Remaining activation gates

No actual npm registry install, preinstalled Chromium compatibility, Railway acceptance of the58KB start command, runtime Node capability, protected signer/public-key match, persisted five actors, tenant/run/configuration, artifact asset binding or hosted navigation has been proven here. Existing service image and dependencies must be observed during normal authorized activation. Prepared command source integrity is separate from installed package/artifact provenance.

The package is not a replacement for the pending target startup repair. Do not apply it before a healthy exact-source isolated target and real bindings exist. Keep the old saved configuration available for rollback, and inspect environment-wide staged changes before any apply. No new service/controller/release lane is justified.

Signed screenshots/traces remain a separate retained-evidence gap. This review does not authorize customer/provider mutations, constitute a formal GitHub approval, or establish customer proof.

## Evidence

`heldouts.cjs`, `heldouts.tap`, `replay.tap`, `final-replay.tap`, `initial-hashes.json`, and `hashes.json` in this directory. The original author fixture-expectation failure is retained outside this directory. Reviewed bundle SHA256566398246bd2bcc7424feee7e27bb58bff1102355aab46950b1aec104b8d0d08; final reviewed command SHA256b0de6370ab3cc2186a0043f7ad85890909d0358f85d792ec831871b919f0083f (includes trailing newline). Final deterministic regeneration passed.
