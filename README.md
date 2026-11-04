# Luma

Luma is a browser workspace with free Basic accounts, higher ranks provisioned by owner-issued invitation tokens, original dark/light styling, an Express/Node backend, SQLite persistence, an owner console, and an optional local Ollama assistant. The app uses its own white and sky-blue proxy artwork.

## Included features

- Browser-like workspace with tabs, HTTP(S) address/search, page titles, navigation, reload/stop, bookmarks, paginated history, recently closed tabs, homepage/search settings, keyboard shortcuts and session preferences. Bare terms and addresses without a recognized domain suffix use the selected search provider.
- Rammerhead-managed in-app browsing through a **separate origin and server port**. The main application and account cookies stay on the Luma origin. Each Rammerhead session is bound to an authenticated Luma session; outbound destinations are limited to public HTTP(S) hosts on ports 80/443, and private/reserved IP addresses are blocked.
- Database-backed bookmarks, history, settings, support requests and suggestions. Each account’s permissions are checked server-side.
- Free Basic account signup with email/password login; higher ranks also retain the existing owner-issued one-time token login. Email addresses are not verified and there is no self-service password reset.
- Account-isolated notes and file storage, private account-to-account chat for owner-approved friends, and private bug, support, suggestion and report flows. Uploads are stored in the local SQLite database, limited to 1 MB per file and 10 MB per account; this is not third-party cloud storage.
- A rank store listing Basic, Full, Standard, With AI and Without AI. Basic is free. The store can submit an upgrade request, but there is no payment processor or checkout configured and no payment is collected.
- Optional Resend email notifications for feedback and rank requests. Delivery requires `RESEND_API_KEY`, `EMAIL_FROM` and `FEEDBACK_EMAIL`; credentials remain server-side.
- A polished Game lounge that opens the current GN Math site (`gn-math.dev`) in a fresh Rammerhead-managed Luma tab, plus an original offline arithmetic sprint. The sprint sends no game data to the server; its personal-best score is saved in that browser profile.
- Owner console for accounts, one-time invitations, live sessions, site controls, support requests, audit events and service status. Access is enforced by the server for the separate owner login or the explicitly assigned Owner rank; hiding the console link is only a UI convenience.
- The five listed ranks are Basic, Full, Standard, With AI and Without AI. Legacy rank IDs (including the special Owner authorization) remain stored and accepted for compatibility but are omitted from rank listings. Only the separate Owner authentication or an existing explicitly authorized Owner account can access the owner console.
- Private project areas per account, with initial `"[account]'s Proxy"` and `"[account]'s games"` areas. Each account can add, rename and remove its own areas; IDs and area contents are never shared across accounts.
- A small local **Luma Searcher** desktop app with an address/search bar, back/forward/reload/home controls, and Bing, Google, DuckDuckGo, Brave, or Yandex. It renders destination websites directly with Electron's Chromium engine on the user's PC, without a web proxy.
- Invitations are cryptographically random, stored as SHA-256 hashes, and can be redeemed once. A user’s browser then stays authenticated using an HttpOnly, SameSite cookie and a server-side session.
- Optional local AI using Ollama at `127.0.0.1:11434`, default model `qwen3:4b`. With `OLLAMA_AUTOSTART=1`, Luma starts the fixed `ollama serve` executable with `shell: false` if no local API is already responding. The app-managed server is loopback-only and uses `OLLAMA_NO_CLOUD=1`; Luma does not install or download models.
- Separate owner authentication with scrypt password verification, optional TOTP, independent concurrent owner sessions using separate admin cookies, rate limits, CSRF and same-origin checks on mutations, security headers and audit logging.
- A Friends panel lets the owner add invitees one at a time, review them and remove a friend-list entry without revoking their account. Friends use their selected regular rank; adding a friend does not grant admin access.

## Browser and device boundaries

Rammerhead runs proxied pages on its own origin, separate from Luma's account origin. Outbound requests are restricted to public HTTP(S) destinations on ports 80/443; private and reserved IP ranges are denied. This is still a web application, not a native Chromium browser. Some sites, browser policies or unsupported browser APIs may not work exactly as they do in a desktop browser. Downloads are handled by the host browser.

The web application does not control the host browser or access local files. An optional Linux companion can share and control its own desktop through the Luma owner console, including when the owner console is opened on another device. The companion is manually started on the Linux PC and makes an authenticated outbound HTTPS connection to the configured Luma site; it does not listen on a public or LAN interface. Pairing requires an authenticated Owner session, and screen sharing and mouse/keyboard input each require separate approval in the companion terminal. The relay is memory-only, expires when owner heartbeats or the companion connection stop, and accepts no arbitrary shell commands. The preview uses repeated screenshots rather than smooth video; input is limited to pointer actions, an allowlist of navigation keys, and short printable text. Owner-only desktop access is not available to invitation accounts.

While sharing is active, the owner can open **Open one-time desktop tab** to get a separate interactive viewer. The server issues a 60-second launch ticket bound to the requesting owner session and consumes it on first page load; the owner session is also required, so a URL alone cannot open the viewer and a used or expired URL cannot be reopened. Desktop frames and approved input are relayed through the Luma HTTPS origin and are not stored. Opening the viewer does not ask for the initial password again, but it does require the already-authenticated owner session. `ADMIN_INITIAL_PASSWORD` only initializes a new database; changing it after setup does not change the existing owner password.

## Linux prerequisites

The optional companion currently requires a Linux Wayland session and the `grim` and `ydotool` tools, with `ydotoold` already running and usable by the signed-in desktop user. The app does not install system packages or elevate privileges. Configure `DESKTOP_COMPANION_SECRET` and the public HTTPS `APP_ORIGIN` as described below, install the Node project dependencies on the companion PC, then run `npm run companion` and approve sharing/input locally when prompted.

Invitation tokens are bearer credentials until first redemption. Single-use tokens prevent reuse after the intended person signs in, but no cookie can determine who receives a token first. Keep invitations private and deliver them only to the intended person. After redemption, the browser does not need the token again: refreshes use the HttpOnly cookie. If that browser session is lost or expires, the owner issues a replacement invitation.

## Luma Searcher desktop app

For reliable page rendering on the local computer, install the project dependencies on that computer and run:

```sh
npm ci
npm run searcher
```

The compact desktop window uses Electron's native Chromium renderer to visit websites directly. It does not use Rammerhead, an iframe, a remote browsing service, or Luma's invitation session. The selected search engine is remembered on that computer. Bare words and addresses without a recognized domain suffix are searches; recognized domains and explicit HTTP(S) URLs open as websites. `Ctrl+L` focuses the address bar. Each person who wants the desktop app must run it on their own PC; a website cannot remotely launch Chromium on a visitor's device.

This small searcher is intentionally separate from the full web owner console. It provides page navigation and search, not account administration, bookmarks, history synchronization, or the local assistant. Search engines and destination websites receive requests directly from the user's computer and apply their own privacy policies. The existing web workspace remains available for its account and owner features.

## Requirements

- Node.js 22.13 or later (`node:sqlite` is built in).
- npm.
- Optional: Ollama installed locally and the `qwen3:4b` model already available. Luma does not download models.

## Local setup

1. Copy `.env.example` to `.env` in the project root. `.env` is a hidden file because its name starts with a dot.
2. Set `ADMIN_INITIAL_PASSWORD` to a unique password of at least 16 characters. It is used only to initialize a new owner database; the app stores a scrypt hash.
3. Optionally set `ADMIN_TOTP_SECRET` before first startup to require an authenticator code. Keep the same secret available on later starts.
4. Install the project dependencies with `npm ci`.
5. Run `npm start` and open `http://127.0.0.1:4173`.

### Updating an existing checkout

After fetching and switching to the published Luma branch, run `npm ci` from the repository root before `npm start`. This installs the exact dependencies recorded in `package-lock.json`, including Rammerhead; pulling source changes alone does not install Node modules.

`npm start` compiles the typed Rammerhead shell and runs both local listeners in one process: the Luma app on port `4173` and the Rammerhead service on `4174`. Keep both running. Ollama is started by Luma when configured and available; it is not a separate terminal requirement. For a local model that is not installed yet, install it yourself with `ollama pull qwen3:4b`. Set `OLLAMA_AUTOSTART=0` if the app should not start Ollama.

To enable the desktop companion, generate a random 32-byte hex secret on a trusted machine:

```sh
openssl rand -hex 32
```

Set that same value as `DESKTOP_COMPANION_SECRET` independently in the hosted Luma server's secret configuration and the Linux PC's local `.env`; never send it through chat or copy other server secrets to the PC. Set `APP_ORIGIN=https://eri.hs.vc` in the Linux PC's `.env`. The hosted server must also use that exact public HTTPS origin for its normal `APP_ORIGIN` configuration. The companion PC needs only those two settings. Start Luma normally, then run `npm run companion` on the Linux PC. While signed into `/admin`, open **Sessions** and click **Pair this owner session**; no pairing code is used. When you choose screen sharing or remote input, approve that capability by typing `YES` into the companion terminal. The companion requires Wayland plus the existing `grim`, `ydotool`, and running `ydotoold` executables/services; Luma does not install system packages, run them as root, grant device permissions, or start them automatically. Press Ctrl+C in its terminal or use the owner console's **Stop sharing & disconnect** button to end access. If the owner signs out, the owner session expires or is revoked, the browser closes, or its heartbeat is lost, the relay ends. Configure any reverse proxy in front of Luma to accept request bodies up to 8 MB for desktop frame uploads.

The owner panel is at `/admin`. The separately authenticated owner session and an account explicitly assigned the Owner rank can use it; all other account ranks are denied by server-side authorization. The owner password used for sign-in is the password stored when the database was initialized; setting `ADMIN_INITIAL_PASSWORD` later does not reset it. The desktop viewer uses the active owner session and never asks for that password a second time. Use **Friends** to invite people one at a time and remove them from the list without revoking their account. **Accounts** manages ranks, permissions, features and preferences. **Site controls** can pause user APIs and proxied browsing in maintenance mode, disable new invitations, or disable assistant access; the owner console stays available during maintenance. Create invitations from **Invitations** and copy each token before closing its one-time reveal. The database never stores the raw token.

## Owner terminal commands

When started from an interactive terminal, Luma exposes a `nightjar>` compatibility prompt in that same `npm start` terminal. Type `help` for the full list. Common commands:

```text
tokens
accounts
ranks
token make "Guest laptop" standard
token make "Study group" basic
token renew <account-id> "Replacement" full
tokens revoke <token-id>
revoke <token-id>
```

`token make [label] [rank]` creates a one-time invitation using a rank. `token renew <account-id> [label] [rank]` issues a replacement for an existing account; get account IDs from `accounts`. You can also use the Owner console to create an invitation for an existing account. The user must redeem a replacement only after their old session has ended—trying a second valid invitation while an account is signed in triggers the single-session protection and revokes that account’s invitations.

Create custom ranks with `ranks create "Study group" --permissions browse,games,support --features games,support`; inspect or remove them with `ranks` and `ranks delete <rank-id>`. `--features` must be included in `--permissions`. Use `quit` or Ctrl+C to stop the server. A standalone CLI is also available through `npm run manage -- help`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Luma app bind address. Keep local unless using a properly secured HTTPS deployment. |
| `PORT` | `4173` | Luma app port. |
| `RAMMERHEAD_HOST` | `127.0.0.1` | Rammerhead bind address. |
| `RAMMERHEAD_PORT` | `4174` | Rammerhead service port. |
| `APP_ORIGIN` | inferred for local development | Exact public Luma origin allowed to embed the Rammerhead shell. Required in production. |
| `RAMMERHEAD_ORIGIN` | local origin from host/port | Exact public Rammerhead origin, with no path. Required in production. It must be different from `APP_ORIGIN`. |
| `NODE_ENV` | `development` | Set to `production` behind HTTPS; production cookies use `Secure`. |
| `DATABASE_PATH` | `./data/nightjar.sqlite` | SQLite database path. |
| `DASHBOARD_ORIGINS` | unset | Optional comma-separated exact dashboard origins allowed to make credentialed cross-origin token-dashboard requests. No wildcard; production origins must be HTTPS. |
| `ADMIN_INITIAL_PASSWORD` | unset | Required to initialize a new owner database; minimum 16 characters. |
| `ADMIN_TOTP_SECRET` | unset | Optional base32 RFC 6238 TOTP secret. |
| `OLLAMA_AUTOSTART` | `1` | Start `ollama serve` when the loopback API is unavailable; set `0` to disable. |
| `OLLAMA_MODEL` | `qwen3:4b` | Installed local model used by the assistant. |
| `OLLAMA_BINARY` | search `PATH` | Optional executable path/name for local Ollama. |
| `RESEND_API_KEY` | unset | Optional server-side Resend API key for email notifications. |
| `EMAIL_FROM` | unset | Verified sender address for Resend. |
| `FEEDBACK_EMAIL` | unset | Owner email address that receives feedback/rank request notifications. |

`.env` is ignored by Git. `.env.example` contains placeholders only. `SCRAMJET_HOST`, `SCRAMJET_PORT`, and `SCRAMJET_ORIGIN` remain accepted as legacy aliases. Do not expose the app, Rammerhead server or Ollama API directly to the public Internet.

### Reverse-proxy deployment

Use the provided `Caddyfile` to serve the app at `https://example.com` and Rammerhead at `https://proxy.example.com`. They share one registered base domain but remain separate browser origins; do not combine them under one hostname/path because untrusted proxied pages must not share Luma's account origin. Caddy handles TLS certificates, WebSocket upgrades, and proxy streaming. Set `APP_ORIGIN=https://example.com` and `RAMMERHEAD_ORIGIN=https://proxy.example.com` in the app environment, and keep both Node listeners bound to loopback.

Before deploying, create DNS A/AAAA records for both `example.com` and `proxy.example.com` pointing to the Caddy host, and allow inbound TCP ports 80 and 443 (UDP 443 is optional for HTTP/3). Install Caddy using its official package for your OS, set `APP_DOMAIN=example.com` in the Caddy service environment, and install this repository's Caddyfile as its configuration. Validate and run it with:

```sh
APP_DOMAIN=example.com caddy validate --config ./Caddyfile --adapter caddyfile
APP_DOMAIN=example.com caddy run --config ./Caddyfile --adapter caddyfile
```

For a systemd-managed Caddy service, persist `APP_DOMAIN` in a systemd service override or environment file; shell variables from Luma's `.env` are not automatically inherited by Caddy. Then start Luma with `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=4173`, `RAMMERHEAD_HOST=127.0.0.1`, `RAMMERHEAD_PORT=4174`, and the two public origins above. This repository configures the app but does not provision DNS, obtain certificates, or change the host's Caddy installation. The local defaults are for single-machine development only.

### Amazon S3 and Jellyfin

Luma's current storage feature uses account-isolated SQLite files on the app server; it does not upload to Amazon S3. No S3 browser CORS policy is added. A server-side S3 integration would need the bucket name, AWS region, private server credentials/IAM permissions, and a requested upload limit; direct browser-to-S3 uploads would additionally require a narrowly scoped bucket CORS policy allowing only the Luma app origin, never the Rammerhead proxy origin.

There is no Jellyfin integration or CORS proxy configured. To connect it safely would require a reachable HTTPS Jellyfin base URL, a scoped Jellyfin API credential, and the intended media feature; CORS must be configured on Jellyfin for the exact Luma app origin. Do not add wildcard CORS or expose Jellyfin credentials to proxied sites. The app does not configure a remote S3 bucket or Jellyfin server.

## Tokens, ranks and sessions

Each invitation allows exactly one successful sign-in. The server increments its redemption count atomically, then issues an HttpOnly, SameSite cookie backed by a server-side session record. The cookie persists through normal application requests and does not require the token again. Sessions expire after 12 hours of inactivity or 12 hours total. In the owner console, **Redeemed · session cookie** means the invitation was accepted once; it is not the same as a revoked invitation, and the user's browser remains signed in through its cookie.

Each account permits one active session. A second, different valid invitation used while its account is signed in revokes the account’s invitations and terminates the active session; the owner must issue a replacement. This is intentionally strict and may require a replacement when moving to a different browser or device. If the browser's cookie is lost or the 12-hour session expires, the owner can issue a replacement with `token renew <account-id> "Replacement" <rank>`.

Luma's rank listings show exactly these five built-in ranks (legacy rank IDs remain available for existing token compatibility):

| Rank | Features |
|---|---|
| Basic | Free; search/browse, notes, storage, private chat, bug reports and 20 local AI requests per token |
| Standard | Search/browse, bookmarks, history, notes, storage, private chat and bug reports |
| Without AI | Standard features without AI |
| With AI | Standard features with AI |
| Full | Customization, games, support and the listed account features |

Basic signup is free and uses email/password credentials; the address is not verified, and password reset is not available. The Basic AI cap is lifetime and tracked on the associated token; higher ranks can still sign in using owner-issued invitation tokens. The rank store is a request surface only until a payment processor is configured; it does not collect money. Legacy rank records remain in storage and can still be used by existing accounts and tokens, but are omitted from rank listings. Custom ranks remain configurable from the Owner console. Built-in ranks cannot be deleted, and custom rank names or grants do not grant owner access. Owner authorization remains a separate special access path.

Full accounts can change the browser tab title and icon and drag toolbar controls into a per-account order from Settings. Settings and saved layout preferences are not available to lower ranks.

The token dashboard API is `GET /api/owner/dashboard/tokens`, authenticated by the existing HttpOnly `nj_admin` cookie or an explicitly assigned Owner-rank session cookie. It returns masked token IDs, rank, active/revoked/expired status, redemption usage, AI usage and timestamps; raw token values and hashes are never returned. Cross-origin browser access requires a comma-separated exact-origin `DASHBOARD_ORIGINS` allowlist and credentialed CORS without wildcards. Since production owner cookies remain `SameSite=Strict; Secure`, deploy the dashboard same-site with Luma (such as a sibling HTTPS subdomain), or call through a same-origin reverse proxy/BFF; unrelated-site third-party cookies are not supported.

Each user's Project areas are private, account-owned organizational labels, not shared files or project source. The initial areas are named from the account label (for example, `Alex's Proxy` and `Alex's games`). Every user's CRUD API operation is scoped server-side to the signed-in account.

## Support, suggestions and games

Users with the support capability can send a request or suggestion from the in-app Help guide. Messages are stored in the Luma database and shown only in the owner’s **Support & ideas** panel; when Resend is configured, a notification is sent to the configured owner address. The owner can mark them open, in progress or resolved. Bug reports are similarly private and available from the bugs page.

Notes and uploaded files are isolated by account and enforced on every API request. File storage is SQLite on the Luma server, not a third-party cloud service. Chat is limited to accounts the owner has added as friends, and accounts can block or report messages. Reports and ban records appear only in the private owner moderation log; there is no public shaming page, and report subjects are not exposed publicly. Resend configuration is optional and its API key is never sent to browsers.

The **Game lounge** toolbar opens GN Math (`https://gn-math.dev`) in a new tab through the existing separate-origin Rammerhead browsing surface; Luma does not copy or host GN Math game assets. The lounge also offers the original 60-second arithmetic sprint, which works locally and keeps only its personal-best score in that browser profile. GN Math is external web content and remains subject to its availability and compatibility with proxy browsing.

## Database, migrations and recovery

Luma creates the SQLite schema, enables foreign keys/WAL and records migrations in `schema_migrations`. The database contains account data, token hashes, sessions, history, bookmarks, ranks, site controls, feedback, notes, uploaded file contents, chat and owner audit/moderation events.

For a consistent backup, stop Luma first, then securely copy the database file and preserve the owner configuration separately. Backups contain private browsing history, notes, uploaded files, chat, support messages and audit data; encrypt and restrict access. Restore by stopping the service and replacing the database before restarting. Verify the owner password/TOTP configuration against the restored database. There is no self-service owner password reset in this release.

## Tests and troubleshooting

Run:

```sh
npm test
```

The tests use a temporary SQLite database and mock local Ollama responses; they do not download a model or generate model output. They cover Owner-rank authorization and dashboard CORS/secrecy, friend list isolation, private project areas, token-scoped Basic AI quotas, customization permissions, rank migrations, token hashing/one-time redemption, sessions, proxy isolation, bookmarks/history/settings, and TOTP.

- **Port already in use:** another Luma instance may already be running. Do not start a second copy; stop the existing instance from its own terminal or change both `PORT` and `APP_ORIGIN`, and both `RAMMERHEAD_PORT` and `RAMMERHEAD_ORIGIN`.
- **Rammerhead page does not open:** check the Luma log for “Rammerhead browsing engine is ready”, confirm `RAMMERHEAD_PORT` is reachable from the browser, and ensure the app and proxy have distinct origins. Some sites remain incompatible with web-based proxying.
- **Invitation is rejected:** check expiry/revocation/redemption status in the Owner console. A redeemed token cannot sign in again; issue a replacement for the existing account.
- **Account was signed in elsewhere:** another valid invitation was redeemed while its account had a live session. The account’s invitations and session are revoked; issue a new invitation after verifying the intended account/device.
- **Support or games are missing:** the account rank may not include those capabilities; the owner can issue a replacement invitation with a suitable rank.
- **Assistant unavailable:** verify Ollama is installed, its loopback port is available and the selected model is installed. `OLLAMA_AUTOSTART=0` leaves process management to the operator.
- **Owner initialization fails:** set a 16-character-or-longer `ADMIN_INITIAL_PASSWORD` and verify the database path is writable. The variable is needed only when creating an empty database.
