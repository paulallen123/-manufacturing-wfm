# CLEANROOM-N01: entry-only aggregate scope

The sealed implementation and test bytes remain unchanged. observedControlMinutes and observedControlCost aggregate entry transitions only. Entry and exit movement rows preserve their individual minutes and costs; an unknown exit cost remains null in its row and does not make the entry-only aggregate unknown. Unknown entry economics do make that aggregate unknown. For entry 3 minutes/5 cost and exit 2 minutes/7 cost, the aggregates are 3 minutes and 5 cost.

This preserves the explicit entry-only filter in both inherited transition ledgers: original Git blob 6231a401653d5f14410b20e29f5060b103954dcd and repair 95f92f92d2b3f3a447259810aae315193bc1945f. Independent review found no all-movement arithmetic defect and retains P3 CLEANROOM-N01 as a generic output scope documentation note. Any future caller or UI must make entry-only scope clear before admission.

These aggregates do not prove total movement time/cost, finances, realised savings, sterility, quality or customer readiness. This package contains only two source/test additions and coordination evidence. No new state/ledger/helper, runtime caller, provider or Staffology path is introduced. Null proven/convergence locks, runtime unwired and whole-runtime admission pending remain. No new tests were run while packaging.
