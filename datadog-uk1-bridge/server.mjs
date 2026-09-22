import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import * as z from "zod/v4";
import { authChallenge, mountOAuth, oauthConfigured, verifyAccessToken } from "./oauth.mjs";

const PORT = Number(process.env.PORT || 3000);
const DD_BASE = "https://api.uk1.datadoghq.com";
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const env = (name) => String(process.env[name] || "").trim();
const configured = () => Boolean(env("DD_API_KEY") && env("DD_APP_KEY"));

function compact(v, depth = 0) {
  if (depth > 7) return "[max-depth]";
  if (typeof v === "string") return v.length > 5000 ? v.slice(0, 5000) + "...[truncated]" : v;
  if (Array.isArray(v)) return v.slice(0, 100).map((x) => compact(x, depth + 1));
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v).slice(0, 120)) out[k] = compact(val, depth + 1);
    return out;
  }
  return v;
}

function result(v, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(compact(v), null, 2) }],
    ...(isError ? { isError: true } : {})
  };
}

async function dd(path, opts = {}) {
  if (!configured()) throw new Error("Datadog credentials are not configured in Railway.");
  if (!path.startsWith("/api/")) throw new Error("Rejected path.");
  const url = new URL(DD_BASE + path);
  for (const [k, v] of Object.entries(opts.query || {})) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, String(item)));
    else url.searchParams.set(k, String(v));
  }

  const response = await fetch(url, {
    method: opts.method || "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "DD-API-KEY": env("DD_API_KEY"),
      "DD-APPLICATION-KEY": env("DD_APP_KEY"),
      "User-Agent": "datadog-uk1-chatgpt-bridge/1.0"
    },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    signal: AbortSignal.timeout(20000)
  });

  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }

  const payload = {
    ok: response.ok,
    status: response.status,
    rate_limit: {
      limit: response.headers.get("x-ratelimit-limit"),
      remaining: response.headers.get("x-ratelimit-remaining"),
      reset: response.headers.get("x-ratelimit-reset")
    },
    data
  };
  if (!response.ok) {
    const e = new Error("Datadog API returned HTTP " + response.status);
    e.payload = payload;
    throw e;
  }
  return payload;
}

async function run(fn) {
  try { return result(await fn()); }
  catch (e) { return result({ error: e.message || String(e), datadog: e.payload }, true); }
}

function serverFactory() {
  const server = new McpServer(
    { name: "datadog-uk1-readonly", version: "1.0.0" },
    {
      capabilities: { logging: {} },
      instructions: "Read-only Datadog UK1 observability access. No write or modify tools are exposed."
    }
  );

  server.registerTool("datadog_connection_status", {
    title: "Datadog UK1 connection status",
    description: "Check bridge configuration and validate the Datadog API key.",
    inputSchema: {},
    annotations
  }, async () => run(async () => {
    if (!configured()) return { bridge: "ok", site: "uk1.datadoghq.com", read_only: true, credentials_configured: false };
    return {
      bridge: "ok",
      site: "uk1.datadoghq.com",
      read_only: true,
      credentials_configured: true,
      validation: await dd("/api/v1/validate")
    };
  }));

  server.registerTool("search_logs", {
    title: "Search Datadog logs",
    description: "Search Datadog UK1 Logs Explorer. Read-only.",
    inputSchema: {
      query: z.string().default("*"),
      from: z.string().default("now-15m"),
      to: z.string().default("now"),
      limit: z.number().int().min(1).max(100).default(25),
      indexes: z.array(z.string()).optional()
    },
    annotations
  }, async ({ query, from, to, limit, indexes }) => run(() => dd("/api/v2/logs/events/search", {
    method: "POST",
    body: {
      filter: { query, from, to, ...(indexes && indexes.length ? { indexes } : {}) },
      options: { timezone: "GMT" },
      page: { limit },
      sort: "-timestamp"
    }
  })));

  server.registerTool("search_spans", {
    title: "Search Datadog APM spans",
    description: "Search Datadog UK1 APM spans/traces. Read-only.",
    inputSchema: {
      query: z.string().default("*"),
      from: z.string().default("now-15m"),
      to: z.string().default("now"),
      limit: z.number().int().min(1).max(100).default(25)
    },
    annotations
  }, async ({ query, from, to, limit }) => run(() => dd("/api/v2/spans/events/search", {
    method: "POST",
    body: {
      data: {
        attributes: {
          filter: { query, from, to },
          options: { timezone: "GMT" },
          page: { limit },
          sort: "-timestamp"
        },
        type: "search_request"
      }
    }
  })));

  server.registerTool("search_rum_events", {
    title: "Search Datadog RUM",
    description: "Search Datadog UK1 Real User Monitoring events. Read-only.",
    inputSchema: {
      query: z.string().default("*"),
      from: z.string().default("now-15m"),
      to: z.string().default("now"),
      limit: z.number().int().min(1).max(100).default(25)
    },
    annotations
  }, async ({ query, from, to, limit }) => run(() => dd("/api/v2/rum/events/search", {
    method: "POST",
    body: {
      filter: { query, from, to },
      options: { timezone: "GMT" },
      page: { limit },
      sort: "-timestamp"
    }
  })));

  server.registerTool("search_events", {
    title: "Search Datadog events",
    description: "Search Datadog UK1 Events Explorer for deployments, monitor events and operational changes. Read-only.",
    inputSchema: {
      query: z.string().default("*"),
      from: z.string().default("now-15m"),
      to: z.string().default("now"),
      limit: z.number().int().min(1).max(100).default(25)
    },
    annotations
  }, async ({ query, from, to, limit }) => run(() => dd("/api/v2/events/search", {
    method: "POST",
    body: {
      filter: { query, from, to },
      options: { timezone: "GMT" },
      page: { limit },
      sort: "-timestamp"
    }
  })));

  server.registerTool("query_metrics", {
    title: "Query Datadog metrics",
    description: "Query Datadog UK1 metric timeseries. Read-only.",
    inputSchema: {
      query: z.string(),
      from: z.number().int(),
      to: z.number().int()
    },
    annotations
  }, async ({ query, from, to }) => run(() => dd("/api/v1/query", { query: { query, from, to } })));

  server.registerTool("search_monitors", {
    title: "Search Datadog monitors",
    description: "Search Datadog UK1 monitors and states. Read-only.",
    inputSchema: {
      query: z.string().default(""),
      page: z.number().int().min(0).default(0),
      per_page: z.number().int().min(1).max(100).default(30)
    },
    annotations
  }, async ({ query, page, per_page }) => run(() => dd("/api/v1/monitor/search", {
    query: { query, page, per_page }
  })));

  server.registerTool("get_monitor", {
    title: "Get Datadog monitor",
    description: "Retrieve one Datadog UK1 monitor definition and state. Read-only.",
    inputSchema: { monitor_id: z.number().int().positive() },
    annotations
  }, async ({ monitor_id }) => run(() => dd("/api/v1/monitor/" + encodeURIComponent(monitor_id))));

  server.registerTool("list_dashboard_lists", {
    title: "List Datadog dashboard lists",
    description: "List Datadog UK1 dashboard lists. Read-only.",
    inputSchema: {},
    annotations
  }, async () => run(() => dd("/api/v1/dashboard/lists/manual")));

  server.registerTool("get_dashboard", {
    title: "Get Datadog dashboard",
    description: "Retrieve a Datadog UK1 dashboard by ID. Read-only.",
    inputSchema: { dashboard_id: z.string().min(1) },
    annotations
  }, async ({ dashboard_id }) => run(() => dd("/api/v1/dashboard/" + encodeURIComponent(dashboard_id))));

  server.registerTool("search_incidents", {
    title: "Search Datadog incidents",
    description: "Search Datadog UK1 Incident Management. Read-only.",
    inputSchema: {
      query: z.string().default("*"),
      page_size: z.number().int().min(1).max(100).default(25),
      page_offset: z.number().int().min(0).default(0)
    },
    annotations
  }, async ({ query, page_size, page_offset }) => run(() => dd("/api/v2/incidents/search", {
    query: { query, "page[size]": page_size, "page[offset]": page_offset }
  })));

  return server;
}

const app = createMcpExpressApp({ host: "0.0.0.0", allowedHosts: ["datadog-uk1-mcp-production.up.railway.app", "healthcheck.railway.app"] });
app.use(express.urlencoded({ extended: false, limit: "16kb" }));
mountOAuth(app);

app.get("/", (_req, res) => res.json({
  name: "Datadog UK1 ChatGPT Bridge",
  site: "uk1.datadoghq.com",
  mode: "read_only",
  authentication: "oauth2_pkce",
  mcp: "/mcp",
  health: "/health"
}));

app.get("/health", (_req, res) => res.json({
  ok: true,
  service: "datadog-uk1-chatgpt-bridge",
  mode: "read_only",
  site: "uk1.datadoghq.com",
  datadog_credentials_configured: configured(),
  oauth_configured: oauthConfigured()
}));

app.use("/mcp", (req, res, next) => {
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const claims = verifyAccessToken(token);
  if (!claims) {
    res.setHeader("WWW-Authenticate", authChallenge());
    return res.status(401).json({ error: "unauthorized" });
  }
  req.oauthClaims = claims;
  next();
});

app.post("/mcp", async (req, res) => {
  const server = serverFactory();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("MCP request failed", e);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
  res.on("close", async () => {
    try { await transport.close(); } catch {}
    try { await server.close(); } catch {}
  });
});

app.get("/mcp", (_req, res) => res.status(405).json({ error: "Method not allowed" }));
app.delete("/mcp", (_req, res) => res.status(405).json({ error: "Method not allowed" }));

app.listen(PORT, "0.0.0.0", async (error) => {
  if (error) {
    console.error("Failed to start", error);
    process.exit(1);
  }
  console.log("Datadog UK1 read-only MCP bridge listening on port " + PORT);

  if (!configured()) {
    console.warn("Datadog UK1 startup self-test: credentials not fully configured");
    return;
  }

  try {
    await dd("/api/v1/validate");
    console.log("Datadog UK1 startup self-test: API key validation OK");
  } catch (e) {
    console.error("Datadog UK1 startup self-test: API key validation FAILED (" + (e?.payload?.status || "unknown") + ")");
    return;
  }

  try {
    await dd("/api/v2/logs/events/search", {
      method: "POST",
      body: {
        filter: { query: "*", from: "now-1m", to: "now" },
        page: { limit: 1 },
        sort: "-timestamp"
      }
    });
    console.log("Datadog UK1 startup self-test: application key read validation OK");
  } catch (e) {
    console.error("Datadog UK1 startup self-test: application key read validation FAILED (" + (e?.payload?.status || "unknown") + ")");
  }
});
