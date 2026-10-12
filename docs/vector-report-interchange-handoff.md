# VECTOR typed interchange — isolated owner handoff

Continue customer proof remains the sole canonical execution owner. This is one
additive pure reporting unit for review toward Friday 16 October 2026; it does
not establish customer readiness or authorise release.

## Source and file scope

- Repository: `paulallen123/-manufacturing-wfm`.
- Exact base: `8632e5bb5c84e4fc258311d31d973714be169866`.
- Exact tree: `8f46735489ecfde8ccf38722646df361f532dd02`.
- Contract read before design: [issue 265 comment 6111083929](https://github.com/paulallen123/-manufacturing-wfm/issues/265#issuecomment-6111083929).
- GitHub authorised read-only connector returned the exact commit/tree. The full
  recursive tree was not truncated: 1,321 entries, including 1,187 blobs.
  Every directory tree hash was reconstructed locally and matched, including
  the root. Both new runtime paths and this handoff path are absent at that base.
- Relevant contents recovered and verified using Git blob SHA-1 framing:
  `README.md` (`45695a24746988769ccf442ead1bc1c514fccc83`),
  `reporting/ui/vector-reporting-ui.js` (`68be68bca1503f476eceab96ebf2e77ff40c862d`),
  `reporting/runtime/vector-reporting-service.cjs` (`5d1c528fd13c41a4c83b04e0ada3b96cb590ad8b`),
  and its test (`804cd161e6ed27c84917ed354e4ab963bcd77365`).
- No tracked `AGENTS.md` or `.agents/skills` exists in that complete tree.
  No applicable local `AGENTS.md` was found; mounted `/workspace/.agents` is empty.
  The exact README's isolated fixture/customer-proof boundary was inspected.
- The original local checkout is at `5ea6d4664e52348557e7e6284fe75a1c98d8a976`
  and lacks the requested commit. It was left unchanged. No Git fetch was
  attempted or denied transport retried. Work used a separate relevant-source
  snapshot, not stale main. This is not a full recovered checkout or full-app test.

Only these additions are proposed:

1. `reporting/runtime/vector-report-interchange.cjs`
2. `reporting/runtime/vector-report-interchange.test.cjs`
3. `docs/vector-report-interchange-handoff.md`

No service, UI, bootstrap, Docker, core, controller or onboarding file is edited.
No push, merge, deployment, hosted-data mutation, provider call, credential
creation, report transmission, or external message was performed. The Library
review document contains code and synthetic-test evidence, not customer exports.

## Interface

`formatInterchange(input, expectedIdentity)` returns
`{canonical, envelope: {payload, payloadDigest}, display}`.
`parseCanonical(canonical, expectedIdentity)` returns the verified typed payload
or throws. Both are synchronous, deterministic and use only `node:crypto`.
The parser accepts the exact canonical JSON byte representation, not general
JSON and not CSV. JSON duplicate keys and alternate encodings are rejected.

All input keys are required; unknown keys fail closed:

| Key | Contract |
| --- | --- |
| `purpose` | `machine-interchange` or `spreadsheet-display` |
| `consumerProfile` | Respectively `vector-json-v1` or `vector-csv-review-v1` |
| `identity` | `sourceId`, `reportId`, `sourceDigest`, `definitionDigest`, `scopeDigest` |
| `exportedAt` | Caller-supplied real UTC instant, exact `YYYY-MM-DDTHH:mm:ss.sssZ` |
| `context` | Explicit `locale`, `decimalSeparator`, `grouping`, `timeZone`, `dstPolicy` |
| `columns` | Ordered array of explicit typed columns |
| `rows` | Ordered dense arrays; each row exactly matches column count |

`expectedIdentity` must independently come from the owner's trusted binding.
All three digest values are lowercase 64-hex SHA-256 strings. `sourceDigest` is
the owner's authoritative source identity/content digest, not a 40-hex Git SHA-1.
`definitionDigest` is copied unchanged from the reporting service; this module
never recalculates or replaces it. `scopeDigest` is an opaque commitment to
already-authenticated tenant/role/scope. Comparing it does not authenticate a
caller, grant access or prove that the supplied rows belong to that scope.

Each column has exactly `{id, header, type, nullable, unit, currency, scale}`.
IDs and headers use a limited ASCII label grammar; duplicate IDs and headers
(case-insensitive, ignoring surrounding whitespace) are rejected. Type rules:

| Type | Value and context |
| --- | --- |
| `text` | Well-formed Unicode string, including empty string; no normalization |
| `identifier` | String starting with ASCII alphanumeric, then alphanumeric or `._:-`; never numeric coercion |
| `boolean` | Actual boolean |
| `integer` | Safe integer, excluding negative zero; explicit unit |
| `decimal` | Exact base-10 string with dot and fixed declared scale 0–18; explicit unit |
| `date` | Valid Gregorian `YYYY-MM-DD`, year 0001–9999; no timezone conversion |
| `instant` | Valid millisecond UTC `YYYY-MM-DDTHH:mm:ss.sssZ` |

Every column explicitly allows or forbids null. Non-numeric units and non-decimal
scale/currency must be null. Currency decimals use unit `currency` and an explicit
three-uppercase-letter currency code; the owner validates the actual code and
economic meaning. No payroll, employee identity or quantity semantics are inferred.

Supported context is deliberately narrow: `en-GB` with `.` or `de-DE` with `,`,
`grouping: 'none'`, `timeZone: 'UTC'`, `dstPolicy: 'not-applicable-utc'`.
Canonical decimals always retain dot notation and exact precision. Naive local
times, offsets, local timezone/DST policies, decimal grouping, inferred types,
objects, unsafe numbers, sparse arrays, getters and unknown consumers fail closed.
Limits: 100 columns, 10,000 rows, 65,536 UTF-16 units per string, nesting 12,
200,000 visited values and 8 MiB string bytes per input copy, 8 MiB canonical UTF-8. JavaScript proxies
are outside the trusted in-process API boundary; untrusted external data must
arrive as inert JSON and still pass owner authentication and this validation.

## Integrity and representations

The payload records row/column counts, ordered rows/columns, schema/context hash
and row hash. The envelope adds a payload hash. SHA-256 inputs are UTF-8 sorted-key
JSON prefixed by `VECTOR_REPORT_INTERCHANGE_V1:<domain>\n`; domains are `schema`,
`rows`, `payload` and `display`. Array order and Unicode code units are retained.
These are deterministic integrity checks, not signatures or permission tokens.
An attacker who can replace all bytes and recompute hashes needs a separate
trusted artifact digest/signature check from the owner. Source hashes cannot be
verified against actual source content by this formatter; only binding is checked.

`vector-json-v1` is the local data-only canonical parser contract. Successful
parsing and reformatting is the typed round-trip result; mismatches throw.

`vector-csv-review-v1` is a deliberately encoded review representation, not a
validated Excel, Sheets or LibreOffice product profile. Every header/cell begins
with an ASCII type tag (for example `text:"00123"`, `null:null`, `boolean:false`).
JSON escapes controls and quotes; all non-ASCII UTF-16 code units are escaped,
including bidi characters. CSV then quotes every field, doubles embedded quotes
and terminates records with CRLF. Decimal display uses the declared separator.
The display result declares `typedRoundTrip:false`, its own digest and
`formulaDisposition: all-cells-tagged-and-escaped; external-consumers-unproven`.
There is no apostrophe heuristic, raw-value CSV mode or CSV import API.

CSV alone omits the authoritative typed schema/context/provenance and is never a
complete typed interchange package. Keep canonical JSON alongside it. Opening,
editing or re-saving a CSV cannot authorise import or downstream writes. All
actual spreadsheet product profiles are unsupported and fail closed. This
revision's local profile support does not satisfy actual spreadsheet acceptance.

## Validation and remaining gates

Actual runtime: Node **v24.19.0**. The other installed Node was v24.21.0;
canonical **v22.23.2 was unavailable** and was not downloaded or run.
Thirteen test groups pass, including formula prefixes with 14 leading-character
variants, links/multiline text, CSV quotes/CRLF, Unicode/bidi, long and leading-zero
IDs, date/scientific/fraction-like strings, null/empty/zero/false/dashes, decimal
locale, invalid and DST-ambiguous times, unsupported data/schema/consumers,
identity mismatch, altered order/count/digests and exact canonical round-trip.
Independent review identified a P2 resource-boundary defect: a 34-column,
5,706-row input at exactly 200,000 nodes formatted but its 200,007-node envelope
failed parsing. Reproduced before correction. The parser now allows precisely
seven fixed envelope/metadata nodes in its outer traversal and separately
rechecks the extracted input against the formatter's 200,000-node cap. Existing
byte, depth, array and string limits remain. Regression tests prove exact-limit
format/parse/reformat and reject exactly 200,001 input / 200,008 envelope nodes
with the resource-limit error before row-width or digest checks.
A second independently reproduced P2 allowed IDs `value` and `VALUE`, or `value`
and `value `, when headers differed. IDs now use the same trimmed,
case-insensitive duplicate check as headers; accepted IDs remain unchanged in
the payload. Separate formatter/parser regression cases use distinct headers
and assert the duplicate-schema error for case, trailing-space and combined
collisions. Both findings were against the original review patch SHA-256
`95279b89881af69f9156e1d117a8b2e474cda894307425a8dcbab35d851a6d22`.

Commands run from the isolated proposal root:

```sh
node --test reporting/runtime/vector-report-interchange.test.cjs
node --permission --allow-fs-read=/workspace/vector-interchange --test-isolation=none --test --test-reporter=tap reporting/runtime/vector-report-interchange.test.cjs
```

Both corrected runs: 13 passed, 0 failed, 0 skipped. The permission-constrained run granted
only filesystem reads for the test tree, with filesystem writes and process
launch blocked. Node 24's permission model does not enforce a network boundary;
source inspection shows only the crypto dependency and no network/database/provider
calls or file I/O in the module. No such side effects were attempted. Test evidence is
synthetic. Existing service/application tests were not run on this partial snapshot.

Owner integration remains required:

- Supply authoritative typed schemas rather than infer them from service field
  arrays or UI-converted values. Keep the existing definition digest immutable.
- Authenticate tenant/role, apply catalog/column permissions and authorised row
  selection before calling; supply independent identity/scope bindings. Test real
  cross-tenant and cross-role denials in the owning service (not simulated auth here).
- Bind the actual artifact, deployment/config, schema, tenant/run/scope and export
  timestamp to trusted proof; add artifact authenticity if needed.
- Wire UI purpose labels and representation warnings through the canonical owner.
  The current UI's `cell()`/CSV path is unchanged and does not call this module.
- Rerun on Node 22.23.2 and run owner integration/regression checks at the exact
  accepted source. Prove each nominated spreadsheet version/import workflow,
  including formula execution, hyperlinks, coercion, open/re-save and locale
  behaviour, before enabling a product-specific profile.
- Hosted export, customer/provider acceptance, governance/release approval and
  the Friday customer-proof target remain unproven. No local test substitutes
  for those gates. Measured customer benefit remains zero.
