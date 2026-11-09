# V123 independent review — 2026-10-30

Scope: isolated `DurableOutcomeLedger` candidate against PR #354 engine at `3e4c721307abec96a1830f1b5e9fbb44c5310873`. No canonical source, customer tenant, provider, or deployment writes.

- Supported Node 22.23.2: seven independently authored heldouts pass; combined existing donor, adapter, and heldouts pass 277/277 with zero skips, exit 0.
- Cross-process commit/reopen preserves outcomes and repeated-win candidate. Two handles deduplicate stable evidence; conflict rolls back. Accessor input is rejected without invoking its getter. Corrupt row fails closed. A writer killed after an uncommitted SQLite append leaves only the previously committed row. Changed learning threshold is refused on reopen.
- Original PR #354 engine failed the exact derived snapshot replay heldout (0/1) because evaluation and skill timestamps used current time. The bounded two-line candidate change uses the triggering receipt timestamp; the same heldout passes (1/1), and the combined 277/277 suite remains green.
- Final candidate SHA-256: engine `82a48bfbca0905ef542c7a2fb3e094786e43a23a3cd8d94a0be4d90a00a61a1f`; adapter `22e4b5f6276bbb8487f36a442ba9a314fae963cc1e6cd0d6b35ddc7206afc6a2`; independent heldouts `7654a320772943a868b54bcfa81962c82808ae3d1d4130d901f1cf646f964636`. The final exact bytes passed the combined 277/277 run again.

The builder normalized two terminal blank lines after review. The exact original local Git blob `620fbc1d3f4aaf9bc31559b70a28bb857ee1a138` matches PR #354, and the final patch `97d92dfe80f639eba5c1f1b329b7ce7f8344eb8067a7f235db9a30c4b73bdbbd` passes `git apply --check` on that base. SQLite volume custody, trusted evidence identity, authenticated tenant/source binding, current release integration, exact image and hosted proof remain separate. The test of a killed manual SQLite writer proves uncommitted rollback under this runtime; it is not a fault injection inside the adapter.
