<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/4c962324-3065-4d92-a792-9d30a971bec4

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Schwab Developer Setup

This app now uses a real Schwab developer OAuth flow for broker linking.

Required environment variables:

- `SCHWAB_CLIENT_ID`
- `SCHWAB_CLIENT_SECRET`
- `SCHWAB_REDIRECT_URI`

For local development, set:

- `SCHWAB_REDIRECT_URI=http://localhost:3001/api/schwab/callback`

Flow summary:

1. Create a Schwab developer application in the Schwab developer portal.
2. Configure the redirect URI to match `SCHWAB_REDIRECT_URI`.
3. Start the app on port `3001`.
4. Use the `LINK SCHWAB` control in the UI to begin OAuth.
5. After Schwab redirects back to the callback route, the server exchanges the authorization code, stores the refresh token locally, and syncs account balances and positions.

Notes:

- The previous Angel One-style credential flow is no longer used for Schwab.
- If `/api/schwab/auth-url` returns a missing-environment-variable error, the Schwab developer credentials are not configured yet.
# tradeedge_wallstreet
# tradeedge_wallstreet
# tradeedge_wallstreet
# tradeedge_wallstreet
