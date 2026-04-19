# yt-spotify-feed

A minimal, static web app that unifies your **YouTube subscriptions** and your **Spotify followed podcasts** into a single feed of the last 30 days. No ads, no tracking, no backend. Everything runs in your browser, and your "seen / hidden" state syncs across devices through a **private GitHub Gist**.

- **Stack**: vanilla JS + HTML + CSS (no build step, no dependencies)
- **Hosting**: GitHub Pages (or any static host; `localhost` works too)
- **Playback**: tapping an item opens the official YouTube / Spotify page
- **Privacy**: browser ↔ Google, Spotify, GitHub only

---

## Setup (one-time, ~15 minutes)

### 1. Fork / clone this repo

```bash
git clone https://github.com/<you>/yt-spotify-feed.git
cd yt-spotify-feed
cp config.example.js config.js
```

### 2. Enable GitHub Pages

In the repo settings → **Pages** → deploy from branch `main` / root (`/`). Wait a minute and note the resulting URL, e.g. `https://<you>.github.io/yt-spotify-feed/`.

### 3. Create Google OAuth credentials (for YouTube)

1. Open <https://console.cloud.google.com/>.
2. Create a new project (any name).
3. Enable the **YouTube Data API v3** under *APIs & Services → Library*.
4. *APIs & Services → OAuth consent screen*:
   - User type: **External**, app name: anything.
   - In **Test users**, add your own Google email (so you can use the app while it's in "testing" mode — no need to submit it for verification).
5. *APIs & Services → Credentials → Create Credentials → OAuth client ID*:
   - Application type: **Web application**.
   - **Authorized JavaScript origins**: `http://localhost:5173` and `https://<you>.github.io`
   - **Authorized redirect URIs**: `http://localhost:5173/` and `https://<you>.github.io/yt-spotify-feed/` (trailing slash matters).
6. Copy the **Client ID** into `config.js` → `youtube.clientId`.

### 4. Create Spotify credentials

1. Open <https://developer.spotify.com/dashboard>, log in, **Create an App**.
2. Under **Redirect URIs**, add:
   - `http://localhost:5173/`
   - `https://<you>.github.io/yt-spotify-feed/`
3. Under **APIs used**, tick **Web API**.
4. Save. Copy the **Client ID** into `config.js` → `spotify.clientId`.

### 5. Create a GitHub Personal Access Token

This is for the private gist that holds your state (seen / hidden lists).

1. Go to <https://github.com/settings/tokens/new?scopes=gist&description=yt-spotify-feed>.
2. Only the **`gist`** scope needs to be checked.
3. Expiration: your call. If you set one, you'll re-paste the new token when it expires.
4. **Copy the token** — you'll paste it into the app on first run.

### 6. Commit and push `config.js`

The Client IDs are **not** secrets (PKCE flow is designed for public clients), so committing them is safe.

```bash
git add config.js
git commit -m "Add client IDs"
git push
```

Your GH Pages URL should now serve the app.

---

## First run

Open the app (local or deployed). You'll see a three-step setup:

1. Paste the **GitHub PAT**.
2. Click **Connect YouTube** — you'll be redirected to Google, approve the read-only YouTube scope, and be sent back.
3. Click **Connect Spotify** — same thing.
4. Click **Enter feed →**.

The app then fetches your subscriptions / followed shows, pulls the last 30 days, and renders two tabs (YouTube / Spotify). Your state saves automatically to the private gist and syncs to any other device where you paste the same PAT.

---

## Running locally

Because we use ES modules, you need a tiny HTTP server (not `file://`):

```bash
# pick one
python3 -m http.server 5173
# or
npx serve -l 5173
```

Then open <http://localhost:5173>. You'll need `http://localhost:5173/` in the redirect URIs of both OAuth apps (already covered above).

---

## Keyboard / debug

- `↻` in the top bar refreshes.
- `⚙` reopens the setup screen (to reconnect or change your PAT).
- From the browser console: `__ytspf.reset()` wipes all local data (not the gist).

---

## Files

```
index.html                  — shell + initial DOM
style.css                   — editorial dark theme
config.example.js           — template; copy to config.js
src/main.js                 — bootstrap + orchestration
src/auth.js                 — OAuth 2.0 + PKCE (both providers)
src/youtube.js              — YouTube Data API v3 wrapper
src/spotify.js              — Spotify Web API wrapper
src/storage.js              — GitHub Gist + localStorage cache
src/ui.js                   — rendering + interactions
```

---

## Known limits

- **YouTube API daily quota**: 10,000 units/day by default. A typical full refresh (100 channels) uses ~300–500 units, so you're fine unless you refresh constantly.
- **Spotify podcast availability**: episodes may be hidden depending on the market of your account — the app requests `market=from_token` but region-locked content can still be absent.
- **Token expiration**: access tokens refresh automatically. If the refresh token is revoked (e.g. you changed your Google password), the app prompts you to reconnect.
- **Gist writes**: every change is debounced 1.5s before a PATCH; closing the tab instantly after a click may occasionally lose the last mutation (next refresh will catch up from the authoritative source, so it's rare to notice).

---

## License

Do whatever you want with it. Personal project.
