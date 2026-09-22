# Datadog UK1 ChatGPT Bridge

Read-only MCP bridge for Datadog UK1.

Security:
- Hard-pinned to https://api.uk1.datadoghq.com
- Exposes no Datadog write tools
- /mcp requires BRIDGE_TOKEN
- Datadog credentials exist only in Railway variables
- /health never returns secrets

Railway variables:
- DD_API_KEY
- DD_APP_KEY
- BRIDGE_TOKEN
- PORT=3000

Recommended Datadog application-key permissions:
logs_read_data, apm_read, rum_apps_read, events_read, timeseries_query,
monitors_read, dashboards_read, incident_read.

MCP endpoint:
https://<railway-domain>/mcp

This directory is deployment-only and does not modify the production WFM runtime.
