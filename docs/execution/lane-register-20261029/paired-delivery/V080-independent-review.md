# V080 bounded CSV review

- Base: PR #501 `61718e1862fa650136e1952f622c9d8dd4c22af8`, `reporting/ui/vector-reporting-ui.js` Git blob `1b4543a3b64ac0507684fc348cc91b7f0e5463a2`.
- Candidate SHA-256: `abdee8383e95e7c0d1201a91ed8484ca6a73d797f1af637e9a2f0980260d90af`.
- Independent heldouts: `heldout.test.cjs` SHA-256 `33f6164f21f9029aa23ba850a9acfa4a1e2343b7df4d3e91650c098c4342d34b`. Exact baseline 0/5 (red); first candidate 3/5 (inherited `__proto__` and zero-column blank export); revised candidate 5/5.
- Supported Node v22.23.2, existing+author+independent tests: 56 passed, 0 failed, 0 skipped. Combined TAP SHA-256 `05e0a4d8b93a762cfd8bf659dbd5f6b946bc9ea07ef5d66744b888e6be881049`.
- Reviewed diff is confined to CSV/print labels and CSV serialization. It prefixes all emitted cells with inert type tags, JSON escapes text, rejects missing/inherited/accessor/non-finite values and empty columns before download. No important remaining finding within this bounded review.
- Limits: review-only CSV loses native spreadsheet types intentionally; no XLSX, PDF, DOCX, canonical adoption, browser spreadsheet import, hosted or customer proof. Full V080 stays open.
