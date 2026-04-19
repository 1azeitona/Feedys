// -------------------------------------------------------------------------
//  ui.js — Rendering + event handling for the feed screen.
// -------------------------------------------------------------------------

import {
  isSeen,
  isHidden,
  toggleSeen,
  toggleHidden,
} from "./storage.js";
import { CONFIG } from "../config.js";

const $ = (sel) => document.querySelector(sel);

// ----------------------------------------------------------------- Time
function timeAgo(iso) {
  const then = new Date(iso);
  const sec = Math.max(0, (Date.now() - then.getTime()) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDuration(ms) {
  if (!ms) return null;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

// ----------------------------------------------------------------- Escape
function esc(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ----------------------------------------------------------------- Render
export function renderFeed(items, source) {
  const ul = $(`#items-${source}`);
  ul.innerHTML = "";

  const isShort = (it) => /#shorts\b/i.test(it.title || "");
  const visible = items.filter(
    (it) =>
      !isHidden(source, it.id) &&
      !(source === "youtube" && CONFIG.hideShorts && isShort(it))
  );
  $(`#feed-meta`).textContent = buildMeta(items, visible, source);

  if (!visible.length) {
    $("#empty-state").classList.remove("hidden");
    return;
  }
  $("#empty-state").classList.add("hidden");

  const frag = document.createDocumentFragment();
  for (const item of visible) frag.appendChild(renderItem(item));
  ul.appendChild(frag);
}

function buildMeta(all, visible, source) {
  const total = all.length;
  const shown = visible.length;
  const seenCount = visible.filter((i) => isSeen(source, i.id)).length;
  const src = source === "youtube" ? "videos" : "episodes";
  return `${shown} ${src} · ${seenCount} seen · ${total - shown} hidden`;
}

function renderItem(item) {
  const li = document.createElement("li");
  li.className = "item" + (isSeen(item.source, item.id) ? " is-seen" : "");
  li.dataset.id = item.id;
  li.dataset.source = item.source;

  const duration = formatDuration(item.durationMs);
  const sourceLabel = item.source === "youtube" ? "YouTube" : "Spotify";

  li.innerHTML = `
    <a class="item-thumb" href="${esc(item.url)}" target="_blank" rel="noopener">
      ${item.thumb ? `<img src="${esc(item.thumb)}" alt="" loading="lazy">` : ""}
    </a>
    <div class="item-body">
      <div class="item-meta">
        <span class="source-${item.source}">${sourceLabel}</span>
        <span>${timeAgo(item.publishedAt)}</span>
        ${duration ? `<span>${duration}</span>` : ""}
      </div>
      <h3 class="item-title">
        <a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a>
      </h3>
      <p class="item-channel">${esc(item.channelTitle || "")}</p>
      ${item.description ? `<p class="item-description">${esc(item.description)}</p>` : ""}
    </div>
    <div class="item-actions">
      <button class="action-btn act-seen ${isSeen(item.source, item.id) ? "is-on" : ""}"
              data-act="seen">
        ${isSeen(item.source, item.id) ? "✓ Seen" : "Mark seen"}
      </button>
      <button class="action-btn act-hide" data-act="hide">Hide</button>
    </div>
  `;

  li.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    handleAction(btn.dataset.act, item, li);
  });

  return li;
}

function handleAction(act, item, li) {
  if (act === "seen") {
    toggleSeen(item.source, item.id);
    const on = isSeen(item.source, item.id);
    li.classList.toggle("is-seen", on);
    const b = li.querySelector(".act-seen");
    b.classList.toggle("is-on", on);
    b.textContent = on ? "✓ Seen" : "Mark seen";
  } else if (act === "hide") {
    toggleHidden(item.source, item.id);
    li.style.transition = "opacity .2s ease, transform .2s ease";
    li.style.opacity = "0";
    li.style.transform = "translateX(-8px)";
    setTimeout(() => li.remove(), 200);
  }
}

// ----------------------------------------------------------------- Tabs
export function bindTabs(onChange) {
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach((t) => {
    t.addEventListener("click", () => {
      tabs.forEach((x) => x.setAttribute("aria-selected", x === t ? "true" : "false"));
      const name = t.dataset.tab;
      document.querySelectorAll(".items").forEach((ul) => ul.classList.add("hidden"));
      document.getElementById(`items-${name}`).classList.remove("hidden");
      document.querySelectorAll("[data-title]").forEach((h) => {
        h.classList.toggle("hidden", h.dataset.title !== name);
      });
      onChange?.(name);
    });
  });
}

export function setTabCount(source, count) {
  const el = document.querySelector(`[data-count="${source}"]`);
  if (el) el.textContent = count;
}

// ----------------------------------------------------------------- Loader / toast
export function showLoader(msg = "Loading…") {
  $("#loader-text").textContent = msg;
  $("#loader").classList.remove("hidden");
}
export function updateLoader(msg) { $("#loader-text").textContent = msg; }
export function hideLoader() { $("#loader").classList.add("hidden"); }

let toastTimer;
export function toast(msg, ms = 2600) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), ms);
}
