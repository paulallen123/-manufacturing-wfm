import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ORIGIN = "https://datadog-uk1-mcp-production.up.railway.app";
export const MCP_RESOURCE = ORIGIN + "/mcp";
export const OAUTH_SCOPE = "datadog.read";

const ISSUER = ORIGIN;
const codes = new Map();
const attempts = new Map();
const env = (name) => String(process.env[name] || "").trim();
const now = () => Math.floor(Date.now() / 1000);

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}
function b64(v) { return Buffer.from(v).toString("base64url"); }
function sign(payload) {
  const body = b64(JSON.stringify(payload));
  const sig = createHmac("sha256", env("OAUTH_SIGNING_SECRET")).update(body).digest("base64url");
  return body + "." + sig;
}
function verify(token, type) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 2) return null;
    const [body, sig] = parts;
    const expected = createHmac("sha256", env("OAUTH_SIGNING_SECRET")).update(body).digest("base64url");
    if (!safeEqual(sig, expected)) return null;
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (p.typ !== type || p.exp <= now() || p.iss !== ISSUER || p.aud !== MCP_RESOURCE || p.resource !== MCP_RESOURCE) return null;
    if (!String(p.scope || "").split(/\s+/).includes(OAUTH_SCOPE)) return null;
    return p;
  } catch { return null; }
}
export function verifyAccessToken(token) { return verify(token, "access"); }
export function oauthConfigured() {
  return env("OAUTH_PIN").length >= 10 && env("OAUTH_SIGNING_SECRET").length >= 32;
}
export function authChallenge() {
  return 'Bearer resource_metadata="' + ORIGIN + '/.well-known/oauth-protected-resource", scope="' + OAUTH_SCOPE + '"';
}
function tokenPair(clientId, scope = OAUTH_SCOPE) {
  const iat = now();
  const granted = String(scope || OAUTH_SCOPE).split(/\s+/).filter(Boolean);
  const scopeText = [...new Set(granted)].join(" ");
  const base = {
    iss:ISSUER,
    aud:MCP_RESOURCE,
    sub:"datadog-uk1-owner",
    client_id:clientId,
    resource:MCP_RESOURCE,
    scope:scopeText,
    iat,
    jti:randomBytes(16).toString("base64url")
  };
  const out = {
    token_type:"Bearer",
    access_token:sign({ ...base, typ:"access", exp:iat + 3600 }),
    expires_in:3600,
    scope:scopeText
  };
  if (granted.includes("offline_access")) {
    out.refresh_token = sign({ ...base, typ:"refresh", exp:iat + 30 * 86400 });
  }
  return out;
}
function noStore(res) {
  res.setHeader("Cache-Control","no-store");
  res.setHeader("Pragma","no-cache");
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("Referrer-Policy","no-referrer");
}
function esc(v) {
  return String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
}
function params(src) {
  const p = {
    clientId:String(src.client_id || ""),
    redirectUri:String(src.redirect_uri || ""),
    responseType:String(src.response_type || ""),
    state:String(src.state || ""),
    challenge:String(src.code_challenge || ""),
    challengeMethod:String(src.code_challenge_method || ""),
    resource:String(src.resource || ""),
    scope:String(src.scope || OAUTH_SCOPE).trim()
  };
  if (p.responseType !== "code" || !p.clientId || !p.redirectUri || !p.state) throw new Error("Missing OAuth parameters.");
  if (p.challengeMethod !== "S256" || p.challenge.length < 43) throw new Error("PKCE S256 is required.");
  if (p.resource !== MCP_RESOURCE) throw new Error("Invalid resource.");
  const scopes = p.scope.split(/\s+/).filter(Boolean);
  const allowed = new Set([OAUTH_SCOPE, "offline_access"]);
  if (!scopes.includes(OAUTH_SCOPE) || scopes.some((scope) => !allowed.has(scope))) throw new Error("Unsupported scope.");
  return p;
}
async function validateClient(clientId, redirectUri) {
  const c = new URL(clientId);
  if (c.protocol !== "https:" || c.hostname !== "chatgpt.com" || !/^\/oauth\/(?:client\.json|[A-Za-z0-9_-]+\/client\.json)$/.test(c.pathname)) throw new Error("Untrusted OAuth client.");
  const r = new URL(redirectUri);
  if (r.protocol !== "https:" || r.hostname !== "chatgpt.com" || !(r.pathname === "/connector_platform_oauth_redirect" || r.pathname.startsWith("/connector/oauth/"))) throw new Error("Untrusted redirect URI.");
  const response = await fetch(c.href, { headers:{Accept:"application/json","User-Agent":"datadog-uk1-chatgpt-bridge/1.1"}, signal:AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Could not validate ChatGPT client metadata.");
  const metadata = await response.json();
  if (!Array.isArray(metadata.redirect_uris) || !metadata.redirect_uris.includes(redirectUri)) throw new Error("Redirect URI is not registered.");
}
function page(p, message="") {
  const hidden = [
    ["client_id",p.clientId],["redirect_uri",p.redirectUri],["response_type","code"],["state",p.state],
    ["code_challenge",p.challenge],["code_challenge_method","S256"],["resource",p.resource],["scope",p.scope]
  ].map(([k,v]) => '<input type="hidden" name="' + esc(k) + '" value="' + esc(v) + '">').join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Datadog UK1 approval</title>
<style>body{font-family:system-ui;background:#f6f7f9;padding:28px;color:#111827}.c{max-width:520px;margin:8vh auto;background:white;border:1px solid #e5e7eb;border-radius:16px;padding:28px;box-shadow:0 12px 35px #0001}.b{display:inline-block;background:#eef2ff;color:#3730a3;padding:5px 9px;border-radius:999px;font-size:12px;font-weight:700}h1{font-size:22px}p{color:#4b5563;line-height:1.5}input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #cbd5e1;border-radius:9px;font-size:16px}button{width:100%;margin-top:14px;padding:12px;border:0;border-radius:9px;background:#111827;color:white;font-weight:700}.e{background:#fef2f2;color:#991b1b;padding:9px;border-radius:8px}</style></head><body><main class="c"><span class="b">READ ONLY · UK1</span><h1>Approve ChatGPT access</h1><p>This private bridge provides read-only Datadog observability access. It exposes no Datadog write tools.</p>${message ? '<div class="e">'+esc(message)+'</div>' : ''}<form method="post" action="/oauth/authorize">${hidden}<p><label>Bridge approval PIN</label></p><input name="pin" type="password" autocomplete="one-time-code" required autofocus><button type="submit">Approve read-only access</button></form></main></body></html>`;
}
function pinOk(req, pin) {
  const ip = String(req.headers["x-forwarded-for"] || req.ip || "unknown").split(",")[0].trim();
  const t = Date.now(), cur = attempts.get(ip);
  if (cur && cur.blockedUntil > t) return { ok:false, blocked:true };
  if (safeEqual(pin, env("OAUTH_PIN"))) { attempts.delete(ip); return { ok:true, blocked:false }; }
  const sameWindow = cur && t - cur.windowStart < 10 * 60 * 1000;
  const count = sameWindow ? cur.count + 1 : 1;
  const blockedUntil = count >= 5 ? t + 15 * 60 * 1000 : 0;
  attempts.set(ip,{ windowStart:sameWindow ? cur.windowStart : t, count, blockedUntil });
  return { ok:false, blocked:blockedUntil > t };
}
function error(res,status,code,description) {
  noStore(res);
  return res.status(status).json({ error:code, error_description:description });
}

export function mountOAuth(app) {
  const resourceDoc = (_req,res) => { noStore(res); res.json({ resource:MCP_RESOURCE, authorization_servers:[ISSUER], scopes_supported:[OAUTH_SCOPE], bearer_methods_supported:["header"], resource_documentation:ORIGIN + "/" }); };
  app.get("/.well-known/oauth-protected-resource", resourceDoc);
  app.get("/.well-known/oauth-protected-resource/mcp", resourceDoc);
  app.get("/.well-known/oauth-authorization-server", (_req,res) => {
    noStore(res);
    res.json({
      issuer:ISSUER,
      authorization_endpoint:ORIGIN + "/oauth/authorize",
      token_endpoint:ORIGIN + "/oauth/token",
      response_types_supported:["code"],
      response_modes_supported:["query"],
      grant_types_supported:["authorization_code","refresh_token"],
      code_challenge_methods_supported:["S256"],
      scopes_supported:[OAUTH_SCOPE,"offline_access"],
      token_endpoint_auth_methods_supported:["none"],
      client_id_metadata_document_supported:true,
      authorization_response_iss_parameter_supported:true
    });
  });
  app.get("/oauth/authorize", async (req,res) => {
    try {
      if (!oauthConfigured()) return error(res,503,"temporarily_unavailable","OAuth is not configured.");
      const p = params(req.query); await validateClient(p.clientId,p.redirectUri);
      noStore(res); res.setHeader("Content-Security-Policy","default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
      return res.type("html").send(page(p));
    } catch(e) { return error(res,400,"invalid_request",e.message || "Invalid authorization request."); }
  });
  app.post("/oauth/authorize", async (req,res) => {
    try {
      const p = params(req.body || {}); await validateClient(p.clientId,p.redirectUri);
      const check = pinOk(req,String(req.body?.pin || ""));
      if (!check.ok) {
        noStore(res); res.setHeader("Content-Security-Policy","default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
        return res.status(check.blocked ? 429 : 401).type("html").send(page(p,check.blocked ? "Too many incorrect attempts. Try again later." : "Incorrect approval PIN."));
      }
      for (const [k,v] of codes) if (v.expiresAt <= Date.now()) codes.delete(k);
      const code = randomBytes(32).toString("base64url");
      codes.set(code,{ ...p, expiresAt:Date.now() + 5 * 60 * 1000 });
      const redirect = new URL(p.redirectUri); redirect.searchParams.set("code",code); redirect.searchParams.set("state",p.state); redirect.searchParams.set("iss",ISSUER);
      noStore(res); return res.redirect(303,redirect.href);
    } catch(e) { return error(res,400,"invalid_request",e.message || "Invalid authorization request."); }
  });
  app.post("/oauth/token",(req,res) => {
    try {
      const body = req.body || {}, grant = String(body.grant_type || ""), clientId = String(body.client_id || ""), resource = String(body.resource || MCP_RESOURCE);
      if (!clientId || resource !== MCP_RESOURCE) return error(res,400,"invalid_request","Invalid client or resource.");
      if (grant === "authorization_code") {
        const code = String(body.code || ""), rec = codes.get(code);
        if (!rec || rec.expiresAt <= Date.now()) return error(res,400,"invalid_grant","Authorization code is invalid or expired.");
        const verifier = String(body.code_verifier || "");
        const challenge = createHash("sha256").update(verifier).digest("base64url");
        if (rec.clientId !== clientId || rec.redirectUri !== String(body.redirect_uri || "") || rec.resource !== resource || !safeEqual(challenge,rec.challenge)) {
          codes.delete(code); return error(res,400,"invalid_grant","Authorization code verification failed.");
        }
        codes.delete(code); noStore(res); return res.json(tokenPair(clientId, rec.scope));
      }
      if (grant === "refresh_token") {
        const claims = verify(String(body.refresh_token || ""),"refresh");
        if (!claims || claims.client_id !== clientId) return error(res,400,"invalid_grant","Refresh token is invalid or expired.");
        noStore(res); return res.json(tokenPair(clientId, claims.scope));
      }
      return error(res,400,"unsupported_grant_type","Only authorization_code and refresh_token are supported.");
    } catch(e) { return error(res,400,"invalid_request",e.message || "Token request failed."); }
  });
}
