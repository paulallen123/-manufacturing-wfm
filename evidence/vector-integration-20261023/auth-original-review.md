# PR364 independent review

Candidate base: 4b79aeec360d64a54b732ac38dc38763163b7e0a. Donor: 91da2d752f599f4c2d357ba6cedfea2ddf4d6f2f. No remote writes or product edits.

Disposition: ADOPT as a bounded ambiguity rejection repair at the next authorized integration gate, not release approval. Source delta uses all matching normalized-email rows, rejects zero/multiple rows before nonce/session writes, retains signature validation and atomic session/audit mint. No other source difference versus current candidate. Existing test adds one cross-tenant case-variant regression.

Node22.23.2 results: red.tap 8 pass/1 fail (baseline incorrectly returns200 instead409); green.tap9/9; edges.tap11/11 includes two independent same-tenant ambiguity cases with normal and failed rejection auditing. Neither rejection creates sessions, proof sessions, nonces or cookies. Secondary audit failure cannot turn rejection into issuance.

Git blob hashes: base source0165b9a5207eeb870e2690c4da6456ec8457db7e; donor source fbc0b6b974bb98821294de3ff456376c4385d73e; donor test98f3e63ff4745c279867225df2b68155f19088eb.

Two unchanged test dependencies were fetched from exact candidate: identity-survival-guard.cjs and passkey-schema.cjs. Early dependency-load failures were setup limitations, not defect RED evidence; final red.tap records actual reproduced assertion.

Limits: matches retain existing SQLite lower(email) semantics; no expanded Unicode normalization claim. User lookup remains before BEGIN IMMEDIATE, so concurrent identity changes between lookup and issuance are not newly addressed. No hosted proof, real identity, credentials or customer data used. Candidate branch and running CI left unchanged.
