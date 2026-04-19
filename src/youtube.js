// -------------------------------------------------------------------------
//  youtube.js — Fetch recent uploads from subscribed channels.
//  Strategy: list subscriptions → get each channel's uploads playlist →
//             list recent items from each playlist → filter by date.
// -------------------------------------------------------------------------

import { apiFetch } from "./auth.js";
import { CONFIG } from "../config.js";

const API = "https://www.googleapis.com/youtube/v3";

function qs(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null) u.set(k, v);
  }
  return u.toString();
}

// ----------------------------------------------------------------- Subscriptions
async function listSubscriptions() {
  const channels = [];
  let pageToken;
  do {
    const data = await apiFetch(
      "youtube",
      `${API}/subscriptions?${qs({
        part: "snippet",
        mine: "true",
        maxResults: 50,
        order: "alphabetical",
        pageToken,
      })}`
    );
    for (const item of data.items || []) {
      channels.push({
        channelId: item.snippet.resourceId.channelId,
        title: item.snippet.title,
        thumb: item.snippet.thumbnails?.default?.url,
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return channels;
}

// ----------------------------------------------------------------- Uploads playlists
async function getUploadsPlaylists(channelIds) {
  // `channels` endpoint accepts up to 50 IDs per call.
  const map = new Map();
  for (let i = 0; i < channelIds.length; i += 50) {
    const batch = channelIds.slice(i, i + 50);
    const data = await apiFetch(
      "youtube",
      `${API}/channels?${qs({
        part: "contentDetails",
        id: batch.join(","),
        maxResults: 50,
      })}`
    );
    for (const item of data.items || []) {
      const uploads = item.contentDetails?.relatedPlaylists?.uploads;
      if (uploads) map.set(item.id, uploads);
    }
  }
  return map;
}

// ----------------------------------------------------------------- Recent items
async function listRecent(playlistId, sinceDate) {
  const items = [];
  let pageToken;
  let exhausted = false;
  while (!exhausted) {
    const data = await apiFetch(
      "youtube",
      `${API}/playlistItems?${qs({
        part: "snippet,contentDetails",
        playlistId,
        maxResults: 20,
        pageToken,
      })}`
    );
    for (const item of data.items || []) {
      const published = new Date(
        item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt
      );
      if (published < sinceDate) {
        exhausted = true;
        continue;
      }
      items.push(mapVideo(item, published));
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
    // Uploads playlists are reverse-chronological; once we find an older item
    // we stop (even if more pages exist).
    if (exhausted) break;
  }
  return items;
}

function mapVideo(item, published) {
  const sn = item.snippet || {};
  const cd = item.contentDetails || {};
  const videoId = cd.videoId || sn.resourceId?.videoId;
  const thumbs = sn.thumbnails || {};
  const thumb = thumbs.medium?.url || thumbs.default?.url || thumbs.high?.url;
  return {
    id: videoId,
    source: "youtube",
    title: sn.title,
    description: (sn.description || "").slice(0, 220),
    channelId: sn.videoOwnerChannelId || sn.channelId,
    channelTitle: sn.videoOwnerChannelTitle || sn.channelTitle,
    thumb,
    publishedAt: published.toISOString(),
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

// ----------------------------------------------------------------- Public
export async function fetchYouTubeFeed({ onProgress } = {}) {
  const sinceDate = new Date(Date.now() - CONFIG.daysToShow * 86400 * 1000);

  onProgress?.("Fetching subscriptions…");
  const channels = await listSubscriptions();

  onProgress?.(`Resolving ${channels.length} channels…`);
  const uploads = await getUploadsPlaylists(channels.map((c) => c.channelId));

  const all = [];
  let i = 0;
  // Small concurrency to avoid blasting the quota.
  const concurrency = 4;
  const queue = channels.filter((c) => uploads.has(c.channelId));
  async function worker() {
    while (queue.length) {
      const channel = queue.shift();
      i++;
      onProgress?.(`Fetching uploads ${i}/${channels.length}…`);
      try {
        const items = await listRecent(uploads.get(channel.channelId), sinceDate);
        all.push(...items);
      } catch (e) {
        console.warn(`YouTube channel ${channel.title} failed:`, e.message);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  all.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  return all;
}
