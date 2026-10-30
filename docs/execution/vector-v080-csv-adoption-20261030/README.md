# V079/V080 review CSV adoption

The report viewer previously downloaded raw formula-leading values, collapsed
null/empty and number/text distinctions, passed the row index as a flattening
prefix, and advertised Excel/PDF formats that it did not generate. Flat dotted
fields could also silently overwrite nested fields before export.

This isolated donor on PR545 `2d0f4e41e3b0463386b2887f39afa064068f9166`
adopts the existing independently reviewed CSV+multirow patch from
[#501 comment6512561286](https://github.com/paulallen123/-manufacturing-wfm/pull/501#issuecomment-6512561286)
once, then adds a separate fail-first duplicate projected-key guard. The
reviewed predecessor source SHA-256 is
`0eb8a9337ea00c133a7d9abf74057c74764212a04cf55c6d11fe270698b26f9b`.
The added guard refuses ambiguous flat/nested mappings regardless of insertion
order or equal values; it defines no precedence or source-key escaping policy.
The run failure path also clears cached source rows and columns so a later
recalculation cannot replay an earlier successful report after refusal. Ordinary
nested paths and own JSON special names retain the reviewed behavior.

The UI now labels its actions CSV review and Print. Every CSV header/cell is
type-tagged, quoted and ASCII-escaped; missing own cells and unsupported values
fail before Blob creation. It remains a browser-generated review representation,
not the canonical typed-interchange format or native typed spreadsheet cells.

## Verification

Node22.23.2, no skips:

- Unchanged baseline: original CSV author/reviewer expectations fail9/9.
  A combined preliminary baseline invocation also included5 mapping-fixture
  failures caused by its omitted legacy cell() collaborator; those5 are harness
  incompatibility and are not counted as reproduced product defects.
- Reviewed V080-only predecessor: mapping heldouts fail5/5 for the recorded
  callback/own-key/missing-cell behavior. Exact reviewed combined predecessor
  replays61/61 affected UI/CSV/mapping checks.
- New collision fixture on the reviewed combined predecessor:2/4 pass,2/4 fail.
  With the duplicate-key guard:4/4 pass. Independent review then found a cached
  prior-row replay via two successive runs and recalc(). A separate new heldout
  reproduced4/5 on initial donor8355f8ae; clearing baseRows/rows/columns on the
  existing run error path repairs it, yielding5/5.
- Final portable command: `node --test reporting/ui/*.test.cjs reporting/runtime/*.test.cjs`
  passes120/120, zero failures/skips. This includes the current UI/service/
  interchange suites, original CSV author/reviewer checks, reviewed mapping
  heldouts and the new run/error/CSV collision fixture.
- Parent independent reviewer initially reported114/114 plus5/5 mapping checks
  on Node22.23.2, then correctly reopened that verdict for the cached-row replay
  described above. Its separately authored replay heldout is RED0/1 on the
  published initial donor, GREEN1/1 with the cache clear, followed by independent
  final120/120, zero skips, and bounded diff acceptance. One
  external heldout invocation initially used its missing default baseline path;
  the reviewer corrected V080_SOURCE and did not count that harness failure as
  product evidence. This is technical review, not formal GitHub approval.
- Syntax and `git diff --check` pass. Raw command logs, including failures,
  are retained as reproducible gzip/base64 entries with raw byte hashes in
  raw-test-receipts.json. source-inventory.json identifies each proposed blob.

The two imported heldout files change only their default source path for
portable repository execution. The original published patch/test hashes were
matched before replay. The original special-key fixture's fourth test only
observed the old collision; it is not included as a passing integrity assertion.

This executor has no Chromium binary or Docker, and Playwright's expected
Chromium executable is absent. LibreOfficeDev26.8 alpha is installed, but the
offline namespace probe failed `Operation not permitted`; no reader was run.
Historical browser/reader results do not transfer as fresh checks of this donor.

## Existing owners and open contract

PR371 `f34464f3a713bab8c381260c27320c7042dcd192`, PR481
`e1ed2eae98d67a558f4a103259681c0f48a33837` and sole PR501
integration/release ownership are retained. Later V081 lifecycle/hidden-setting
and V079 saved-filter-refusal candidates are separate and are not bundled here.
This donor does not resolve the five unsupported saved-filter operators, version
semantics, current identity/site changes or all flattening/schema behavior.

No server export route or unwired sourceReader hook was added. The current
service authenticates immutable definitions; the browser separately fetches and
evaluates source rows. Its source catalog has field names and minimum roles but
no authoritative typed schema/units/currency, source snapshot revision/digest or
site-scope binding. The existing typed formatter requires those trusted inputs.
Reporting owners must select a governed source snapshot producer, typed schema
and current site/role authority, and define supported saved-control evaluation
before a server consumer can safely bind it. Browser rows/digests cannot supply
that authority.

No canonical adoption, freeze renewal, installed-image admission, authenticated
source/provider export, fresh-login export audit, deployment, native
XLSX/PDF/DOCX, customer acceptance or V080 completion is claimed.
