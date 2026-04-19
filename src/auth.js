// -------------------------------------------------------------------------
//  auth.js — YouTube uses GIS token model (no secret needed).
//             Spotify uses PKCE authorization code flow.
// -------------------------------------------------------------------------

import { CONFIG } from "../config.js";

const STORAGE = {
  ytToken:      "ytf_yt_token",
  spToken:      "ytf_sp_token",
  spRefresh:    "ytf_sp_refresh",
  pkceVerifier: "ytf_pkce_verifier",
  postAuthPath: "ytf_post_auth_path",
};

// ----------------------------------------------------------------- GIS (YouTube)

function waitForGIS() {
  return new Promise((resolve) => {
    if (window.google?.accounts?.oauth2) { resolve(window.google.accounts.oauth2); return; }
    const t = setInterval(() => {
      if (window.google?.accounts?.oauth2) { clearInterval(t); resolve(window.google.accounts.oauth2); }
    }, 100);
  });
}

function requestYouTubeToken(silent = false) {
  return new Promise(async (resolve, reject) => {
    const gis = await waitForGIS();
    const client = gis.initTokenClient({
      client_id: CONFIG.youtube.clientId,
      scope: CONFIG.youtube.scopes.join(" "),
      prompt: silent ? "" : undefined,
      callback(response) {
        if (response.error) { reject(new Error("YouTube auth: " + response.error)); return; }
        const now = Math.floor(Date.now() / 1000);
        localStorage.setItem(STORAGE.ytToken, JSON.stringify({
          access_token: response.access_token,
          expires_at: now + (response.expires_in || 3600) - 60,
          token_type: response.token_type || "Bearer",
          scope: response.scope,
        }));
        resolve(response.access_token);
      },
      error_callback(err) {
        reject(new Error("YouTube auth failed: " + (err?.type || "unknown")));
      },
    });
    client.requestAccessToken({ prompt: silent ? "" : undefined });
  });
}

// ----------------------------------------------------------------- PKCE utils (Spotify)

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

// ----------------------------------------------------------------- Spotify config

const spotify = {
  authUrl:  "https://accounts.spotify.com/authorize",
  tokenUrl: "https://accounts.spotify.com/api/token",
  clientId: CONFIG.spotify.clientId,
  scopes:   CONFIG.spotify.scopes,
};

function getRedirectUri() {
  const { origin, pathname } = window.location;
  return origin + pathname;
}

// ----------------------------------------------------------------- Start login

export async function startLogin(provider) {
  if (provider === "youtube") {
    return await requestYouTubeToken(false);
  }

  if (provider === "spotify") {
    const { verifier, challenge } = await pkcePair();
    sessionStorage.setItem(STORAGE.pkceVerifier, verifier);
    sessionStorage.setItem(STORAGE.postAuthPath, window.location.href);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: spotify.clientId,
      redirect_uri: getRedirectUri(),
      scope: spotify.scopes.join(" "),
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "spotify",
    });
    window.location.assign(`${spotify.authUrl}?${params.toString()}`);
    return;
  }

  throw new Error("Unknown provider: " + provider);
}

// ----------------------------------------------------------------- Handle Spotify callback

export async function maybeHandleCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");

  if (err) { cleanUrl(); throw new Error("OAuth error: " + err); }
  if (!code || state !== "spotify") return null;

  const verifier = sessionStorage.getItem(STORAGE.pkceVerifier);
  if (!verifier) { cleanUrl(); return null; }

  const body = new URLSearchParams({
    grant_type:    "authorization_code",
    code,
    redirect_uri:  getRedirectUri(),
    client_id:     spotify.clientId,
    code_verifier: verifier,
  });

  const res = await fetch(spotify.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    cleanUrl();
    throw new Error(`Token exchange failed for spotify: ${text}`);
  }
  const data = await res.json();
  storeSpotifyToken(data);

  sessionStorage.removeItem(STORAGE.pkceVerifier);
  sessionStorage.removeItem(STORAGE.postAuthPath);
  cleanUrl();
  return "spotify";
}

function cleanUrl() {
  const { origin, pathname } = window.location;
  history.replaceState({}, document.title, origin + pathname);
}

// ----------------------------------------------------------------- Token storage

function storeSpotifyToken(data) {
  const now = Math.floor(Date.now() / 1000);
  localStorage.setItem(STORAGE.spToken, JSON.stringify({
    access_token: data.access_token,
    expires_at: now + (data.expires_in || 3600) - 60,
    token_type: data.token_type || "Bearer",
    scope: data.scope || spotify.scopes.join(" "),
  }));
  if (data.refresh_token) localStorage.setItem(STORAGE.spRefresh, data.refresh_token);
}

function readToken(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// hasToken only checks existence (not expiry) — getAccessToken handles refresh
export function hasToken(provider) {
  if (provider === "youtube") return !!localStorage.getItem(STORAGE.ytToken);
  if (provider === "spotify") return !!readToken(STORAGE.spToken) || !!localStorage.getItem(STORAGE.spRefresh);
  return false;
}

export function logout(provider) {
  if (provider === "youtube") {
    const t = readToken(STORAGE.ytToken);
    if (t?.access_token && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(t.access_token, () => {});
    }
    localStorage.removeItem(STORAGE.ytToken);
  } else if (provider === "spotify") {
    localStorage.removeItem(STORAGE.spToken);
    localStorage.removeItem(STORAGE.spRefresh);
  }
}

// ----------------------------------------------------------------- Access token

export async function getAccessToken(provider) {
  if (provider === "youtube") {
    const token = readToken(STORAGE.ytToken);
    const now = Math.floor(Date.now() / 1000);
    if (token?.access_token && token.expires_at > now) return token.access_token;
    // Expired — try silent refresh via GIS (no UI if already consented)
    return await requestYouTubeToken(true);
  }

  if (provider === "spotify") {
    const token = readToken(STORAGE.spToken);
    const now = Math.floor(Date.now() / 1000);
    if (token?.access_token && token.expires_at > now) return token.access_token;

    const refresh = localStorage.getItem(STORAGE.spRefresh);
    if (!refresh) throw new Error("Not authenticated with spotify");

    const body = new URLSearchParams({
      grant_type:    "refresh_token",
      refresh_token: refresh,
      client_id:     spotify.clientId,
    });
    const res = await fetch(spotify.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) { logout("spotify"); throw new Error("Spotify refresh failed"); }
    const data = await res.json();
    if (!data.refresh_token) data.refresh_token = refresh;
    storeSpotifyToken(data);
    return data.access_token;
  }

  throw new Error("Unknown provider: " + provider);
}

// ----------------------------------------------------------------- API fetch helper

export async function apiFetch(provider, url, init = {}, _retries = 3) {
  const token = await getAccessToken(provider);
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    logout(provider);
    throw new Error(`${provider} auth expired; please reconnect`);
  }
  if (res.status === 429 && _retries > 0) {
    const wait = parseInt(res.headers.get("Retry-After") || "3", 10) * 1000;
    await new Promise((r) => setTimeout(r, wait));
    return apiFetch(provider, url, init, _retries - 1);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${provider} API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}
