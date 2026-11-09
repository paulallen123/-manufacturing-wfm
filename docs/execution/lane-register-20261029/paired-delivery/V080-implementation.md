# V080 bounded CSV review candidate

Source: PR #501 head `61718e1862fa650136e1952f622c9d8dd4c22af8`,
`reporting/ui/vector-reporting-ui.js` Git blob
`1b4543a3b64ac0507684fc348cc91b7f0e5463a2`. The local baseline
matched that blob exactly.

The current UI labels a raw browser CSV as “CSV / Excel” and emits cells
directly from `cell(v)`, including leading formula characters, tab/control
prefixes, links, and unescaped Unicode control characters. It also collapses
null and empty values to a dash. The existing pure
`vector-report-interchange.cjs` module already has a tagged review CSV
representation, but the UI does not call it.

This narrow owner-ready patch tags and ASCII-escapes every browser CSV cell,
keeps null, empty, zero, false and leading-zero strings distinct, fails closed
on missing/unsupported values before download, and names the actual “CSV
review” and browser “Print” actions. It changes only one UI file. It does not
connect the authoritative typed formatter, add XLSX/PDF/DOCX, authenticate
an export, establish real spreadsheet round-trip, or prove a hosted flow.
The existing PR #501 UI/integration owner should adopt only after reviewing
the exact diff and full current-source tests.

Fail-first synthetic test on unchanged exact source: Node 22.23.2 exit 1,
0/4 pass, four reproduced expectations. Candidate, existing current UI test,
and independent heldouts on Node 22.23.2: exit 0, 56/56 pass, zero skips.
The new test executes
the shipped `csv()` function in a VM with a browser-shaped Blob/download
sink and asserts the exact bytes. It is a local isolated test, not hosted
browser or spreadsheet software evidence.

Independent reviewer initially found two defects: an inherited value could
fill a missing `__proto__` field, and zero exportable columns could produce
a blank download. The corrected candidate requires own inert data descriptors
for every exported cell and at least one column. Reviewer-heldouts were
red 0/5 on baseline, 3/5 on first candidate, and 5/5 on final; reviewer found
no remaining important issue within this bounded CSV scope.

Exact final candidate source SHA-256
`abdee8383e95e7c0d1201a91ed8484ca6a73d797f1af637e9a2f0980260d90af`.
Patch: `V080-reviewed.patch` SHA-256
`c55b07dfd4e4a88b597ea727ba9d541bab0d16ba73e5c5e6309816d2de0ad012`.
Author test SHA-256
`02121eba1702421c362596b9c515352778fb080283ef91d0543fdfc4b6510f9e`.
Reviewer test SHA-256
`33f6164f21f9029aa23ba850a9acfa4a1e2343b7df4d3e91650c098c4342d34b`.
Reviewer combined TAP SHA-256
`05e0a4d8b93a762cfd8bf659dbd5f6b946bc9ea07ef5d66744b888e6be881049`.
