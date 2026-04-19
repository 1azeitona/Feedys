// -------------------------------------------------------------------------
//  main.js — Entry point. Orchestrates auth, storage, data fetching, and UI.
// -------------------------------------------------------------------------

import { CONFIG } from "../config.js";
import {
  maybeHandleCallback,
  hasToken,
  startLogin,
  logout,
} from "./auth.js";
import {
  hasPat,
  setPat,
  loadState,
  syncNow,
  resetAllLocal,
} from "./storage.js";
import { fetchYouTubeFeed } from "./youtube.js";
import { fetchSpotifyFeed } from "./spotify.js";
import {
  renderFeed,
  bindTabs,
  setTabCount,
  showLoader,
  updateLoader,
  hideLoader,
  toast,
} from "./ui.js";

const $ = (s) => document.querySelector(s);

const feedCache = { youtube: [], spotify: [] };
let activeTab = "youtube";

// ----------------------------------------------------------------- Bootstrap
(async function bootstrap() {
  try {
    // Handle OAuth redirect first.
    const maybeProvider = await maybeHandleCallback();
    if (maybeProvider) toast(`Connected ${maybeProvider}`);

    bindTabs((name) => {
      activeTab = name;
      renderActiveTab();
    });
    bindGlobalUI();

    if (!isConfigured()) {
      showSetup();
      return;
    }

    // Load state (from cache first, then gist).
    await loadState();

    await refreshAll();
  } catch (e) {
    console.error(e);
    toast("Error: " + e.message);
    showSetup();
  }
})();

// ----------------------------------------------------------------- State checks
function isConfigured() {
  return (
    hasPat() &&
    hasToken("youtube") &&
    hasToken("spotify") &&
    !CONFIG.youtube.clientId.startsWith("YOUR_") &&
    !CONFIG.spotify.clientId.startsWith("YOUR_")
  );
}

// ----------------------------------------------------------------- Setup screen
function showSetup() {
  $("#setup").classList.remove("hidden");
  $("#feed").classList.add("hidden");
  updateSetupStatuses();
}

function updateSetupStatuses() {
  const s = (sel, value) => {
    const el = $(`[data-status="${sel}"]`);
    if (!el) return;
    el.dataset.value = value;
    el.textContent = value === "ok" ? "connected" : value === "active" ? "next" : "pending";
  };
  s("gist", hasPat() ? "ok" : "active");
  s("youtube", hasToken("youtube") ? "ok" : hasPat() ? "active" : "pending");
  s("spotify", hasToken("spotify") ? "ok" : hasToken("youtube") ? "active" : "pending");

  // Toggle connect/disconnect buttons.
  const ytOn = hasToken("youtube");
  const spOn = hasToken("spotify");
  $("#yt-connect").classList.toggle("hidden", ytOn);
  $("#yt-disconnect").classList.toggle("hidden", !ytOn);
  $("#sp-connect").classList.toggle("hidden", spOn);
  $("#sp-disconnect").classList.toggle("hidden", !spOn);

  $("#enter-app").classList.toggle("hidden", !isConfigured());

  // Pre-fill PAT placeholder when already set.
  if (hasPat()) $("#pat-input").placeholder = "•••••••• (saved)";
}

function bindGlobalUI() {
  $("#pat-save").addEventListener("click", () => {
    const val = $("#pat-input").value.trim();
    if (!val) { toast("Paste a token first"); return; }
    setPat(val);
    $("#pat-input").value = "";
    toast("Token saved");
    updateSetupStatuses();
  });

  $("#yt-connect").addEventListener("click", async () => {
    try {
      await startLogin("youtube");
      toast("Connected youtube");
      updateSetupStatuses();
    } catch (e) {
      toast("YouTube: " + e.message);
    }
  });
  $("#sp-connect").addEventListener("click", () => startLogin("spotify"));
  $("#yt-disconnect").addEventListener("click", () => { logout("youtube"); updateSetupStatuses(); });
  $("#sp-disconnect").addEventListener("click", () => { logout("spotify"); updateSetupStatuses(); });

  $("#enter-app").addEventListener("click", async () => {
    $("#setup").classList.add("hidden");
    $("#feed").classList.remove("hidden");
    await loadState();
    await refreshAll();
  });

  $("#refresh-btn").addEventListener("click", refreshAll);
  $("#refresh-empty")?.addEventListener("click", refreshAll);

  $("#settings-btn").addEventListener("click", () => {
    showSetup();
  });
}

// ----------------------------------------------------------------- Refresh
async function refreshAll() {
  if (!isConfigured()) { showSetup(); return; }
  $("#setup").classList.add("hidden");
  $("#feed").classList.remove("hidden");

  showLoader("Fetching YouTube…");
  try {
    feedCache.youtube = await fetchYouTubeFeed({
      onProgress: (m) => updateLoader(`YouTube: ${m}`),
    });
    setTabCount("youtube", feedCache.youtube.length);
  } catch (e) {
    console.error(e);
    toast("YouTube: " + e.message);
  }

  updateLoader("Fetching Spotify…");
  try {
    feedCache.spotify = await fetchSpotifyFeed({
      onProgress: (m) => updateLoader(`Spotify: ${m}`),
    });
    setTabCount("spotify", feedCache.spotify.length);
  } catch (e) {
    console.error(e);
    toast("Spotify: " + e.message);
  }

  hideLoader();
  renderActiveTab();

  // Flush any pending state updates now that we're online.
  syncNow();
}

function renderActiveTab() {
  const items = feedCache[activeTab] || [];
  renderFeed(items, activeTab);
}

// ----------------------------------------------------------------- Exposed debug helpers
window.__ytspf = {
  reset() { resetAllLocal(); location.reload(); },
  cache: feedCache,
};
