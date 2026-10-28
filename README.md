# Nightjar

Nightjar is a private, invitation-only browser workspace with original dark/light styling, an Express/Node backend, SQLite persistence, an owner console, and an optional local Ollama assistant. It has its own branding and does not use Brave logos or artwork.

## Included features

- Browser-like workspace with tabs, HTTP(S) address/search, page titles, navigation, reload/stop, bookmarks, paginated history, recently closed tabs, homepage/search settings, keyboard shortcuts and session preferences. Bare terms and addresses without a recognized domain suffix use the selected search provider.
- Rammerhead-managed in-app browsing through path endpoints on the Nightjar server and port. Each Rammerhead session is bound to an authenticated Nightjar session; outbound destinations are limited to public HTTP(S) hosts on ports 80/443, and private/reserved IP addresses are blocked.
- YouTube watch, Shorts, and live video links open in an in-app embedded player rather than the proxied page, avoiding the proxy media-stream failures seen with long playback. Some videos disable embedding; those can be opened on the original YouTube page.
- Database-backed bookmarks, history, settings, support requests and suggestions. Each account’s permissions are checked server-side.
- A Games page that discovers the HTTPS game catalog from `https://api.bearstool.com/gamelinks`, displays lazy-loaded covers, and fetches selected game HTML into the `/games-player.html` endpoint. Games load without Rammerhead. It also includes an original offline arithmetic sprint; its personal-best score is saved in that browser profile.
- Owner console for accounts, one-time invitations, live sessions, site controls, support requests, audit events and service status. Access is enforced by the server for the separate owner login or the explicitly assigned Owner rank; hiding the console link is only a UI convenience.
- Basic, Basic+, AI, Full- and Owner invitation ranks. Basic and Basic+ share a lifetime allowance of 20 local AI requests per invitation token; AI, Full- and Owner have unlimited AI. Full- and Owner include customization. Owner otherwise has Full- features and is the only invitation rank that grants console access.
- Private project areas per account, with initial `"[account]'s Proxy"` and `"[account]'s games"` areas. Each account can add, rename and remove its own areas; IDs and area contents are never shared across accounts.
- Username-based accounts: each account chooses one unique, case-insensitive username when first signing in. Usernames cannot be changed later. Users can send and accept friend requests and exchange private one-to-one messages with accepted friends.
- A small local **Nightjar Searcher** desktop app with an address/search bar, back/forward/reload/home controls, and Bing, Google, DuckDuckGo, Brave, or Yandex. It renders destination websites directly with Electron's Chromium engine on the user's PC, without a web proxy.
- Invitations are cryptographically random, stored as SHA-256 hashes, and can be redeemed once. A user’s browser then stays authenticated using an HttpOnly, SameSite cookie and a server-side session.
- Optional local AI using Ollama at `127.0.0.1:11434`, default model `qwen3:4b`. With `OLLAMA_AUTOSTART=1`, Nightjar starts the fixed `ollama serve` executable with `shell: false` if no local API is already responding. The app-managed server is loopback-only and uses `OLLAMA_NO_CLOUD=1`; Nightjar does not install or download models.
- Separate owner authentication with scrypt password verification, optional TOTP, independent concurrent owner sessions using separate admin cookies, rate limits, CSRF and same-origin checks on mutations, security headers and audit logging.
- The Owner console's separate invitee Friends panel lets the owner issue invitations and remove an invitee-list entry without revoking their account. This is separate from user-to-user friend requests and chat; being listed by the owner does not grant admin access.

## Browser and device boundaries

The application, API, Rammerhead proxy, and game player are served by one Node process and one HTTP listener. The proxy shell is at `/proxy-shell.html`; Rammerhead navigation uses session paths on the same origin; the game player is at `/games-player.html`. To let sites render inside the nested browser frame, the proxy removes upstream `X-Frame-Options` and CSP `frame-ancestors` directives; other CSP directives are retained. Unsupported `zstd` compression is not advertised, and Rammerhead's incompatible optional server-side local-storage sync is disabled; site local storage remains available in the browser. Navigated plain-text documents and top-level audio/video files are displayed inline unless the origin explicitly requests a download. Since proxied and game content now share the Nightjar origin, avoid opening untrusted pages while signed in; separate origins offered stronger isolation. Outbound proxy requests are restricted to public HTTP(S) destinations on ports 80/443; private and reserved IP addresses are denied. This is still a web application, not a native Chromium browser. Some sites, browser policies or unsupported browser APIs may not work exactly as they do in a desktop browser. Downloads are handled by the host browser.

The web application does not control the host browser or access local files. An optional Linux companion is included for use from the owner console on the **same PC**. It binds only to `127.0.0.1` and starts only when manually launched. Pairing is one-click and authorized by the authenticated owner session plus CSRF-protected, short-lived, one-use signed ticket; there is no pairing code. While paired, the owner session is revalidated every 15 seconds and the companion disconnects when that session becomes invalid. Screen sharing and mouse/keyboard input still require separate local terminal approval. It never enables system RDP, changes firewall rules, or provides a shell-command endpoint. The current preview uses repeated screenshots rather than smooth video; input is limited to pointer clicks, an allowlist of navigation keys, and short printable text. Owner-only desktop access is not available to invitation accounts.

On the first sign-in for an account, choose a 3–24 character username containing letters, numbers, or underscores. Usernames are globally unique without regard to case and cannot be changed. Add another account by username from **Friends & chat** on the home page; messages are enabled only after the recipient accepts the request. Messages are private to the two accepted accounts, limited to 2,000 characters, and refreshed automatically while the chat is open. This user social system is separate from the Owner console's invitee Friends list.

Invitation tokens are bearer credentials until first redemption. Single-use tokens prevent reuse after the intended person signs in, but no cookie can determine who receives a token first. Keep invitations private and deliver them only to the intended person. After redemption, the browser does not need the token again: refreshes use the HttpOnly cookie. If that browser session is lost or expires, the owner issues a replacement invitation.

## Nightjar Searcher desktop app

For reliable page rendering on the local computer, install the project dependencies on that computer and run:

```sh
npm ci
npm run searcher
```

The compact desktop window uses Electron's native Chromium renderer to visit websites directly. It does not use Rammerhead, an iframe, a remote browsing service, or Nightjar's invitation session. The selected search engine is remembered on that computer. Bare words and addresses without a recognized domain suffix are searches; recognized domains and explicit HTTP(S) URLs open as websites. `Ctrl+L` focuses the address bar. Each person who wants the desktop app must run it on their own PC; a website cannot remotely launch Chromium on a visitor's device.

This small searcher is intentionally separate from the full web owner console. It provides page navigation and search, not account administration, bookmarks, history synchronization, or the local assistant. Search engines and destination websites receive requests directly from the user's computer and apply their own privacy policies. The existing web workspace remains available for its account and owner features.

## Requirements

- Node.js 22.13 or later (`node:sqlite` is built in).
- npm.
- Optional: Ollama installed locally and the `qwen3:4b` model already available. Nightjar does not download models.

## Local setup

1. Copy `.env.example` to `.env` in the project root. `.env` is a hidden file because its name starts with a dot.
2. Set `ADMIN_INITIAL_PASSWORD` to a unique password of at least 16 characters. It is used only to initialize a new owner database; the app stores a scrypt hash.
3. Optionally set `ADMIN_TOTP_SECRET` before first startup to require an authenticator code. Keep the same secret available on later starts.
4. Install the project dependencies with `npm ci`.
5. Run `npm start` (or `./startup.sh`) and open `http://127.0.0.1:4173`. The command builds the proxy shell and starts the app, API, proxy, and game endpoints on the one configured port. No additional service command is needed.

`npm start` compiles the typed Rammerhead shell and runs every web endpoint on port `4173` (or the configured `PORT`). Keep this process running while using Nightjar. Ollama is started by Nightjar when configured and available; it is not a separate terminal requirement. For a local model that is not installed yet, install it yourself with `ollama pull qwen3:4b`. Set `OLLAMA_AUTOSTART=0` if the app should not start Ollama.

To enable the desktop companion, add a new random 32-byte hex secret to `.env`:

```sh
openssl rand -hex 32
```

Set the output as `DESKTOP_COMPANION_SECRET` and keep it private. The same project `.env` is read by the app and companion. Start Nightjar normally, then run `npm run companion` in a second terminal on the same Linux PC. While signed into `/admin`, open **Sessions** and click **Pair this owner session**; no code entry is needed. When you choose screen sharing or remote input, approve that capability by typing `YES` into the companion terminal. The companion requires Wayland plus the existing `grim`, `ydotool`, and running `ydotoold` executables/services; Nightjar does not install system packages, run them as root, grant device permissions, or start them automatically. Press Ctrl+C in its terminal or use the owner console's **Stop sharing & disconnect** button to end access. If the browser closes or loses its heartbeat, the companion stops after one minute.

The owner panel is at `/admin`. The separately authenticated owner session and an account explicitly assigned the Owner rank can use it; all other account ranks are denied by server-side authorization. Use **Friends** to invite people one at a time and remove them from the list without revoking their account. **Accounts** manages ranks, permissions, features and preferences. **Site controls** can pause user APIs and proxied browsing in maintenance mode, disable new invitations, or disable assistant access; the owner console stays available during maintenance. Create invitations from **Invitations** and copy each token before closing its one-time reveal. The database never stores the raw token.

## Owner terminal commands

When started from an interactive terminal, Nightjar exposes a `nightjar>` prompt in that same `npm start` terminal. Type `help` for the full list. Common commands:

```text
tokens
accounts
ranks
token make "Guest laptop" basic-plus
token make "Study group" basic
token renew <account-id> "Replacement" full-minus
tokens revoke <token-id>
revoke <token-id>
```

`token make [label] [rank]` creates a one-time invitation using a rank. `token renew <account-id> [label] [rank]` issues a replacement for an existing account; get account IDs from `accounts`. You can also renew an invitation in the Owner console, which rotates its token value without ending sessions already established with it. Multiple sessions can be active for one account; revoke them independently from **Sessions**.

Create custom ranks with `ranks create "Study group" --permissions browse,games,support --features games,support`; inspect or remove them with `ranks` and `ranks delete <rank-id>`. `--features` must be included in `--permissions`. Use `quit` or Ctrl+C to stop the server. A standalone CLI is also available through `npm run manage -- help`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Nightjar app bind address. Keep local unless using a properly secured HTTPS deployment. |
| `PORT` | `4173` | Nightjar app port. |
| `APP_ORIGIN` | inferred for local development | Exact public Nightjar origin allowed to embed the proxy shell and game player. Required in production. |
| `NODE_ENV` | `development` | Set to `production` behind HTTPS; production cookies use `Secure`. |
| `DATABASE_PATH` | `./data/nightjar.sqlite` | SQLite database path. |
| `ADMIN_INITIAL_PASSWORD` | unset | Required to initialize a new owner database; minimum 16 characters. |
| `ADMIN_TOTP_SECRET` | unset | Optional base32 RFC 6238 TOTP secret. |
| `OLLAMA_AUTOSTART` | `1` | Start `ollama serve` when the loopback API is unavailable; set `0` to disable. |
| `OLLAMA_MODEL` | `qwen3:4b` | Installed local model used by the assistant. |
| `OLLAMA_BINARY` | search `PATH` | Optional executable path/name for local Ollama. |

`.env` is ignored by Git. `.env.example` contains placeholders only. Remove old `RAMMERHEAD_HOST`, `RAMMERHEAD_PORT`, `RAMMERHEAD_ORIGIN`, `GAME_HOST`, and `GAME_PORT`/`GAME_ORIGIN` settings; the single listener now derives proxy and game endpoints from the current host and port. Do not expose the app or Ollama API directly to the public Internet.

### Reverse-proxy deployment

Use one HTTPS origin such as `https://nightjar.example.com`, with one reverse-proxy/Tunnel route to `http://127.0.0.1:4173`. Set `APP_ORIGIN` to that public origin. Forward WebSocket upgrades to the same listener so Rammerhead works. No extra service ports, ingress hostnames, or processes are needed.

For a Cloudflare Tunnel on the same host, use one ingress rule from the Nightjar hostname to `http://127.0.0.1:4173`. UI, API, proxy, and games endpoints all run on this listener; enable WebSocket support on that route. Nightjar honors Cloudflare's `CF-Visitor` scheme when generating public endpoint URLs. The proxy shell only accepts an embed origin matching the configured `APP_ORIGIN` or the current request host, so confirm the UI host and proxy-shell `appOrigin` are the same public origin. A blocked page inside the browser frame may come from the destination's framing policy or Cloudflare challenge/Access layer; Nightjar cannot bypass destination access controls.

### Separate-domain API UI

The `api-html` directory contains static copies of the browser and owner-console pages. Host those HTML files on a separate HTTPS site; their API-base meta tag and asset URLs are currently set to `https://p-tunnel-encrypted3.bearstool.com/`. Change those values in both HTML files when using another API host. The JavaScript and CSS are served from the API host, which permits wildcard CORS for static assets and API responses.

API-mode pages use non-cookie bearer sessions because wildcard CORS cannot be combined with credentialed cookies. The browser and owner console save their respective session token in local storage on the UI origin, send it in `Authorization: Bearer`, and remove it on sign-out. Sessions remain revocable from the Owner console. API responses use `Access-Control-Allow-Origin: *` and do not allow credentialed cross-origin cookies. Keep the API on HTTPS and only publish the static pages on origins you trust.

For API-mode pages hosted separately, `APP_ORIGIN` must match the UI origin to allow embedding. API, proxy, and game endpoints remain served by the same Nightjar process and listener. Update the static files and `APP_ORIGIN` together when the UI host changes.

On first sign-in, API-mode browser pages also request the account's unique username; existing usernames are preserved when an invitation is renewed.

## Tokens, ranks and sessions

Each invitation allows one successful sign-in at a time; the owner can renew it from the Owner console to rotate its one-time value and permit another sign-in. The server increments its redemption count atomically and creates a server-side session record. The bundled same-origin UI uses an HttpOnly, SameSite cookie; separate-domain API-mode pages use a bearer token in the UI origin's local storage because wildcard CORS cannot use credentialed cookies. The session renews on authenticated requests and expires after 90 days without activity. Invitation expiry controls whether an unused token can be redeemed; it does not end a session that was already established. Revoking an invitation ends sessions created with that invitation. In the owner console, **Redeemed** means the invitation was accepted; it is not the same as a revoked invitation.

Accounts may have multiple active sessions, so signing in on another device does not log out existing browsers. The Owner console lists sessions and can revoke each one independently. If a browser loses its cookie or its session expires, renew the invitation in the Owner console and use the new token to sign in again.

Default ranks and limits are:

| Rank | Features |
|---|---|
| Basic | Search/browse, games and 20 local AI requests per invitation token |
| Basic+ | Search, bookmarks, history, games and 20 local AI requests per invitation token |
| AI | Search, bookmarks, history, games and unlimited local AI |
| Full- | AI features plus settings and complete customization |
| Owner | Full- features plus the owner console |

The Basic AI cap is lifetime and tracked on the invitation token; issuing a replacement token starts that token's allowance over. Custom ranks remain configurable from the Owner console. Built-in ranks cannot be deleted, and custom rank names or grants do not grant owner access. The Owner rank must be selected explicitly when creating or changing an account.

Full- and Owner accounts can change the browser tab title and icon and drag toolbar controls into a per-account order from Settings. Settings and saved layout preferences are not available to lower ranks.

The token dashboard API is `GET /api/owner/dashboard/tokens`, authenticated by the existing HttpOnly `nj_admin` cookie or an explicitly assigned Owner-rank session. It returns masked token IDs, rank, active/revoked/expired status, redemption usage, AI usage and timestamps; raw token values and hashes are never returned. Cross-origin clients should use the bearer-session flow rather than cookies.

Each user's Project areas are private, account-owned organizational labels, not shared files or project source. The initial areas are named from the account label (for example, `Alex's Proxy` and `Alex's games`). Every user's CRUD API operation is scoped server-side to the signed-in account.

## Support, suggestions and games

Users with the support capability can send a request or suggestion from the in-app Help guide. Messages are stored in the Nightjar database and shown only in the owner’s **Support & ideas** panel; they are not emailed or sent to a third party. The owner can mark them open, in progress or resolved.

The **Games** button opens a new Nightjar tab at `nightjar://games`; each selected game opens in its own tab at `nightjar://games/<id>`. The catalog comes from the HTTPS URL returned by `https://api.bearstool.com/gamelinks`; the browser fetches game HTML directly, preserves an existing `<base>` URL or adds one for relative assets, then writes the HTML into a sandboxed local player. Games do not use Rammerhead; cross-origin requests depend on the catalog service allowing browser access. The page also offers the original 60-second arithmetic sprint, which works locally and keeps only its personal-best score in that browser profile.

## Database, migrations and recovery

Nightjar creates the SQLite schema, enables foreign keys/WAL and records migrations in `schema_migrations` (currently versions 1–9). The database contains account data, token hashes, sessions, history, bookmarks, ranks, site controls, feedback and owner audit events; assistant chat text is not persisted.

For a consistent backup, stop Nightjar first, then securely copy the database file and preserve the owner configuration separately. Backups contain private browsing history, support messages and audit data; encrypt and restrict access. Restore by stopping the service and replacing the database before restarting. Verify the owner password/TOTP configuration against the restored database. There is no self-service owner password reset in this release.

## Tests and troubleshooting

Run:

```sh
npm test
```

The tests use a temporary SQLite database and mock local Ollama responses; they do not download a model or generate model output. They cover Owner-rank authorization and dashboard CORS/secrecy, owner invitee-list isolation, username claims and uniqueness, friend request and direct-message privacy, private project areas, token-scoped Basic AI quotas, customization permissions, rank migrations, token hashing/one-time redemption, sessions, proxy isolation, bookmarks/history/settings, and TOTP.

- **Port already in use:** another Nightjar instance may already be running. Do not start a second copy; stop the existing instance from its own terminal or change `PORT`.
- **Rammerhead page does not open:** confirm the Nightjar listener is reachable and the reverse proxy forwards WebSocket upgrades. Proxy requests use the same host and port as the UI. Some sites remain incompatible with web-based proxying.
- **Cloudflare Tunnel reports blocked content in a proxied page:** check that its single ingress forwards to the Nightjar listener and supports WebSockets. A challenge or block page returned by the destination is controlled by that site and cannot be bypassed by Nightjar.
- **Game player does not open:** confirm the Nightjar listener is reachable and the `/games-player.html` endpoint is not blocked by the reverse proxy.
- **Invitation is rejected:** check expiry/revocation/redemption status in the Owner console. A redeemed token cannot sign in again; issue a replacement for the existing account.
- **Session was revoked or expired:** check the Owner console's Sessions panel. Sessions can be independently revoked and expire after 90 days without activity; renew the invitation if the browser needs to sign in again.
- **Support is missing:** the account rank may not include that capability; the owner can issue a replacement invitation with a suitable rank.
- **Assistant unavailable:** verify Ollama is installed, its loopback port is available and the selected model is installed. `OLLAMA_AUTOSTART=0` leaves process management to the operator.
- **Owner initialization fails:** set a 16-character-or-longer `ADMIN_INITIAL_PASSWORD` and verify the database path is writable. The variable is needed only when creating an empty database.
