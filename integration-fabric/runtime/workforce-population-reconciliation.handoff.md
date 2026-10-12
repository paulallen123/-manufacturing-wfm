# Workforce population diagnostic handoff

Continue customer proof remains the only canonical execution owner. This is one
bounded prerequisite for the Friday 16 October 2026 customer proof, not completion
of the workforce fix, issue #256, release admission, or customer proof.

## Scope and source binding

- Repository: `paulallen123/-manufacturing-wfm`.
- Exact target base: `8632e5bb5c84e4fc258311d31d973714be169866`.
- Read requirement: https://github.com/paulallen123/-manufacturing-wfm/issues/256.
  It requires authorized canonical ingestion and truthful downstream evidence;
  fixture count equality or connection flags cannot establish readiness.
- The permitted GitHub recursive tree read at this base returned `truncated:false`.
  It proves the new module, test, and this handoff are absent. No `AGENTS.md` or
  `.agents/skills` paths exist in that tree. Local `/workspace/.agents` is empty.
- Read schema source at the exact base:
  `integration/runtime/autonomous-integration-hub.cjs`, Git blob
  `af327965343ce1f84e75111ac6bd8c92a2685433`.
  Lines 259–267 define canonical batches/people; 891–918 define employee keys
  and ordered record hashing; 930–934 define batch hashing.
- Canonical people fields are `batch_id`, `tenant`, `connection_id`,
  `employee_key`, `record_checksum`, `canonical_json`. Batch `id` joins
  `batch_id`; batch `mapping_version` and `batch_checksum` pin the import.
  The mapped identity is `employeeId`, with `employee_key = SHA256(trimmed ID)`.
- The provider/company scope is not present on canonical people rows. The owner
  must supply an independently authenticated namespace join; this module cannot
  infer it from a row, employee ID, display name, email, or connection flag.
- Git fetch failed with CONNECT HTTP 403. Local repository HEAD is
  `5ea6d4664e52348557e7e6284fe75a1c98d8a976`, and the requested base object is
  absent locally. This delivery is an isolated additive patch, not a complete
  checkout or a claim of repository-wide validation.

## Input/output contract

Named export: `reconcileWorkforcePopulation(input)` from the new `.mjs` file.
Synchronous, deterministic, no network, filesystem, database, provider, clock,
environment, or credential access; only Node's SHA-256 primitive is imported.
No identity bindings are generated or persisted. Tests supply synthetic edges.
Input is a JSON-shaped object; no class instances, getters, cyclic objects, or
executable values are supported. All IDs are nonempty trimmed strings, at most
256 characters. IDs are case sensitive; no name/email comparison occurs.

Required top-level fields:

- `namespace`: `{tenant, provider, company, connectionId}`. One authorized scope
  per call. Source identity keys in output are collision-safe JSON arrays of
  these four fields plus the employee key. Stage IDs are scoped by the output
  namespace; do not combine outputs across scopes by stage ID alone.
- `asOf`: explicit UTC ISO timestamp with milliseconds. No ambient current time.
- `current`: `{batchId, mappingVersion, batchChecksum, sourceRevision,
  onboardingRevision, onboardingChecksum, operatingRevision, operatingChecksum}`.
  Mapping version is a positive safe integer; checksums are lowercase SHA-256.
- `authority`: `{namespace, current, permission:'people.read', provenance}`.
- `source`: canonical table rows, each enriched with `namespace`.
  `canonical_json` is the original serialized canonical object, at most 64 KiB.
- `onboarding`, `operating`: each `{namespace, revision, checksum, provenance,
  ids:string[]}`. Checksum is SHA256 of JSON.stringify of a sorted copy of `ids`,
  retaining duplicates. The owner defines and authenticates extract revisions.
- `bindings`: independently supplied full triples `{id, namespace, current,
  employeeId, recordChecksum, onboardingId, operatingId, provenance}`.
- `exclusions`: `{id, namespace, current, population, memberId,
  reason:'excluded'|'former', provenance}`. Population is `source`, `onboarding`,
  or `operating`. Source memberId is employee_key. Exclusions apply only to the
  named population; they never fabricate a cross-population partition.

Every provenance object requires `{issuer, evidenceId, evidenceChecksum,
validFrom, validUntil}`. Validity is the half-open interval `[validFrom,validUntil)`
at `asOf`; dates use the same strict UTC format. Evidence IDs/checksums are
references, not credentials, signatures, verified receipts or generated authority.

Bounds: at most 500 rows/IDs per population and 1500 bindings/exclusions each.
Larger inputs are blocked rather than truncated. Do not split a whole workforce
into arbitrary chunks: the owner must define complete, independently authorized
partitions first or request a separately reviewed larger-bound implementation.

Output always has `kind:'workforce-population-diagnostic'`, `authoritative:false`,
and `authentication:'required-by-integrating-owner'`. Structural status is
`blocked` or `consistent-unverified`; there is no PASS/readiness/admission flag.

- `counts` reports scoped observed rows, distinct IDs, exclusions, bound and
  unbound members. Foreign rows are quarantined in `rejected`, not counted.
- `bindings` reports only supplied, structurally usable, unambiguous triples.
- `unbound` lists every scoped nonexcluded member without such a triple.
- `missing.onboarding/operating` lists expected source keys without a usable
  complete triple. Partial triples are unsupported and remain unresolved at
  both stages. These are missing *proven links*, not proof that people do not exist.
- `extra.onboarding/operating` lists stage IDs without such a source binding.
  “Extra” means unexplained membership; it does not authorize deletion or imply
  that the person is illegitimate.
- `duplicates`, `conflicting`, `rejected`, `excluded` and sorted `reasons` expose
  exact affected IDs, edge IDs, multiplicities and rejection categories.
  Duplicate members cannot bind. Every edge incident on a one-to-many or
  many-to-one ambiguous endpoint is withheld. Invalid evidence is not repaired.

Structural checks validate namespaces, current pin equality, evidence shape and
effective intervals, snapshot checksums, canonical employee keys, record checksums,
batch checksum, membership and edge uniqueness. Canonical checksum fields and
ordering match the existing hub. All array outputs use deterministic ordering;
input objects are neither modified nor retained in the result.

## Owner authentication and integration obligations

The owner must independently authenticate the source grant and its revocation
state, provider/company/tenant/connection relationship, complete current extracts,
revision pins, canonical mapping, provenance issuer and referenced evidence,
effective-dated exclusions, and each identity edge. Supplying matching objects or
`authorized:true` cannot perform those checks. The pure function cannot verify
signatures, revocation, completeness, or currentness against external systems.
Even fully fabricated but structurally consistent evidence remains unverified.

The reported 2 source / 4 onboarding / 42 operating identities is a user-supplied
owner readback, not a live observation made by this lane. The test reproduces only
its cardinalities with synthetic IDs and no edges: exactly 2/4/42 remain unbound.
The owner later supplies authoritative extracts and consumes diagnostics within
existing readiness checks. No existing controller or readiness integration is
changed by this patch. Authentication and all other issue #256 acceptance criteria
remain the owner's work, including restart/hosted exact-SHA customer proof.

## Validation and deliverables

Run `node --test integration-fabric/runtime/workforce-population-reconciliation.test.mjs`.
39 tests pass on Node `v24.19.0`. Node `22.23.2` was not installed in inspected
runtime locations; the requested Node 22 version and repository-wide/hosted tests
were not run. No packages were installed. Fixtures contain only synthetic IDs.

Coverage: complete fixture; 2/4/42; equal counts/different IDs; ignored names/emails;
tenant/provider/company/connection contamination; reused external IDs across
providers; stale batch/mapping/all revision pins and record checksums; missing,
future, expired or revoked authority; bad snapshots; duplicate members/edges;
one-to-many and many-to-one ambiguity; explicit former/excluded membership;
unknown IDs; malformed/bounded inputs; deterministic replay and frozen inputs.

Independent-review correction: exclusion `population` must be a primitive string
from the exact `source`/`onboarding`/`operating` enum before membership lookup.
The pre-fix regression reproduced a TypeError for `{toString:null}`. Arrays such
as `["source"]` are now rejected instead of coerced into a valid population.
Regression coverage includes 18 malformed population values, 10 malformed
exclusion entries, stable blocked diagnostics, input immutability and recursive
input/output object-reference separation for accepted bindings and exclusions.
The review bundle preserves the failing pre-fix TAP and the passing final TAP.

Second independent-review correction: canonical serialization is now guarded.
A valid JSON row under 65,536 characters with a 20,000-level nested `payRate`
array reproduced a RangeError in the original checksum serialization. Such
serialization failures now produce `invalid-source-batch-key-or-record-checksum`
and leave the source member unbound. Tests also cover deeply nested objects,
incomplete deep JSON, oversized rows, frozen inputs and stable blocked output.
Successful serialization retains exactly the hub's ordered field hashing; no
values are coerced, silently skipped or repaired. Serializable shallow structured
values retain the previous hashing behavior. The serialization depth supported
by the runtime is not a portable schema guarantee; the failure is contained.

The review bundle includes the exact three-file additive patch, source binding,
test TAP evidence and file SHA-256 manifest. Patch application and byte comparison
are checked in an empty temporary directory; application against a full exact-base
checkout remains for the owner. No pushes, merges, deployments, provider/database
writes, invitations, credentials, real identity bindings, or readiness admission
were performed.
