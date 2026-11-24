# Working on VECTOR

## Customer feature delivery

Use the current `release/vector-customer-ready-candidate-20260925` release line as the base for customer features and integrations. Check the existing Linear lane and the [GitHub coordinator](https://github.com/paulallen123/-manufacturing-wfm/issues/527#customer-pilot-routing-for-all-new-vector-functionality) before starting work. Continue the assigned owner's pull request or hand the change to that owner.

The customer release destination is the Railway project `VECTOR Customer Pilot`, environment `customer-pilot`, service `vector-customer-pilot`. Confirm all three against the current release record before promotion. The previous reference service is for rehearsal. Keep Northstar isolated.

Run the relevant GitHub Actions checks on the reviewed source. The release owner promotes the same signed image digest that passed rehearsal. Link the commit, digest, pilot deployment and independent tenant-scoped workflow result in the existing lane. For integration changes, verify provider authorisation and readback for the intended tenant before recording a live connection.

A proof freeze applies to its identified build and run. Continue development and testing on other eligible work while that proof is in progress.
