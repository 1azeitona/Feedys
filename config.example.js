// -------------------------------------------------------------------------
//  CONFIG — rename this file to `config.js` and fill in your Client IDs.
//  Neither of these are secrets (we use PKCE + public-client flow), so it's
//  safe to commit `config.js` to a public GitHub Pages repo.
// -------------------------------------------------------------------------

export const CONFIG = {
  youtube: {
    // Google Cloud Console → OAuth 2.0 Client ID (Application type: Web).
    // Authorized redirect URIs must include:
    //   - http://localhost:5173           (for local testing)
    //   - https://<your-username>.github.io/<your-repo>/   (for GH Pages)
    clientId: "YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com",
    scopes: ["https://www.googleapis.com/auth/youtube.readonly"],
  },

  spotify: {
    // Spotify Developer Dashboard → Create an App.
    // Redirect URIs must match the same ones as above.
    clientId: "YOUR_SPOTIFY_CLIENT_ID",
    scopes: ["user-follow-read", "user-library-read", "user-read-playback-position"],
  },

  // How many days back to fetch.
  daysToShow: 30,

  // Name of the gist file that stores your state. Don't change after first run.
  gistFilename: "yt-spotify-feed-state.json",
  gistDescription: "yt-spotify-feed state (private)",
};
