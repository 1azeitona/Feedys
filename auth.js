// -------------------------------------------------------------------------
//  auth.js — OAuth 2.0 Authorization Code flow with PKCE
//  Works for Google (YouTube) and Spotify. No client secret required.
// -------------------------------------------------------------------------

import { CONFIG } from "../config.js";

const STORAGE = {
  ytToken: "ytf_yt_token",
  ytRefresh: "ytf_yt_refresh",
  spToken: "ytf_sp_token",
  spRefresh: "ytf_sp_refresh",
  pkceVerifier: "ytf_pkce_verifier",
  pkceProvider: "ytf_pkce_provider",
  postAuthPath: "ytf_post_auth_path",
};

// ----------------------------------------------------------------- PKCE utils
function randomString(len = 64) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => ("0" + (b & 0xff).toString(16)).slice(-2)).join("");
}

async function sha256(input) {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(hash);
}

function base64url(bytes) {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pkcePair() {
  const verifier = randomString(64);
  const challenge = base64url(await sha256(verifier));
  return { verifier, challenge };
}

// ----------------------------------------------------------------- Providers
const providers = {
  youtube: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId: CONFIG.youtube.clientId,
    scopes: CONFIG.youtube.scopes,
    extraAuthParams: {
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    },
    tokenKey: STORAGE.ytToken,
    refreshKey: STORAGE.ytRefresh,
  },
  spotify: {
    authUrl: "https://accounts.spotify.com/authorize",
    tokenUrl: "https://accounts.spotify.com/api/token",
    clientId: CONFIG.spotify.clientId,
    scopes: CONFIG.spotify.scopes,
    extraAuthParams: {},
    tokenKey: STORAGE.spToken,
    refreshKey: STORAGE.spRefresh,
  },
};

function getRedirectUri() {
  // Strip query + hash so we get a stable URI.
  const { origin, pathname } = window.location;
  return origin + pathname;
}

// ----------------------------------------------------------------- Start flow
export async function startLogin(provider) {
  const p = providers[provider];
  if (!p) throw new Error("Unknown provider: " + provider);
  if (!p.clientId || p.clientId.startsWith("YOUR_")) {
    throw new Error(`Missing ${provider} clientId in config.js`);
  }

  const { verifier, challenge } = await pkcePair();
  sessionStorage.setItem(STORAGE.pkceVerifier, verifier);
  sessionStorage.setItem(STORAGE.pkceProvider, provider);
  sessionStorage.setItem(STORAGE.postAuthPath, window.location.href);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: p.clientId,
    redirect_uri: getRedirectUri(),
    scope: p.scopes.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: provider,
    ...p.extraAuthParams,
  });

  window.location.assign(`${p.authUrl}?${params.toString()}`);
}

// ----------------------------------------------------------------- Handle callback
export async function maybeHandleCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");

  if (err) {
    // Clean up the URL so the error doesn't stick around.
    cleanUrl();
    throw new Error("OAuth error: " + err);
  }
  if (!code) return null;

  const provider = state || sessionStorage.getItem(STORAGE.pkceProvider);
  const verifier = sessionStorage.getItem(STORAGE.pkceVerifier);
  if (!provider || !verifier) {
    cleanUrl();
    return null;
  }

  const p = providers[provider];
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: getRedirectUri(),
    client_id: p.clientId,
    code_verifier: verifier,
  });

  const res = await fetch(p.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    cleanUrl();
    throw new Error(`Token exchange failed for ${provider}: ${text}`);
  }
  const data = await res.json();
  storeToken(provider, data);

  sessionStorage.removeItem(STORAGE.pkceVerifier);
  sessionStorage.removeItem(STORAGE.pkceProvider);
  sessionStorage.removeItem(STORAGE.postAuthPath);

  cleanUrl();
  return provider;
}

function cleanUrl() {
  const { origin, pathname } = window.location;
  history.replaceState({}, document.title, origin + pathname);
}

// ----------------------------------------------------------------- Store / read
function storeToken(provider, data) {
  const p = providers[provider];
  const now = Math.floor(Date.now() / 1000);
  const entry = {
    access_token: data.access_token,
    expires_at: now + (data.expires_in || 3600) - 60, // small buffer
    token_type: data.token_type || "Bearer",
    scope: data.scope || p.scopes.join(" "),
  };
  localStorage.setItem(p.tokenKey, JSON.stringify(entry));
  if (data.refresh_token) {
    localStorage.setItem(p.refreshKey, data.refresh_token);
  }
}

function readToken(provider) {
  const p = providers[provider];
  const raw = localStorage.getItem(p.tokenKey);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function hasToken(provider) {
  return !!readToken(provider) || !!localStorage.getItem(providers[provider].refreshKey);
}

export function logout(provider) {
  const p = providers[provider];
  localStorage.removeItem(p.tokenKey);
  localStorage.removeItem(p.refreshKey);
}

// ----------------------------------------------------------------- Access token (auto refresh)
export async function getAccessToken(provider) {
  const p = providers[provider];
  const token = readToken(provider);
  const now = Math.floor(Date.now() / 1000);

  if (token && token.access_token && token.expires_at > now) {
    return token.access_token;
  }

  const refresh = localStorage.getItem(p.refreshKey);
  if (!refresh) {
    throw new Error(`Not authenticated with ${provider}`);
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: p.clientId,
  });

  const res = await fetch(p.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    // Invalidate so the user reconnects.
    logout(provider);
    throw new Error(`Refresh failed for ${provider}: ${text}`);
  }
  const data = await res.json();
  // Spotify's refresh response may omit refresh_token (in which case the old
  // one stays valid). Keep the existing one if none returned.
  if (!data.refresh_token) data.refresh_token = refresh;
  storeToken(provider, data);
  return data.access_token;
}

// ----------------------------------------------------------------- API fetch helper
export async function apiFetch(provider, url, init = {}) {
  const token = await getAccessToken(provider);
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (res.status === 401) {
    // Try once more after forcing refresh.
    logout(provider);
    throw new Error(`${provider} auth expired; please reconnect`);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${provider} API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}
