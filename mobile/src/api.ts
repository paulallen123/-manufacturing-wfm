import * as SecureStore from "expo-secure-store";
export type VectaEpisode = {
  episodeId: string;
  decisionType: string;
  triggeredAt: string;
  contextRevision: string;
  site: string;
  sourceEvidence: string[];
  recommendation: {
    optionId: string | null;
    reason: string;
    authorityRequired: string;
    executionPermitted: boolean;
  };
  options: Array<{
    id: string;
    label: string;
    feasible: boolean;
    policyAllowed: boolean;
    hardConstraintsPassed: boolean;
    uncertainty: number;
    prediction: Record<string, number | null>;
    evidenceRefs: string[];
    reasonCodes: string[];
  }>;
};

const configuredOrigin = (process.env.EXPO_PUBLIC_VECTOR_API_ORIGIN || "").replace(/\/$/, "");

export function apiOrigin() {
  if (!configuredOrigin) {
    throw new Error("EXPO_PUBLIC_VECTOR_API_ORIGIN is not configured.");
  }
  return configuredOrigin;
}

const MOBILE_SESSION_KEY = "vecta.mobile.session";

async function api<T>(
  path: string,
  init: RequestInit = {},
  options: { auth?: boolean } = {}
): Promise<T> {
  const token = options.auth === false ? null : await SecureStore.getItemAsync(MOBILE_SESSION_KEY);
  const response = await fetch(apiOrigin() + path, {
    ...init,
    credentials: "include",
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: "Bearer " + token } : {}),
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text || "Unexpected response." }; }
  if (!response.ok) throw new Error(body?.error || ("Vecta request failed (" + response.status + ")."));
  return body as T;
}

export async function signIn(email: string, password: string) {
  await SecureStore.deleteItemAsync(MOBILE_SESSION_KEY);
  await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ email: email.trim(), password })
  }, { auth: false });

  const session = await api<{ accessToken: string; expiresAt: string }>("/api/mobile/session", {
    method: "POST"
  }, { auth: false });

  // The exchange endpoint atomically consumes the short-lived browser session and
  // clears its cookie. Only the revocable device bearer survives.
  await SecureStore.setItemAsync(MOBILE_SESSION_KEY, session.accessToken, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  });
  return api<any>("/api/bootstrap");
}

export async function signOut() {
  try {
    await api("/api/mobile/session", { method: "DELETE" });
  } finally {
    await SecureStore.deleteItemAsync(MOBILE_SESSION_KEY);
  }
}

export async function bootstrap() {
  return api<any>("/api/bootstrap");
}

export async function listRecommendations(): Promise<VectaEpisode[]> {
  const body = await api<{ episodes: VectaEpisode[] }>("/api/operations/intelligence/decisions");
  return Array.isArray(body.episodes) ? body.episodes : [];
}

export async function confirmRecommendation(input: {
  episodeId: string;
  optionId: string;
  contextRevision: string;
  decision: "APPROVE" | "REJECT";
  execute?: boolean;
}) {
  return api<{
    status: string;
    execution?: { state?: string; executionId?: string };
    auditId?: string;
  }>("/api/mobile/recommendations/" + encodeURIComponent(input.episodeId) + "/decision", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function sendAssistantMessage(message: string, language: string) {
  return api<{ answer: string; language?: string; actionProposal?: any }>("/api/mobile/assistant", {
    method: "POST",
    body: JSON.stringify({ message, language })
  });
}

export async function sendAssistantAudio(uri: string, language: string) {
  const { File } = await import("expo-file-system");
  const file = new File(uri);
  const audioBase64 = await file.base64();
  if (!audioBase64) throw new Error("Recorded audio is empty.");

  const token = await SecureStore.getItemAsync(MOBILE_SESSION_KEY);
  const response = await fetch(apiOrigin() + "/api/mobile/assistant/audio", {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(token ? { authorization: "Bearer " + token } : {})
    },
    body: JSON.stringify({ language, mimeType: "audio/mp4", audioBase64 })
  });
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text || "Unexpected response." }; }
  if (!response.ok) throw new Error(body?.error || "Voice request failed.");
  return body as { transcript: string; answer: string; language?: string; actionProposal?: any };
}
