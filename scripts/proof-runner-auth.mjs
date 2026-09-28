import {
  createPrivateKey,
  randomBytes,
  sign as signMessage,
} from 'node:crypto';

const ISSUER = 'wfm-proof-runner';
const AUDIENCE = 'wfm-proof-session';
const PATH = '/api/proof-runner/session';
const ASSERTION_TTL_MS = 45_000;

function decodePrivateKey() {
  const value = process.env.WFM_PROOF_RUNNER_PRIVATE_KEY_B64;
  if (!value) throw new Error('WFM_PROOF_RUNNER_PRIVATE_KEY_B64 is unavailable to the proof runner.');
  const raw = String(value).trim();
  const pem = raw.includes('BEGIN PRIVATE KEY')
    ? raw
    : Buffer.from(raw, 'base64').toString('utf8');
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Proof runner private key must be Ed25519.');
  return key;
}

function canonicalAssertion(input) {
  return [
    'VECTOR_PROOF_RUNNER_V1',
    ISSUER,
    AUDIENCE,
    String(input.email || '').trim().toLowerCase(),
    String(input.origin || '').replace(/\/$/, ''),
    String(input.nonce || ''),
    String(input.issuedAt || ''),
    String(input.expiresAt || ''),
  ].join('\n');
}

function sessionCookieFrom(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  const first = values[0];
  return first ? first.split(';', 1)[0] : '';
}

export async function proofRunnerLogin({ origin, email, timeoutMs = 20_000 }) {
  const normalizedOrigin = String(origin || '').replace(/\/$/, '');
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedOrigin.startsWith('https://')) throw new Error('Proof runner login requires an HTTPS origin.');
  if (!normalizedEmail) throw new Error('Proof runner login requires an email.');

  const issuedAt = Date.now();
  const payload = {
    email: normalizedEmail,
    origin: normalizedOrigin,
    nonce: randomBytes(24).toString('base64url'),
    issuedAt,
    expiresAt: issuedAt + ASSERTION_TTL_MS,
  };
  const signature = signMessage(
    null,
    Buffer.from(canonicalAssertion(payload), 'utf8'),
    decodePrivateKey(),
  ).toString('base64url');

  const response = await fetch(`${normalizedOrigin}${PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'origin': normalizedOrigin,
      'referer': `${normalizedOrigin}/`,
      'accept': 'application/json',
    },
    body: JSON.stringify({ ...payload, signature }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (response.status !== 200) {
    throw new Error(`Passwordless proof runner login failed for ${normalizedEmail}: HTTP ${response.status} ${text.slice(0, 240)}`);
  }
  const cookie = sessionCookieFrom(response);
  if (!cookie) throw new Error(`Passwordless proof runner login for ${normalizedEmail} returned no session cookie.`);
  return cookie;
}

export { canonicalAssertion };
