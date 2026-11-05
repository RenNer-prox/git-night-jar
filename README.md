# Luma

Luma is a browser workspace with free Basic accounts, higher ranks provisioned by owner-issued invitation tokens, original dark/light styling, an Express/Node backend, SQLite persistence, an owner console, and an optional local Ollama assistant. The app uses its own white and sky-blue proxy artwork.

## Included features

- Browser-like workspace with tabs, HTTP(S) address/search, page titles, navigation, reload/stop, bookmarks, paginated history, recently closed tabs, homepage/search settings, keyboard shortcuts and session preferences. Bare terms and addresses without a recognized domain suffix use the selected search provider.
- Rammerhead-managed in-app browsing through a **separate origin and server port**. Visitors can start browsing without an invitation; guest sessions are short-lived, IP-bound, rate-limited, and capped for concurrent sessions and sockets. Signing in later with an invitation adopts the current guest proxy session into that account when it is still valid. Account APIs and private data remain authenticated. Outbound destinations are limited to public HTTP(S) hosts on ports 80/443, and private/reserved IP addresses are blocked.
- Database-backed bookmarks, history, settings, support requests and suggestions. Each account’s permissions are checked server-side.
- Free Basic account signup with email/password login; higher ranks use owner-issued, single-use, never-expiring invitations to set their email/password for future logins. Email addresses are not verified and there is no self-service password reset.
- Configurable Roundcube webmail access for signed-in accounts. Roundcube is a separately hosted webmail client with its own mailbox sign-in; it is not an SMTP/IMAP server and Luma does not handle mailbox credentials or contents.
- Account-isolated notes and file storage, private account-to-account chat for owner-approved friends, and private bug, support, suggestion and report flows. Uploads are stored in the local SQLite database, limited to 1 MB per file and 10 MB per account; this is not third-party cloud storage.
- A rank store listing Basic, Basic+, AI, Full- and Owner. Basic is free; higher member ranks can be requested with Visa gift card or cash as the proposed payment method. Requests are stored privately for owner review; payment is verified separately and access is granted only by an owner manually changing the account. Owner administrator access is never available for purchase. There is no checkout or automatic upgrade.
- Optional Resend email notifications for feedback and rank requests. Delivery requires `RESEND_API_KEY`, `EMAIL_FROM` and `FEEDBACK_EMAIL`; credentials remain server-side.
- A polished Game lounge that opens the current GN Math site (`gn-math.dev`) in a fresh Rammerhead-managed Luma tab, plus an original offline arithmetic sprint. The sprint sends no game data to the server; its personal-best score is saved in that browser profile.
- Owner console for accounts, one-time invitations, live sessions, site controls, support requests, audit events and service status. Access is enforced by the server for the separate owner login or the explicitly assigned Owner rank; hiding the console link is only a UI convenience.
- The five listed ranks are Basic, Basic+, AI, Full- and Owner. Legacy rank IDs are migrated to the current tiers; only an explicitly assigned Owner account or the separate Owner authentication can access the owner console.
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

The optional companion currently requires a Linux Wayland session and the `grim` and `ydotool` tools, with `ydotoold` already running and usable by the signed-in desktop user. The app does not install system packages or elevate privileges. Keep the Luma server's `DESKTOP_COMPANION_SECRET` in its owner-only, Git-ignored `.env`; configure the exact same secret in the Linux PC's local `.env`, together with the public HTTPS `APP_ORIGIN`. Never copy the real secret into `.env.example`, source code, or chat. Install the Node project dependencies on the companion PC, then run `npm run companion` and approve sharing/input locally when prompted.

Invitation tokens are bearer credentials until first redemption. They never expire automatically, remain single-use, and can be revoked by the owner at any time. Single-use tokens prevent reuse after the intended person redeems them, but no cookie can determine who receives a token first. Keep invitations private and deliver them only to the intended person. On redemption, the recipient sets an email and password; subsequent sign-ins use those credentials, not the invitation token. If that browser session is lost or expires, the user can sign in with email/password.

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

If startup reports `EADDRINUSE`, another process already owns the requested listener. Luma reports the listener when Linux `ss` is available and exits without terminating it. Inspect the owner with `ss -ltnp 'sport = :4173'` (or `lsof -nP -iTCP:4173 -sTCP:LISTEN`), then either stop/reconfigure that service yourself or choose another port, for example `PORT=4175 npm start`. For a collision on the Rammerhead listener, use `RAMMERHEAD_PORT=4175 npm start`; if using the manual Caddy setup, update the corresponding reverse-proxy upstream too. Port overrides are not needed for the Docker Compose deployment, where the Node listeners are private to its network.

### Automated Docker deployment

For a Linux host with Docker Engine and the Docker Compose plugin, the setup command can generate production settings, build the app image, and start Luma behind Caddy. It does not install Docker/Caddy on the host, edit host firewall or DNS settings, or overwrite your existing database. Choose a registered base domain; Luma and untrusted proxied pages use separate HTTPS origins under that domain:

```sh
npm run setup -- --domain example.com
```

The command creates or updates `.env` with production origins, generates missing bootstrap secrets, sets file permissions to owner-only, validates the Compose configuration, then runs `docker compose up --build -d`. Existing credentials and unrelated settings in `.env` are preserved. When `.env` is first generated, the owner bootstrap password is stored there; retrieve it securely before signing in to `/admin`. `ADMIN_INITIAL_PASSWORD` initializes a new database only and does not reset an existing owner password.

Preview the settings/actions without writing files or starting containers, or validate an existing deployment configuration without changing it:

```sh
npm run setup -- --domain example.com --dry-run
npm run setup -- --check
```

Before starting services, create DNS A/AAAA records for both `example.com` and `proxy.example.com` pointing to the Docker host. Allow inbound TCP ports 80 and 443; UDP 443 is optional for HTTP/3. Caddy obtains and renews certificates after DNS resolves and the ports are reachable. The app and Rammerhead ports are private to the Compose network; only Caddy publishes ports. SQLite data and Caddy certificate state live in named Docker volumes. Back up the `luma_data` volume before host or volume maintenance. To inspect or stop the services, use `docker compose ps` and `docker compose down`; `down` keeps named data volumes unless `--volumes` is explicitly added. The Compose deployment disables Ollama autostart; configure a separately reachable Ollama service if local AI is needed.

The deployment command intentionally does not configure S3 or Jellyfin. Their setup still needs actual provider/server identifiers and credentials; see [Amazon S3 and Jellyfin](#amazon-s3-and-jellyfin). It does not install software or mutate configuration on a remote S3 bucket or Jellyfin server.

To enable the desktop companion, generate a random 32-byte hex secret on a trusted machine and place the same value in the server and companion PC's private `.env` files:

```sh
openssl rand -hex 32
```

Set that same value as `DESKTOP_COMPANION_SECRET` independently in the hosted Luma server's `.env` and the Linux PC's local `.env`; never send it through chat or copy other server secrets to the PC. Set `APP_ORIGIN=https://eri.hs.vc` in the Linux PC's `.env`. The hosted server must also use that exact public HTTPS origin for its normal `APP_ORIGIN` configuration. The companion PC needs only those two settings. Start Luma normally, then run `npm run companion` on the Linux PC. While signed into `/admin`, open **Sessions** and click **Pair this owner session**; no pairing code is used. When you choose screen sharing or remote input, approve that capability by typing `YES` into the companion terminal. The companion requires Wayland plus the existing `grim`, `ydotool`, and running `ydotoold` executables/services; Luma does not install system packages, run them as root, grant device permissions, or start them automatically. Press Ctrl+C in its terminal or use the owner console's **Stop sharing & disconnect** button to end access. If the owner signs out, the owner session expires or is revoked, the browser closes, or its heartbeat is lost, the relay ends. Configure any reverse proxy in front of Luma to accept request bodies up to 8 MB for desktop frame uploads.

The owner panel is at `/admin`. The separately authenticated owner session and an account explicitly assigned the Owner rank can use it; all other account ranks are denied by server-side authorization. The owner password used for sign-in is the password stored when the database was initialized; setting `ADMIN_INITIAL_PASSWORD` later does not reset it. At sign-in, select **Keep me signed in for 30 days on this device** to use a longer-lived, HttpOnly admin session cookie on a private device; otherwise the admin session lasts 12 hours. Sign out to revoke the active owner session, and do not select the option on a shared or public computer. This does not disable authentication or extend regular user sessions. The desktop viewer uses the active owner session and never asks for that password a second time. Use **Friends** to invite people one at a time and remove them from the list without revoking their account. **Accounts** manages ranks, permissions, features and preferences. **Site controls** can pause user APIs and proxied browsing in maintenance mode, disable new invitations, or disable assistant access; the owner console stays available during maintenance. Create invitations from **Invitations** and copy each token before closing its one-time reveal. The database never stores the raw token.

## Owner terminal commands

When started from an interactive terminal, Luma exposes a `nightjar>` compatibility prompt in that same `npm start` terminal. Type `help` for the full list. Common commands:

```text
tokens
accounts
ranks
token make "Guest laptop" basic-plus
token make "Study group" basic
token renew <account-id> "Replacement" full
tokens revoke <token-id>
revoke <token-id>
```

`token make [label] [rank]` creates a never-expiring, one-time invitation using a rank. `token renew <account-id> [label] [rank]` issues a replacement for an existing account; get account IDs from `accounts`. You can also use the Owner console to create an invitation for an existing account. A replacement invitation does not reset that account's password. The recipient redeems it with the account's existing email/password credentials.

Create custom ranks with `ranks create "Study group" --permissions browse,games,support --features games,support`; inspect or remove them with `ranks` and `ranks delete <rank-id>`. `--features` must be included in `--permissions`. Use `quit` or Ctrl+C to stop the server. A standalone CLI is also available through `npm run manage -- help`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Luma app bind address. Keep local unless using a properly secured HTTPS deployment. |
| `PORT` | `4173` | Luma app port. |
| `RAMMERHEAD_HOST` | `127.0.0.1` | Rammerhead bind address. |
| `RAMMERHEAD_PORT` | `4174` | Rammerhead service port. |
| `APP_ORIGIN` | inferred for local development | Exact public frontend origin allowed to embed the separate Rammerhead shell. For S3, use the frontend's HTTPS custom domain. Required in production. |
| `RAMMERHEAD_ORIGIN` | local origin from host/port | Exact public Rammerhead origin, with no path. Required in production. It must be different from `APP_ORIGIN`. |
| `NODE_ENV` | `development` | Set to `production` behind HTTPS; production cookies use `Secure`. |
| `DATABASE_PATH` | `./data/nightjar.sqlite` | SQLite database path. |
| `CORS_ORIGINS` | unset | Optional comma-separated exact frontend origins allowed to call the API with credentials. No wildcard; production origins must use HTTPS. |
| `DASHBOARD_ORIGINS` | unset | Optional comma-separated exact dashboard origins allowed to make credentialed cross-origin token-dashboard requests. No wildcard; production origins must be HTTPS. |
| `ADMIN_INITIAL_PASSWORD` | unset | Required to initialize a new owner database; minimum 16 characters. |
| `ADMIN_TOTP_SECRET` | unset | Optional base32 RFC 6238 TOTP secret. |
| `OLLAMA_AUTOSTART` | `1` | Start `ollama serve` when the loopback API is unavailable; set `0` to disable. |
| `OLLAMA_MODEL` | `qwen3:4b` | Installed local model used by the assistant. |
| `OLLAMA_BINARY` | search `PATH` | Optional executable path/name for local Ollama. |
| `ROUNDCUBE_URL` | unset | Optional HTTPS URL for the Roundcube webmail client. HTTP is allowed only for localhost during development. Do not include URL credentials, query parameters, or fragments. |
| `RANK_PRICE_BASIC_PLUS`, `RANK_PRICE_AI`, `RANK_PRICE_FULL_MINUS` | unset | Optional display price text for the corresponding purchasable member rank. Use the actual amount/currency for the instance; unset prices display as “ask owner”. |
| `RANK_VISA_GIFT_CARD_INSTRUCTIONS` | unset | Optional public instructions for arranging a Visa gift-card payment. Never request/store card numbers, PINs, CVVs, redemption codes, or card photos in Luma. |
| `RANK_CASH_PAYMENT_INSTRUCTIONS` | unset | Optional public cash-payment instructions. No cash location is assumed when unset. |
| `DESKTOP_COMPANION_SECRET` | unset | Private 64-character hex shared only between the Luma server and its companion PC; keep it in ignored `.env` files and never commit it. |
| `RESEND_API_KEY` | unset | Optional server-side Resend API key for email notifications. |
| `EMAIL_FROM` | unset | Verified sender address for Resend. |
| `FEEDBACK_EMAIL` | unset | Owner email address that receives feedback/rank request notifications. |

`.env` is ignored by Git. `.env.example` contains placeholders only. `SCRAMJET_HOST`, `SCRAMJET_PORT`, and `SCRAMJET_ORIGIN` remain accepted as legacy aliases. Do not expose the app, Rammerhead server or Ollama API directly to the public Internet.

### Manual reverse-proxy deployment

Use the provided `Caddyfile` to serve the app at `https://example.com` and Rammerhead at `https://proxy.example.com`. They share one registered base domain but remain separate browser origins; do not combine them under one hostname/path because untrusted proxied pages must not share Luma's account origin. Caddy handles TLS certificates, WebSocket upgrades, and proxy streaming. Set `APP_ORIGIN=https://example.com` and `RAMMERHEAD_ORIGIN=https://proxy.example.com` in the app environment, and keep both Node listeners bound to loopback.

Before deploying, create DNS A/AAAA records for both `example.com` and `proxy.example.com` pointing to the Caddy host, and allow inbound TCP ports 80 and 443 (UDP 443 is optional for HTTP/3). Install Caddy using its official package for your OS, set `APP_DOMAIN=example.com` in the Caddy service environment, and install this repository's Caddyfile as its configuration. Validate and run it with:

```sh
APP_DOMAIN=example.com caddy validate --config ./Caddyfile --adapter caddyfile
APP_DOMAIN=example.com caddy run --config ./Caddyfile --adapter caddyfile
```

For a systemd-managed Caddy service, persist `APP_DOMAIN` in a systemd service override or environment file; shell variables from Luma's `.env` are not automatically inherited by Caddy. Then start Luma with `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=4173`, `RAMMERHEAD_HOST=127.0.0.1`, `RAMMERHEAD_PORT=4174`, and the two public origins above. This repository configures the app but does not provision DNS, obtain certificates, or change the host's Caddy installation. The local defaults are for single-machine development only.

### Amazon S3 and Jellyfin

The Luma web frontend can be hosted as static files on S3; this does not move or replace the Node backend, SQLite database, or Rammerhead proxy. Build a static bundle with the public HTTPS backend origin:

```sh
LUMA_API_ORIGIN=https://api.example.com npm run build:static
```

The command writes only frontend assets and `api-config.js` to `api-html/`. It requires an explicit bare HTTPS origin, so the generated config does not silently point at localhost or an unknown host. Upload the **contents** of `api-html/` to the bucket root. The bundle contains the browser, owner-console, and bug-report pages and their CSS/JS/SVG assets; it does not contain the backend, proxy shell, desktop companion, `.env`, or server secrets. Rebuild with the correct API origin before each deployment; do not upload a bundle whose generated `api-config.js` still has a sample origin.

For production, keep the S3 bucket private and serve it through CloudFront with Origin Access Control (OAC); block public bucket access and grant the distribution access to read objects. Set the default root object to `index.html`. Associate a viewer-request CloudFront Function that rewrites `/admin` to `/admin.html` and `/bugs` to `/bugs.html`; keep ordinary asset paths unchanged. Configure an HTTPS custom domain such as `app.example.com`. Run the backend separately at `api.example.com` and the Rammerhead service at a distinct origin such as `proxy.example.com`; all must be deployed and reachable independently.

Set the backend environment to `APP_ORIGIN=https://app.example.com` and `CORS_ORIGINS=https://app.example.com`, plus the exact `RAMMERHEAD_ORIGIN`. If the separate token-dashboard endpoint is used cross-origin, also add the frontend origin to `DASHBOARD_ORIGINS`. These are exact origin allowlists: do not use `*`. The API returns credentialed CORS only to configured origins, handles preflight for the app's methods and `Content-Type`/`X-NJ-CSRF` headers, and preserves session/CSRF checks. Keep the frontend and API on HTTPS subdomains of the same registrable domain: the existing `SameSite=Strict` host-only session cookies are not available to an unrelated S3/CloudFront domain. An unrelated static domain or the default `cloudfront.net` hostname is therefore not a supported authenticated deployment origin.

Attach a CloudFront response-headers policy for static documents with a restrictive CSP similar to `default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; frame-src https://proxy.example.com; img-src 'self' data: https:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://api.example.com`, plus `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`. Replace both example origins with the deployed origins. `frame-src` is for the separately hosted Rammerhead shell; the backend itself remains non-embeddable. CORS only permits browser API requests—it does not enable iframe embedding. Luma does not try to iframe the backend or raw backend site. The current browsing workspace does use its separate Rammerhead shell; pages whose own framing/security behavior prevents proxy display may remain unsupported and cannot be fixed by CORS.

No S3 bucket CORS rule is needed for the static assets because the browser fetches them from the frontend origin and calls the separate API origin directly. Do not add a wildcard CORS response header at S3 or CloudFront. Configure the API's exact `CORS_ORIGINS` allowlist instead. CloudFront can cache static assets normally, but use a disabled/very short cache policy for `api-config.js` or invalidate that object after changing the backend origin. S3 hosting does not run Node, Rammerhead, or backend functions. The current one-time desktop viewer depends on the authenticated backend page and same-origin popup handshake; use the backend-hosted UI or a same-origin reverse proxy for that optional companion feature.

Luma's account storage feature still uses account-isolated SQLite files on the app server; it does not upload user files to S3. A future server-side S3 integration would require a bucket, region, private server credentials/IAM permissions, and an upload limit. Direct browser-to-S3 uploads would additionally need a narrowly scoped bucket CORS policy for only the exact Luma origin and required methods/headers; none is configured here.

There is no Jellyfin integration or CORS proxy configured. To connect it safely would require a reachable HTTPS Jellyfin base URL, the intended media feature, and a Jellyfin API key stored only in server-side secret configuration. Add only the exact Luma app origin (for example `https://example.com`) to Jellyfin's CORS allowed-origin setting; do not allow `*`, the Rammerhead origin, or arbitrary request origins. The deployment script does not configure Jellyfin or transmit credentials.

No bucket name, region, account, upload workflow, or S3 credentials are currently configured. Before a future integration, choose the bucket and region, a maximum upload size, and a server-side IAM role/policy limited to the required bucket and operations. Prefer workload identity/role credentials over long-lived access keys. If that integration uses browser-signed uploads, the bucket CORS policy must allow only the exact Luma app origin, only the methods the upload flow needs (typically `PUT` and `GET`), and only required headers; do not include the Rammerhead origin or wildcard origins. The deployment script does not create buckets, apply policies, or enable cloud storage.

## Tokens, ranks and sessions

Browsing does not require an invitation. Each guest proxy session expires after 30 minutes total or 10 minutes idle, is bound to the connecting IP address, and has per-IP request and concurrent-session/socket limits. Guest access only authorizes the Rammerhead proxy session and public address resolution; it cannot read or change account data, use AI, or access the owner console. An authenticated user can add a token from the **Guest · Add token** account control; when the current guest session is still valid, Luma adopts that browsing session rather than interrupting its open page.

Each invitation never expires automatically and allows exactly one redemption. On first redemption, the recipient must provide a valid email address and create a 12–128 character password; the password is stored as a scrypt hash. Future sign-ins use email/password. Existing account replacement invitations require that account's current email/password and cannot reset its password. The server increments the redemption count atomically, then issues an HttpOnly, SameSite cookie backed by a server-side session record. Signed-in sessions expire after 12 hours of inactivity or 12 hours total. In the owner console, **Redeemed** means the invitation has been used once; **Revoked** means the owner disabled it.

Each account permits one active session. Signing in to an account that is already active elsewhere with valid credentials revokes its invitations and terminates the active session; the owner must issue a replacement. If the browser's cookie is lost or the 12-hour session expires, the user can sign in again using email/password; the owner only needs to issue another invitation if access was revoked.

Luma's rank listings show exactly these five built-in ranks:

| Rank | Features |
|---|---|
| Basic | Free; search/browse, notes, storage, private chat, bug reports and 20 local AI requests per token |
| Basic+ | Basic features plus bookmarks and history; limited AI requests |
| AI | Basic+ features with unlimited AI requests |
| Full- | AI features plus customization, games and support |
| Owner | Full- capabilities plus owner-console access; never purchasable through the rank store |

Basic signup is free and uses email/password credentials; the address is not verified, and password reset is not available. Higher-rank invitation redemption also establishes email/password credentials. The Basic and Basic+ AI cap is lifetime and tracked on the associated token. The rank store is a request surface only until a payment processor is configured; it does not collect money. Existing legacy ranks are migrated to the current equivalents. Custom ranks remain configurable from the Owner console. Built-in ranks cannot be deleted, and custom rank names or grants do not grant owner access.

Full- accounts can change the browser tab title and icon and drag toolbar controls into a per-account order from Settings. Settings and saved layout preferences are not available to lower ranks.

The token dashboard API is `GET /api/owner/dashboard/tokens`, authenticated by the existing HttpOnly `nj_admin` cookie or an explicitly assigned Owner-rank session cookie. It returns masked token IDs, rank, active/revoked/redeemed status, redemption usage, AI usage and timestamps; raw token values and hashes are never returned. Cross-origin browser access requires a comma-separated exact-origin `DASHBOARD_ORIGINS` allowlist and credentialed CORS without wildcards. Since production owner cookies remain `SameSite=Strict; Secure`, deploy the dashboard same-site with Luma (such as a sibling HTTPS subdomain), or call through a same-origin reverse proxy/BFF; unrelated-site third-party cookies are not supported.

Each user's Project areas are private, account-owned launch shortcuts named from the account label (for example, `Alex's Proxy` and `Alex's games`). Open Proxy creates a new Luma tab and focuses the address bar; Open games opens GN Math in a new tab through the Rammerhead proxy. The Luma tools section also links to available Notes, Storage, Chat, Email, Rank store and bug reporting features. Every project's list and CRUD API operation remains scoped server-side to the signed-in account.

## Support, suggestions and games

Users with the support capability can send a request or suggestion from the in-app Help guide. Messages are stored in the Luma database and shown only in the owner’s **Support & ideas** panel; when Resend is configured, a notification is sent to the configured owner address. The UI distinguishes delivered notifications from unconfigured/failed email while keeping each request in the owner console. The owner can mark them open, in progress or resolved. Bug reports are similarly private and available from the bugs page.

The **Rank store** explains the manual Visa gift-card and cash process, displays only configured prices/instructions, and asks the user to select a rank and method. The request endpoint rejects any additional properties; it never accepts payment credentials or changes the account rank. The owner reviews requests under **Rank requests**, confirms payment outside Luma, and manually changes access under **Accounts**. Resolving a request does not grant a rank. The separate Roundcube button appears for signed-in accounts when `ROUNDCUBE_URL` is configured; it opens the external webmail client and does not create mailboxes or send through SMTP.

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

The tests use a temporary SQLite database and mock local Ollama responses; they do not download a model or generate model output. They cover anonymous guest browsing and guest-to-token session adoption, account/private API isolation, Owner-rank authorization and dashboard/API CORS (including preflight and credential policy), static S3 bundle layout/configuration, friend list isolation, private project areas, token-scoped Basic AI quotas, customization permissions, rank migrations, token hashing/one-time redemption, sessions, proxy isolation, bookmarks/history/settings, and TOTP.

- **Port already in use:** another Luma instance may already be running. Do not start a second copy; stop the existing instance from its own terminal or change both `PORT` and `APP_ORIGIN`, and both `RAMMERHEAD_PORT` and `RAMMERHEAD_ORIGIN`.
- **Rammerhead page does not open:** check the Luma log for “Rammerhead browsing engine is ready”, confirm `RAMMERHEAD_PORT` is reachable from the browser, and ensure the app and proxy have distinct origins. Some sites remain incompatible with web-based proxying.
- **Invitation is rejected:** check revocation/redemption status in the Owner console. Invitations do not expire, but redeemed invitations cannot be reused. Issue a replacement for the existing account and have the user sign in with its existing email/password.
- **Account was signed in elsewhere:** another valid invitation was redeemed while its account had a live session. The account’s invitations and session are revoked; issue a new invitation after verifying the intended account/device.
- **Support or games are missing:** the account rank may not include those capabilities; the owner can issue a replacement invitation with a suitable rank.
- **Assistant unavailable:** verify Ollama is installed, its loopback port is available and the selected model is installed. `OLLAMA_AUTOSTART=0` leaves process management to the operator.
- **Owner initialization fails:** set a 16-character-or-longer `ADMIN_INITIAL_PASSWORD` and verify the database path is writable. The variable is needed only when creating an empty database.
