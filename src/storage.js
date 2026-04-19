// -------------------------------------------------------------------------
//  storage.js — Cross-device state via a private GitHub Gist.
//  Local cache in localStorage for instant loads + offline tolerance.
// -------------------------------------------------------------------------

import { CONFIG } from "../config.js";

const KEY_PAT = "ytf_github_pat";
const KEY_GIST_ID = "ytf_gist_id";
const KEY_STATE_CACHE = "ytf_state_cache";

const EMPTY_STATE = {
  version: 1,
  seen: { youtube: [], spotify: [] },
  hidden: { youtube: [], spotify: [] },
  lastUpdated: null,
};

let currentState = null;
let syncTimer = null;
let syncing = false;
let pendingSync = false;
let syncCallbacks = {};

export function setSyncCallbacks(cbs) { syncCallbacks = cbs || {}; }

// ----------------------------------------------------------------- PAT
export function setPat(pat) {
  if (!pat) {
    localStorage.removeItem(KEY_PAT);
    return;
  }
  localStorage.setItem(KEY_PAT, pat.trim());
}
export function hasPat() { return !!localStorage.getItem(KEY_PAT); }
function getPat() { return localStorage.getItem(KEY_PAT); }

// ----------------------------------------------------------------- Gist API
async function gh(path, init = {}) {
  const pat = getPat();
  if (!pat) throw new Error("No GitHub PAT configured");
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${pat}`,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function createGist(state) {
  const data = await gh("/gists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      description: CONFIG.gistDescription || "yt-spotify-feed state (private)",
      public: false,
      files: {
        [CONFIG.gistFilename]: { content: JSON.stringify(state, null, 2) },
      },
    }),
  });
  localStorage.setItem(KEY_GIST_ID, data.id);
  return data.id;
}

async function readGist(id) {
  const data = await gh(`/gists/${id}`);
  const file = data.files?.[CONFIG.gistFilename];
  if (!file) throw new Error("State file missing from gist");
  // The gist API returns the content inline for small files, or truncated
  // with a raw_url for large ones. This state is tiny, so content is fine.
  const content = file.truncated ? await (await fetch(file.raw_url)).text() : file.content;
  return JSON.parse(content);
}

async function writeGist(id, state) {
  await gh(`/gists/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: {
        [CONFIG.gistFilename]: { content: JSON.stringify(state, null, 2) },
      },
    }),
  });
}

// ----------------------------------------------------------------- Find or create
async function findOrCreateGist() {
  const existing = localStorage.getItem(KEY_GIST_ID);
  if (existing) return existing;

  // Look through the user's gists for one with our filename.
  const list = await gh("/gists?per_page=100");
  for (const gist of list) {
    if (gist.files && gist.files[CONFIG.gistFilename]) {
      localStorage.setItem(KEY_GIST_ID, gist.id);
      return gist.id;
    }
  }
  // None found — create a fresh one.
  return await createGist(EMPTY_STATE);
}

// ----------------------------------------------------------------- Load
export async function loadState({ preferCache = true } = {}) {
  if (preferCache) {
    const cached = localStorage.getItem(KEY_STATE_CACHE);
    if (cached) {
      try {
        currentState = JSON.parse(cached);
      } catch { /* ignore */ }
    }
  }

  try {
    const id = await findOrCreateGist();
    const remote = await readGist(id);
    currentState = mergeDefaults(remote);
    localStorage.setItem(KEY_STATE_CACHE, JSON.stringify(currentState));
  } catch (e) {
    console.warn("Gist load failed, using cache:", e.message);
    if (!currentState) currentState = { ...EMPTY_STATE };
  }
  return currentState;
}

function mergeDefaults(s) {
  return {
    ...EMPTY_STATE,
    ...s,
    seen: { ...EMPTY_STATE.seen, ...(s?.seen || {}) },
    hidden: { ...EMPTY_STATE.hidden, ...(s?.hidden || {}) },
  };
}

export function getState() { return currentState || { ...EMPTY_STATE }; }

// ----------------------------------------------------------------- Mutations
export function isSeen(source, id) {
  return !!currentState?.seen?.[source]?.includes(id);
}
export function isHidden(source, id) {
  return !!currentState?.hidden?.[source]?.includes(id);
}

export function toggleSeen(source, id) {
  ensureState();
  const arr = currentState.seen[source];
  const idx = arr.indexOf(id);
  if (idx >= 0) arr.splice(idx, 1);
  else arr.push(id);
  trim();
  scheduleSync();
}
export function toggleHidden(source, id) {
  ensureState();
  const arr = currentState.hidden[source];
  const idx = arr.indexOf(id);
  if (idx >= 0) arr.splice(idx, 1);
  else arr.push(id);
  trim();
  scheduleSync();
}

function ensureState() {
  if (!currentState) currentState = { ...EMPTY_STATE };
  currentState.seen ||= { youtube: [], spotify: [] };
  currentState.hidden ||= { youtube: [], spotify: [] };
}

function trim() {
  // Keep lists bounded so gist never balloons. Very old IDs aren't useful
  // because they'd never reappear in a 30-day window anyway.
  const LIMIT = 2000;
  for (const kind of ["seen", "hidden"]) {
    for (const src of ["youtube", "spotify"]) {
      if (currentState[kind][src].length > LIMIT) {
        currentState[kind][src] = currentState[kind][src].slice(-LIMIT);
      }
    }
  }
}

// ----------------------------------------------------------------- Sync
function scheduleSync() {
  currentState.lastUpdated = new Date().toISOString();
  localStorage.setItem(KEY_STATE_CACHE, JSON.stringify(currentState));
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 1500);
}

export async function syncNow() {
  if (syncing) return;
  syncing = true;
  try {
    const id = await findOrCreateGist();
    await writeGist(id, currentState);
  } catch (e) {
    console.warn("Gist sync failed:", e.message);
  } finally {
    syncing = false;
  }
}

// ----------------------------------------------------------------- Factory reset
export function resetAllLocal() {
  for (const k of [KEY_PAT, KEY_GIST_ID, KEY_STATE_CACHE]) localStorage.removeItem(k);
  currentState = null;
}
