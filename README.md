# Nightjar

Nightjar is a private, invitation-only browser workspace with original dark/light styling, an Express/Node backend, SQLite persistence, an owner console, and an optional local Ollama assistant. It has its own branding and does not use Brave logos or artwork.

## Included features

- Browser-like workspace with tabs, HTTP(S) address/search, page titles, navigation, reload/stop, bookmarks, paginated history, recently closed tabs, homepage/search settings, keyboard shortcuts and session preferences. Bare terms and addresses without a recognized domain suffix use the selected search provider.
- Rammerhead-managed in-app browsing through a **separate origin and server port**. The main application and account cookies stay on the Nightjar origin. Each Rammerhead session is bound to an authenticated Nightjar session; outbound destinations are limited to public HTTP(S) hosts on ports 80/443, and private/reserved IP addresses are blocked.
- Database-backed bookmarks, history, settings, support requests and suggestions. Each account’s permissions are checked server-side.
- A polished Game lounge that opens the current GN Math site (`gn-math.dev`) in a fresh Rammerhead-managed Nightjar tab, plus an original offline arithmetic sprint. The sprint sends no game data to the server; its personal-best score is saved in that browser profile.
- Owner console for accounts, one-time invitations, live sessions, site controls, support requests, audit events and service status. Access is enforced by the server for the separate owner login or the explicitly assigned Owner rank; hiding the console link is only a UI convenience.
- Basic, Basic+, AI, Full- and Owner invitation ranks. Basic and Basic+ share a lifetime allowance of 20 local AI requests per invitation token; AI, Full- and Owner have unlimited AI. Full- and Owner include customization. Owner otherwise has Full- features and is the only invitation rank that grants console access.
- Private project areas per account, with initial `"[account]'s Proxy"` and `"[account]'s games"` areas. Each account can add, rename and remove its own areas; IDs and area contents are never shared across accounts.
- A small local **Nightjar Searcher** desktop app with an address/search bar, back/forward/reload/home controls, and Bing, Google, DuckDuckGo, Brave, or Yandex. It renders destination websites directly with Electron's Chromium engine on the user's PC, without a web proxy.
- Invitations are cryptographically random, stored as SHA-256 hashes, and can be redeemed once. A user’s browser then stays authenticated using an HttpOnly, SameSite cookie and a server-side session.
- Optional local AI using Ollama at `127.0.0.1:11434`, default model `qwen3:4b`. With `OLLAMA_AUTOSTART=1`, Nightjar starts the fixed `ollama serve` executable with `shell: false` if no local API is already responding. The app-managed server is loopback-only and uses `OLLAMA_NO_CLOUD=1`; Nightjar does not install or download models.
- Separate owner authentication with scrypt password verification, optional TOTP, independent concurrent owner sessions using separate admin cookies, rate limits, CSRF and same-origin checks on mutations, security headers and audit logging.
- A Friends panel lets the owner add invitees one at a time, review them and remove a friend-list entry without revoking their account. Friends use their selected regular rank; adding a friend does not grant admin access.

## Browser and device boundaries

Rammerhead runs proxied pages on its own origin, separate from Nightjar's account origin. Outbound requests are restricted to public HTTP(S) destinations on ports 80/443; private and reserved IP ranges are denied. This is still a web application, not a native Chromium browser. Some sites, browser policies or unsupported browser APIs may not work exactly as they do in a desktop browser. Downloads are handled by the host browser.

The web application does not control the host browser or access local files. An optional Linux companion is included for use from the owner console on the **same PC**. It binds only to `127.0.0.1` and starts only when manually launched. Pairing is one-click and authorized by the authenticated owner's HttpOnly session cookie plus CSRF-protected, short-lived, one-use signed ticket; there is no pairing code. While paired, the owner session cookie is revalidated every 15 seconds and the companion disconnects when that session becomes invalid. Screen sharing and mouse/keyboard input still require separate local terminal approval. It never enables system RDP, changes firewall rules, or provides a shell-command endpoint. The current preview uses repeated screenshots rather than smooth video; input is limited to pointer clicks, an allowlist of navigation keys, and short printable text. Owner-only desktop access is not available to invitation accounts.

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
5. Run `npm start` and open `http://127.0.0.1:4173`.

`npm start` compiles the typed Rammerhead shell and runs both local listeners in one process: the Nightjar app on port `4173` and the Rammerhead service on `4174`. Keep both running. Ollama is started by Nightjar when configured and available; it is not a separate terminal requirement. For a local model that is not installed yet, install it yourself with `ollama pull qwen3:4b`. Set `OLLAMA_AUTOSTART=0` if the app should not start Ollama.

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

`token make [label] [rank]` creates a one-time invitation using a rank. `token renew <account-id> [label] [rank]` issues a replacement for an existing account; get account IDs from `accounts`. You can also use the Owner console to create an invitation for an existing account. The user must redeem a replacement only after their old session has ended—trying a second valid invitation while an account is signed in triggers the single-session protection and revokes that account’s invitations.

Create custom ranks with `ranks create "Study group" --permissions browse,games,support --features games,support`; inspect or remove them with `ranks` and `ranks delete <rank-id>`. `--features` must be included in `--permissions`. Use `quit` or Ctrl+C to stop the server. A standalone CLI is also available through `npm run manage -- help`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Nightjar app bind address. Keep local unless using a properly secured HTTPS deployment. |
| `PORT` | `4173` | Nightjar app port. |
| `RAMMERHEAD_HOST` | `127.0.0.1` | Rammerhead bind address. |
| `RAMMERHEAD_PORT` | `4174` | Rammerhead service port. |
| `APP_ORIGIN` | inferred for local development | Exact public Nightjar origin allowed to embed the Rammerhead shell. Required in production. |
| `RAMMERHEAD_ORIGIN` | local origin from host/port | Exact public Rammerhead origin, with no path. Required in production. It must be different from `APP_ORIGIN`. |
| `NODE_ENV` | `development` | Set to `production` behind HTTPS; production cookies use `Secure`. |
| `DATABASE_PATH` | `./data/nightjar.sqlite` | SQLite database path. |
| `DASHBOARD_ORIGINS` | unset | Optional comma-separated exact dashboard origins allowed to make credentialed cross-origin token-dashboard requests. No wildcard; production origins must be HTTPS. |
| `ADMIN_INITIAL_PASSWORD` | unset | Required to initialize a new owner database; minimum 16 characters. |
| `ADMIN_TOTP_SECRET` | unset | Optional base32 RFC 6238 TOTP secret. |
| `OLLAMA_AUTOSTART` | `1` | Start `ollama serve` when the loopback API is unavailable; set `0` to disable. |
| `OLLAMA_MODEL` | `qwen3:4b` | Installed local model used by the assistant. |
| `OLLAMA_BINARY` | search `PATH` | Optional executable path/name for local Ollama. |

`.env` is ignored by Git. `.env.example` contains placeholders only. `SCRAMJET_HOST`, `SCRAMJET_PORT`, and `SCRAMJET_ORIGIN` remain accepted as legacy aliases. Do not expose the app, Rammerhead server or Ollama API directly to the public Internet.

### Reverse-proxy deployment

Use two distinct HTTPS origins, such as `https://nightjar.example.com` and `https://browse.example.com`. Set `APP_ORIGIN` and `RAMMERHEAD_ORIGIN` to those exact origins, configure the reverse proxy to forward WebSocket upgrades for the Rammerhead origin, and keep the Rammerhead service inaccessible except through the trusted proxy. Do not put both services behind the same origin: proxied site scripts must not share Nightjar’s account origin. The local defaults are for single-machine development only.

## Tokens, ranks and sessions

Each invitation allows exactly one successful sign-in. The server increments its redemption count atomically, then issues an HttpOnly, SameSite cookie backed by a server-side session record. The cookie persists through normal application requests and does not require the token again. Sessions expire after 12 hours of inactivity or 12 hours total. In the owner console, **Redeemed · session cookie** means the invitation was accepted once; it is not the same as a revoked invitation, and the user's browser remains signed in through its cookie.

Each account permits one active session. A second, different valid invitation used while its account is signed in revokes the account’s invitations and terminates the active session; the owner must issue a replacement. This is intentionally strict and may require a replacement when moving to a different browser or device. If the browser's cookie is lost or the 12-hour session expires, the owner can issue a replacement with `token renew <account-id> "Replacement" <rank>`.

Default ranks and limits are:

| Rank | Features |
|---|---|
| Basic | Search/browse and 20 local AI requests per invitation token |
| Basic+ | Search, bookmarks, history and 20 local AI requests per invitation token |
| AI | Search, bookmarks, history and unlimited local AI |
| Full- | AI features plus settings, complete customization and games |
| Owner | Full- features plus the owner console |

The Basic AI cap is lifetime and tracked on the invitation token; issuing a replacement token starts that token's allowance over. Custom ranks remain configurable from the Owner console. Built-in ranks cannot be deleted, and custom rank names or grants do not grant owner access. The Owner rank must be selected explicitly when creating or changing an account.

Full- and Owner accounts can change the browser tab title and icon and drag toolbar controls into a per-account order from Settings. Settings and saved layout preferences are not available to lower ranks.

The token dashboard API is `GET /api/owner/dashboard/tokens`, authenticated by the existing HttpOnly `nj_admin` cookie or an explicitly assigned Owner-rank session cookie. It returns masked token IDs, rank, active/revoked/expired status, redemption usage, AI usage and timestamps; raw token values and hashes are never returned. Cross-origin browser access requires a comma-separated exact-origin `DASHBOARD_ORIGINS` allowlist and credentialed CORS without wildcards. Since production owner cookies remain `SameSite=Strict; Secure`, deploy the dashboard same-site with Nightjar (such as a sibling HTTPS subdomain), or call through a same-origin reverse proxy/BFF; unrelated-site third-party cookies are not supported.

Each user's Project areas are private, account-owned organizational labels, not shared files or project source. The initial areas are named from the account label (for example, `Alex's Proxy` and `Alex's games`). Every user's CRUD API operation is scoped server-side to the signed-in account.

## Support, suggestions and games

Users with the support capability can send a request or suggestion from the in-app Help guide. Messages are stored in the Nightjar database and shown only in the owner’s **Support & ideas** panel; they are not emailed or sent to a third party. The owner can mark them open, in progress or resolved.

The **Game lounge** toolbar opens GN Math (`https://gn-math.dev`) in a new tab through the existing separate-origin Rammerhead browsing surface; Nightjar does not copy or host GN Math game assets. The lounge also offers the original 60-second arithmetic sprint, which works locally and keeps only its personal-best score in that browser profile. GN Math is external web content and remains subject to its availability and compatibility with proxy browsing.

## Database, migrations and recovery

Nightjar creates the SQLite schema, enables foreign keys/WAL and records migrations in `schema_migrations` (currently versions 1–6). The database contains account data, token hashes, sessions, history, bookmarks, ranks, site controls, feedback and owner audit events; assistant chat text is not persisted.

For a consistent backup, stop Nightjar first, then securely copy the database file and preserve the owner configuration separately. Backups contain private browsing history, support messages and audit data; encrypt and restrict access. Restore by stopping the service and replacing the database before restarting. Verify the owner password/TOTP configuration against the restored database. There is no self-service owner password reset in this release.

## Tests and troubleshooting

Run:

```sh
npm test
```

The tests use a temporary SQLite database and mock local Ollama responses; they do not download a model or generate model output. They cover Owner-rank authorization and dashboard CORS/secrecy, friend list isolation, private project areas, token-scoped Basic AI quotas, customization permissions, rank migrations, token hashing/one-time redemption, sessions, proxy isolation, bookmarks/history/settings, and TOTP.

- **Port already in use:** another Nightjar instance may already be running. Do not start a second copy; stop the existing instance from its own terminal or change both `PORT` and `APP_ORIGIN`, and both `RAMMERHEAD_PORT` and `RAMMERHEAD_ORIGIN`.
- **Rammerhead page does not open:** check the Nightjar log for “Rammerhead browsing engine is ready”, confirm `RAMMERHEAD_PORT` is reachable from the browser, and ensure the app and proxy have distinct origins. Some sites remain incompatible with web-based proxying.
- **Invitation is rejected:** check expiry/revocation/redemption status in the Owner console. A redeemed token cannot sign in again; issue a replacement for the existing account.
- **Account was signed in elsewhere:** another valid invitation was redeemed while its account had a live session. The account’s invitations and session are revoked; issue a new invitation after verifying the intended account/device.
- **Support or games are missing:** the account rank may not include those capabilities; the owner can issue a replacement invitation with a suitable rank.
- **Assistant unavailable:** verify Ollama is installed, its loopback port is available and the selected model is installed. `OLLAMA_AUTOSTART=0` leaves process management to the operator.
- **Owner initialization fails:** set a 16-character-or-longer `ADMIN_INITIAL_PASSWORD` and verify the database path is writable. The variable is needed only when creating an empty database.
