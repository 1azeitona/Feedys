// -------------------------------------------------------------------------
//  spotify.js — Fetch recent episodes from followed podcasts ("shows").
// -------------------------------------------------------------------------

import { apiFetch } from "./auth.js";
import { CONFIG } from "../config.js";

const API = "https://api.spotify.com/v1";

// ----------------------------------------------------------------- Followed shows
async function listFollowedShows() {
  const shows = [];
  let url = `${API}/me/shows?limit=50`;
  while (url) {
    const data = await apiFetch("spotify", url);
    for (const item of data.items || []) {
      const show = item.show;
      if (!show) continue;
      shows.push({
        id: show.id,
        name: show.name,
        publisher: show.publisher,
        image: show.images?.[1]?.url || show.images?.[0]?.url,
      });
    }
    url = data.next;
  }
  return shows;
}

// ----------------------------------------------------------------- Recent episodes
async function listRecentEpisodes(show, sinceDate) {
  // Spotify /shows/{id}/episodes is paginated, newest first.
  const items = [];
  let url = `${API}/shows/${show.id}/episodes?limit=20&market=from_token`;
  let exhausted = false;
  while (url && !exhausted) {
    const data = await apiFetch("spotify", url);
    for (const ep of data.items || []) {
      if (!ep || !ep.release_date) continue;
      const released = new Date(ep.release_date);
      if (released < sinceDate) {
        exhausted = true;
        continue;
      }
      items.push(mapEpisode(ep, show, released));
    }
    if (exhausted) break;
    url = data.next;
  }
  return items;
}

function mapEpisode(ep, show, released) {
  return {
    id: ep.id,
    source: "spotify",
    title: ep.name,
    description: (ep.description || "").slice(0, 220),
    channelId: show.id,
    channelTitle: show.name,
    thumb: ep.images?.[1]?.url || ep.images?.[0]?.url || show.image,
    publishedAt: released.toISOString(),
    durationMs: ep.duration_ms,
    url: ep.external_urls?.spotify || `https://open.spotify.com/episode/${ep.id}`,
  };
}

// ----------------------------------------------------------------- Public
export async function fetchSpotifyFeed({ onProgress } = {}) {
  const sinceDate = new Date(Date.now() - CONFIG.daysToShow * 86400 * 1000);

  onProgress?.("Fetching followed shows…");
  const shows = await listFollowedShows();

  const all = [];
  let i = 0;
  const concurrency = 4;
  const queue = [...shows];
  async function worker() {
    while (queue.length) {
      const show = queue.shift();
      i++;
      onProgress?.(`Fetching episodes ${i}/${shows.length}…`);
      try {
        const items = await listRecentEpisodes(show, sinceDate);
        all.push(...items);
      } catch (e) {
        console.warn(`Spotify show ${show.name} failed:`, e.message);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  all.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  return all;
}
