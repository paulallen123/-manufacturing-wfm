# Manufacturing WFM — isolated customer-proof staging transport

This private repository bootstraps the exact 0.6.76 hosted-staging customer-proof artifact into an isolated Railway service. The runtime is transported encrypted, verified by SHA-256 before and after decryption, and is not embedded in this repository. The application remains fixture/demo-data only, not production approved, and no genuine NetSuite/SAP/Oracle HCM provider acceptance is claimed.

The containment-locked engineering services are intentionally separate and are not modified by this staging lane. Existing repository resilience and OneDrive Sync Guardian assets are preserved.

## Developer and AI-agent quick start

Read [AGENTS.md](AGENTS.md) for the repository map and approval boundaries, then
follow [the onboarding pilot](docs/AGENT_ONBOARDING.md). With Node 22.23.2 active,
run `node scripts/agent-check.mjs` for fast local checks and
`node scripts/agent-check.mjs --full` for the complete existing local suite.
No dependency install or account credentials are needed for this check lane.
Local success does not authorize deployments or establish production approval.
