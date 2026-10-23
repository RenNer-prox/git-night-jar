import { createServer } from "node:http";
import { isIP } from "node:net";
import { readFile, mkdir } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash, createHmac } from "node:crypto";
import { promisify } from "node:util";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { delimiter } from "node:path";
import { constants as fsConstants } from "node:fs";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";

const scrypt = promisify(scryptCallback);
const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = resolve(ROOT, "public");
const SESSION_COOKIE = "nj_session";
const ADMIN_SESSION_COOKIE = "nj_admin";
const MAX_BODY_BYTES = 64 * 1024;
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const SESSION_IDLE_MS = SESSION_MAX_AGE_MS;
const PERMISSIONS = ["browse", "bookmarks", "history", "settings", "assistant", "games", "support"];
const FEATURES = ["bookmarks", "history", "settings", "assistant", "games", "support"];
const DEFAULT_SITE_CONTROLS = {
  maintenanceMode: false,
  invitationsEnabled: true,
  assistantEnabled: true,
};
const DEFAULT_RANKS = [
  { id: "basic", label: "Basic", permissions: ["browse", "support"], features: ["support"] },
  { id: "standard", label: "Standard", permissions: ["browse", "bookmarks", "history", "settings", "games", "support"], features: ["bookmarks", "history", "settings", "games", "support"] },
  { id: "full", label: "Full", permissions: PERMISSIONS, features: FEATURES },
  { id: "without-ai", label: "Without AI", permissions: ["browse", "bookmarks", "history", "settings", "games", "support"], features: ["bookmarks", "history", "settings", "games", "support"] },
  { id: "with-ai", label: "With AI", permissions: PERMISSIONS, features: FEATURES },
];
const DEFAULT_SETTINGS = {
  theme: "dark",
  accent: "#ff7048",
  density: "comfortable",
  homepage: "home",
  searchProvider: "duckduckgo",
  customCursor: true,
  privacy: { suppressReferrer: true, clearOnExit: false },
};
const SEARCH_PROVIDERS = {
  duckduckgo: "https://duckduckgo.com/?q=",
  brave: "https://search.brave.com/search?q=",
  bing: "https://www.bing.com/search?q=",
  google: "https://www.google.com/search?q=",
  yandex: "https://yandex.com/search/?text=",
};
const COMMON_TLDS = new Set([
  "aero", "app", "art", "asia", "biz", "blog", "cloud", "co", "com", "coop", "dev",
  "digital", "edu", "email", "gov", "info", "int", "io", "mil", "museum", "name",
  "net", "online", "org", "pro", "shop", "site", "store", "tech", "today", "travel",
  "tv", "xyz",
]);
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
};

class HttpError extends Error {
  constructor(status, message, code = "request_failed") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function constantEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

const requireEnvFile = await readFile(resolve(ROOT, ".env"), "utf8")
  .then((text) => Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith("#")) return [];
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return [[match[1], value]];
  })))
  .catch(() => ({}));

function env(name, fallback) {
  return process.env[name] ?? requireEnvFile[name] ?? fallback;
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").flatMap((part) => {
    const index = part.indexOf("=");
    if (index < 0) return [];
    const key = part.slice(0, index).trim();
    try {
      return [[key, decodeURIComponent(part.slice(index + 1).trim())]];
    } catch {
      return [];
    }
  }));
}

function clientAddress(req) {
  return req.socket.remoteAddress ?? "unknown";
}

function base32Decode(text) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of text.replace(/=+$/, "").toUpperCase()) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error("Invalid base32 secret");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function verifyTotp(secret, candidate, now = Date.now()) {
  if (!/^\d{6}$/.test(candidate)) return false;
  const key = base32Decode(secret);
  const counter = Math.floor(now / 30_000);
  for (let offset = -1; offset <= 1; offset++) {
    const message = Buffer.alloc(8);
    message.writeBigUInt64BE(BigInt(counter + offset));
    const digest = createHmac("sha1", key).update(message).digest();
    const index = digest[digest.length - 1] & 0x0f;
    const code = ((digest.readUInt32BE(index) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
    if (constantEqual(code, candidate)) return true;
  }
  return false;
}

function normalizeSettings(input = {}, current = DEFAULT_SETTINGS) {
  const settings = { ...current, ...input, privacy: { ...current.privacy, ...(input.privacy ?? {}) } };
  if (!["dark", "light", "system"].includes(settings.theme)) throw new HttpError(400, "Choose a supported theme.");
  if (!/^#[0-9a-f]{6}$/i.test(settings.accent)) throw new HttpError(400, "Accent must be a six-digit hex color.");
  if (!["compact", "comfortable", "spacious"].includes(settings.density)) throw new HttpError(400, "Choose a supported interface density.");
  if (typeof settings.homepage !== "string" || settings.homepage.length > 2048) throw new HttpError(400, "Homepage must be at most 2,048 characters.");
  if (!["home", "blank"].includes(settings.homepage) && !isSafeWebUrl(settings.homepage)) throw new HttpError(400, "Homepage must be the new-tab page, blank, or an HTTP(S) URL.");
  if (!Object.hasOwn(SEARCH_PROVIDERS, settings.searchProvider)) throw new HttpError(400, "Choose a supported search provider.");
  if (typeof settings.customCursor !== "boolean" || typeof settings.privacy.suppressReferrer !== "boolean" || typeof settings.privacy.clearOnExit !== "boolean") {
    throw new HttpError(400, "Settings contain an invalid toggle.");
  }
  return settings;
}

function isSafeWebUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.href.length <= 2048;
  } catch {
    return false;
  }
}

function normalizeAddress(value, provider) {
  const address = value.trim();
  if (!address || address.length > 2048 || /[\u0000-\u001f]/.test(address)) throw new HttpError(400, "Enter a search or web address.");
  if (/^(javascript|data|file|vbscript):/i.test(address)) throw new HttpError(400, "Only web addresses and searches are supported.");
  const explicitWebProtocol = /^https?:\/\//i.test(address);
  const hostWithPort = /^[^\s/]+:\d+(?:\/|$)/.test(address);
  if (!explicitWebProtocol && /^[a-z][a-z0-9+.-]*:/i.test(address) && !hostWithPort && !/\s/.test(address)) {
    throw new HttpError(400, "Only HTTP(S) addresses and search terms are supported.");
  }
  const withProtocol = explicitWebProtocol ? address : `https://${address}`;
  if (isSafeWebUrl(withProtocol) && (explicitWebProtocol || hasRecognizedDomainSuffix(address))) return new URL(withProtocol).href;
  if (explicitWebProtocol || (hostWithPort && hasRecognizedDomainSuffix(address))) throw new HttpError(400, "Enter a valid HTTP(S) web address.");
  return SEARCH_PROVIDERS[provider] + encodeURIComponent(address);
}

function hasRecognizedDomainSuffix(value) {
  if (/\s/.test(value)) return false;
  try {
    const hostname = new URL(`https://${value}`).hostname.toLowerCase().replace(/\.$/, "");
    if (isIP(hostname)) return true;
    const suffix = hostname.split(".").at(-1);
    return suffix.length === 2 || COMMON_TLDS.has(suffix);
  } catch {
    return false;
  }
}

function validateOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new HttpError(403, "Request origin was rejected.", "origin_rejected");
  }
  if (parsed.host !== req.headers.host || !["http:", "https:"].includes(parsed.protocol)) {
    throw new HttpError(403, "Request origin was rejected.", "origin_rejected");
  }
}

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(body);
}

function cookieHeader(value, secure, clear = false, name = SESSION_COOKIE) {
  const parts = [
    `${name}=${clear ? "" : encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (secure) parts.push("Secure");
  if (clear) parts.push("Max-Age=0");
  else parts.push(`Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`);
  return parts.join("; ");
}

function createDatabase(path) {
  const db = new DatabaseSync(path, { timeout: 5000 });
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS owner (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      password_hash TEXT NOT NULL,
      totp_enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      settings_json TEXT NOT NULL,
      permissions_json TEXT NOT NULL,
      features_json TEXT NOT NULL,
      rank TEXT NOT NULL DEFAULT 'standard',
      created_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS ranks (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL UNIQUE,
      permissions_json TEXT NOT NULL,
      features_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tokens (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      token_hash TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      permissions_json TEXT NOT NULL,
      rank TEXT NOT NULL DEFAULT 'standard',
      expires_at TEXT,
      usage_limit INTEGER,
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      session_hash TEXT NOT NULL UNIQUE,
      principal TEXT NOT NULL CHECK (principal IN ('admin', 'user')),
      account_id TEXT REFERENCES accounts(id),
      token_id TEXT REFERENCES tokens(id),
      csrf_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bookmarks (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(account_id, url)
    );
    CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      visited_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS history_by_account_time ON history(account_id, visited_at DESC, id DESC);
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      subject TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_logs_by_time ON audit_logs(created_at DESC);
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      kind TEXT NOT NULL CHECK (kind IN ('support', 'suggestion')),
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS feedback_by_time ON feedback(created_at DESC);
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, CURRENT_TIMESTAMP);
  `);
  db.prepare("INSERT OR IGNORE INTO site_settings(key, value_json, updated_at) VALUES ('controls', ?, ?)")
    .run(JSON.stringify(DEFAULT_SITE_CONTROLS), new Date().toISOString());
  const tokenRedemptionMigration = db.prepare("SELECT version FROM schema_migrations WHERE version = 2").get();
  if (!tokenRedemptionMigration) {
    db.exec(`
      BEGIN IMMEDIATE;
      UPDATE tokens SET usage_limit = MAX(usage_count, 1);
      INSERT INTO schema_migrations(version, applied_at) VALUES (2, CURRENT_TIMESTAMP);
      COMMIT;
    `);
  }
  const accountColumns = new Set(db.prepare("PRAGMA table_info(accounts)").all().map((column) => column.name));
  if (!accountColumns.has("rank")) db.exec("ALTER TABLE accounts ADD COLUMN rank TEXT NOT NULL DEFAULT 'standard'");
  const tokenColumns = new Set(db.prepare("PRAGMA table_info(tokens)").all().map((column) => column.name));
  if (!tokenColumns.has("rank")) db.exec("ALTER TABLE tokens ADD COLUMN rank TEXT NOT NULL DEFAULT 'standard'");
  if (!db.prepare("SELECT version FROM schema_migrations WHERE version = 3").get()) {
    const insertRank = db.prepare("INSERT OR IGNORE INTO ranks(id, label, permissions_json, features_json, created_at) VALUES (?, ?, ?, ?, ?)");
    for (const rank of DEFAULT_RANKS) {
      insertRank.run(rank.id, rank.label, JSON.stringify(rank.permissions), JSON.stringify(rank.features), new Date().toISOString());
    }
    db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (3, CURRENT_TIMESTAMP)").run();
  }
  if (!db.prepare("SELECT version FROM schema_migrations WHERE version = 4").get()) {
    const insertRank = db.prepare("INSERT OR IGNORE INTO ranks(id, label, permissions_json, features_json, created_at) VALUES (?, ?, ?, ?, ?)");
    for (const rank of DEFAULT_RANKS.filter(({ id }) => id === "without-ai" || id === "with-ai")) {
      insertRank.run(rank.id, rank.label, JSON.stringify(rank.permissions), JSON.stringify(rank.features), new Date().toISOString());
    }
    db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (4, CURRENT_TIMESTAMP)").run();
  }
  if (!db.prepare("SELECT version FROM schema_migrations WHERE version = 5").get()) {
    db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (5, CURRENT_TIMESTAMP)").run();
  }
  if (!db.prepare("SELECT version FROM schema_migrations WHERE version = 6").get()) {
    db.exec(`
      BEGIN IMMEDIATE;
      DROP INDEX IF EXISTS one_admin_session;
      INSERT INTO schema_migrations(version, applied_at) VALUES (6, CURRENT_TIMESTAMP);
      COMMIT;
    `);
  }
  return db;
}

function parseAdminArgs(args) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item.startsWith("--")) {
      positional.push(item);
      continue;
    }
    const key = item.slice(2);
    if (!["label", "account-label", "account-id", "uses", "expires", "permissions", "features", "rank"].includes(key)) {
      throw new Error(`Unknown option: ${item}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Option ${item} requires a value.`);
    if (Object.hasOwn(flags, key)) throw new Error(`Option ${item} may only be specified once.`);
    flags[key] = value;
    index += 1;
  }
  return { positional, flags };
}

function csvList(value, allowed, name) {
  if (value === "none" && name === "features") return [];
  const items = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (!items.length || new Set(items).size !== items.length || items.some((item) => !allowed.includes(item))) {
    throw new Error(`${name} must be a comma-separated list of: ${allowed.join(", ")}${name === "features" ? ", or none" : ""}.`);
  }
  return items;
}

export async function runAdminCommand(args, options = {}) {
  const { positional, flags } = parseAdminArgs(args);
  let [resource, action, identifier] = positional;
  if (resource === "token") resource = "tokens";
  if (resource === "tokens" && !action) action = "list";
  if (resource === "accounts" && !action) action = "list";
  if (resource === "ranks" && !action) action = "list";
  if (resource === "revoke") {
    positional.splice(0, 1, "tokens", "revoke");
    [resource, action, identifier] = positional;
  }
  if (resource === "tokens" && action === "renew") {
    action = "create";
    flags["account-id"] ??= positional[2];
    positional.splice(2, 1);
  }
  if (resource === "tokens" && action === "make") action = "create";
  if (!resource || resource === "help" || resource === "--help") {
    return { type: "help" };
  }
  const databasePath = resolve(options.databasePath ?? env("DATABASE_PATH", resolve(ROOT, "data/nightjar.sqlite")));
  try {
    await access(databasePath, fsConstants.R_OK | fsConstants.W_OK);
  } catch {
    throw new Error("Nightjar's database is not available. Start Nightjar once to initialize it, then retry.");
  }
  const db = createDatabase(databasePath);
  try {
    if (!db.prepare("SELECT id FROM owner WHERE id = 1").get()) {
      throw new Error("The owner account is not initialized. Start Nightjar once with ADMIN_INITIAL_PASSWORD set.");
    }
    if (resource === "tokens" && action === "list" && positional.length <= 2) {
      const rows = db.prepare(`SELECT t.id, t.account_id, a.label AS account_label, t.label, t.permissions_json, t.rank,
        t.expires_at, t.usage_limit, t.usage_count, t.created_at, t.last_used_at, t.revoked_at
        FROM tokens t JOIN accounts a ON a.id = t.account_id ORDER BY t.created_at DESC LIMIT 200`).all();
      return {
        type: "tokens",
        items: rows.map((row) => ({
          ...row,
          permissions: safeJson(row.permissions_json, []),
          status: row.revoked_at ? "revoked" : (row.expires_at && Date.parse(row.expires_at) <= Date.now() ? "expired" : (row.usage_limit !== null && row.usage_count >= row.usage_limit ? "redeemed" : "active")),
        })),
      };
    }
    if (resource === "accounts" && action === "list" && positional.length <= 2) {
      const items = db.prepare("SELECT id, label, rank, permissions_json, features_json, created_at, revoked_at FROM accounts ORDER BY created_at DESC LIMIT 200")
        .all().map((row) => ({
          id: row.id,
          label: row.label,
          rank: row.rank,
          permissions: safeJson(row.permissions_json, []),
          features: safeJson(row.features_json, []),
          created_at: row.created_at,
          revoked_at: row.revoked_at,
        }));
      return { type: "accounts", items };
    }
    if (resource === "ranks" && action === "list" && positional.length <= 2) {
      const items = db.prepare("SELECT id, label, permissions_json, features_json, created_at FROM ranks ORDER BY label").all()
        .map((row) => ({ ...row, permissions: safeJson(row.permissions_json, []), features: safeJson(row.features_json, []) }));
      return { type: "ranks", items };
    }
    if (resource === "ranks" && action === "create" && positional.length === 3) {
      const label = positional[2].trim().slice(0, 40);
      const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      if (!id) throw new Error("Rank label must include letters or numbers.");
      const permissions = flags.permissions ? csvList(flags.permissions, PERMISSIONS, "permissions") : ["browse"];
      if (!permissions.includes("browse")) throw new Error("permissions must include browse.");
      const features = flags.features ? csvList(flags.features, FEATURES, "features") : [];
      if (features.some((feature) => !permissions.includes(feature))) throw new Error("Each enabled feature must also be included in --permissions.");
      const now = new Date().toISOString();
      db.prepare("INSERT INTO ranks(id, label, permissions_json, features_json, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(id, label, JSON.stringify(permissions), JSON.stringify(features), now);
      audit(db, "owner-cli", "rank.created", id, { permissions, features }, "local-cli");
      return { type: "rank-created", id, label, permissions, features };
    }
    if (resource === "ranks" && action === "delete" && positional.length === 3) {
      const count = db.prepare("SELECT COUNT(*) AS count FROM ranks").get().count;
      if (count <= 1) throw new Error("Keep at least one rank so new invitations can still be issued.");
      const result = db.prepare("DELETE FROM ranks WHERE id = ?").run(identifier);
      if (!result.changes) throw new Error("Rank not found.");
      audit(db, "owner-cli", "rank.deleted", identifier, {}, "local-cli");
      return { type: "rank-deleted", id: identifier };
    }
    if (resource === "tokens" && action === "create" && positional.length >= 2 && positional.length <= 4) {
      const controlsRow = db.prepare("SELECT value_json FROM site_settings WHERE key = 'controls'").get();
      if (!safeJson(controlsRow?.value_json, DEFAULT_SITE_CONTROLS).invitationsEnabled) {
        throw new Error("Invitation creation is disabled in the owner console's site controls.");
      }
      const label = (flags.label ?? positional[2])?.trim().slice(0, 80);
      if (!label) throw new Error("Provide a non-empty --label (maximum 80 characters).");
      const accountLabel = flags["account-label"]?.trim().slice(0, 80) || label;
      const accountId = flags["account-id"] || randomUUID();
      if (flags["account-id"] && !/^[0-9a-f-]{36}$/i.test(accountId)) throw new Error("--account-id must be an account UUID from `npm run manage -- accounts list`.");
      let expiresAt = null;
      if (flags.expires) {
        const time = Date.parse(flags.expires);
        if (!Number.isFinite(time) || time <= Date.now()) throw new Error("--expires must be a future date or timestamp (for example 2026-12-31 or 2026-12-31T23:59:00Z).");
        expiresAt = new Date(time).toISOString();
      }
      let usageLimit = 1;
      if (flags.uses) {
        usageLimit = Number(flags.uses);
        if (usageLimit !== 1) {
          throw new Error("Invitation tokens can be redeemed by one person only. Use --uses 1; after sign-in, the secure session cookie keeps that browser signed in.");
        }
      }
      const existingAccount = db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId);
      if (flags["account-id"] && !existingAccount) throw new Error("That account ID was not found.");
      if (existingAccount?.revoked_at) throw new Error("Revoked accounts cannot receive replacement invitations.");
      let rankId = flags.rank ?? positional[3] ?? existingAccount?.rank ?? "standard";
      let rank = db.prepare("SELECT * FROM ranks WHERE id = ?").get(rankId);
      if (!rank && existingAccount && !flags.rank && !positional[3]) {
        rank = { permissions_json: existingAccount.permissions_json, features_json: existingAccount.features_json };
      } else if (!rank && !existingAccount && !flags.rank && !positional[3]) {
        rank = db.prepare("SELECT * FROM ranks ORDER BY label LIMIT 1").get();
        rankId = rank?.id;
      }
      if (!rank) throw new Error(`Unknown rank "${rankId}". Use \`ranks list\` to see available ranks.`);
      const permissions = flags.permissions ? csvList(flags.permissions, PERMISSIONS, "permissions") : safeJson(rank.permissions_json, []);
      if (!permissions.includes("browse")) throw new Error("permissions must include browse.");
      const features = flags.features ? csvList(flags.features, FEATURES, "features") : safeJson(rank.features_json, []);
      if (features.some((feature) => !permissions.includes(feature))) throw new Error("Each enabled feature must also be included in --permissions.");
      const now = new Date().toISOString();
      const value = randomBytes(32).toString("base64url");
      const tokenId = randomUUID();
      const settings = existingAccount ? safeJson(existingAccount.settings_json, DEFAULT_SETTINGS) : DEFAULT_SETTINGS;
      db.exec("BEGIN IMMEDIATE");
      try {
        if (existingAccount) {
          db.prepare("UPDATE accounts SET label = ?, permissions_json = ?, features_json = ?, rank = ? WHERE id = ?")
            .run(accountLabel, JSON.stringify(permissions), JSON.stringify(features), rankId, accountId);
        } else {
          db.prepare("INSERT INTO accounts(id, label, settings_json, permissions_json, features_json, rank, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .run(accountId, accountLabel, JSON.stringify(settings), JSON.stringify(permissions), JSON.stringify(features), rankId, now);
        }
        db.prepare(`INSERT INTO tokens(id, account_id, token_hash, label, permissions_json, rank, expires_at, usage_limit, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(tokenId, accountId, hash(value), label, JSON.stringify(permissions), rankId, expiresAt, usageLimit, now);
        audit(db, "owner-cli", "token.created", tokenId, { accountId, rank: rankId, permissions, features, expiresAt, usageLimit }, "local-cli");
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return { type: "created", token: value, id: tokenId, accountId, accountLabel, label, rank: rankId, permissions, features, expiresAt, usageLimit };
    }
    if (resource === "tokens" && action === "revoke" && positional.length === 3 && /^[0-9a-f-]{36}$/i.test(identifier)) {
      const row = db.prepare("SELECT id, account_id FROM tokens WHERE id = ?").get(identifier);
      if (!row) throw new Error("Invitation not found. Copy its ID from `npm run manage -- tokens list`.");
      const now = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("UPDATE tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?").run(now, row.id);
        db.prepare("DELETE FROM sessions WHERE token_id = ?").run(row.id);
        audit(db, "owner-cli", "token.revoked", row.id, { accountId: row.account_id }, "local-cli");
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return { type: "revoked", id: row.id };
    }
    throw new Error("Unknown command. Run `npm run manage -- help` for usage.");
  } finally {
    db.close();
  }
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

async function verifyPassword(password, encoded) {
  const [scheme, saltHex, digestHex] = encoded.split("$");
  if (scheme !== "scrypt" || !/^[0-9a-f]{32}$/.test(saltHex) || !/^[0-9a-f]{128}$/.test(digestHex)) return false;
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  return timingSafeEqual(actual, Buffer.from(digestHex, "hex"));
}

function audit(db, actor, action, subject, detail, ip) {
  db.prepare("INSERT INTO audit_logs(id, actor, action, subject, detail_json, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(randomUUID(), actor, action, subject, JSON.stringify(detail), ip, new Date().toISOString());
}

function rowToToken(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    accountLabel: row.account_label,
    label: row.label,
    rank: row.rank,
    permissions: safeJson(row.permissions_json, []),
    expiresAt: row.expires_at,
    usageLimit: row.usage_limit,
    usageCount: row.usage_count,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    status: row.revoked_at ? "revoked" : (row.expires_at && Date.parse(row.expires_at) <= Date.now() ? "expired" : (row.usage_limit !== null && row.usage_count >= row.usage_limit ? "redeemed" : "active")),
  };
}

function pageLimit(url) {
  const raw = Number(url.searchParams.get("limit") ?? 50);
  if (!Number.isInteger(raw) || raw < 1 || raw > 100) throw new HttpError(400, "Limit must be between 1 and 100.");
  return raw;
}

function parseCursor(url) {
  const raw = url.searchParams.get("before");
  if (!raw) return null;
  const separator = raw.lastIndexOf("|");
  if (separator < 0) throw new HttpError(400, "Pagination cursor is invalid.");
  const timestamp = raw.slice(0, separator);
  const id = raw.slice(separator + 1);
  if (!Number.isFinite(Date.parse(timestamp)) || !/^[0-9a-f-]{36}$/.test(id)) {
    throw new HttpError(400, "Pagination cursor is invalid.");
  }
  return { timestamp, id };
}

export async function createApp(options = {}) {
  const databasePath = resolve(options.databasePath ?? env("DATABASE_PATH", resolve(ROOT, "data/nightjar.sqlite")));
  await mkdir(dirname(databasePath), { recursive: true });
  const db = createDatabase(databasePath);
  const initialPassword = options.adminPassword ?? env("ADMIN_INITIAL_PASSWORD", "");
  const totpSecret = options.totpSecret ?? env("ADMIN_TOTP_SECRET", "");
  if (totpSecret) {
    try {
      if (base32Decode(totpSecret).length < 10) throw new Error("TOTP secrets must be at least 80 bits.");
    } catch {
      db.close();
      throw new Error("ADMIN_TOTP_SECRET must be a valid base32 secret of at least 80 bits.");
    }
  }
  let owner = db.prepare("SELECT * FROM owner WHERE id = 1").get();
  if (!owner) {
    if (initialPassword.length < 16) {
      db.close();
      throw new Error("ADMIN_INITIAL_PASSWORD must contain at least 16 characters to initialize the owner account.");
    }
    owner = {
      id: 1,
      password_hash: await hashPassword(initialPassword),
      totp_enabled: totpSecret ? 1 : 0,
      created_at: new Date().toISOString(),
    };
    db.prepare("INSERT INTO owner(id, password_hash, totp_enabled, created_at) VALUES (1, ?, ?, ?)")
      .run(owner.password_hash, owner.totp_enabled, owner.created_at);
  }
  if (owner.totp_enabled && !totpSecret) {
    db.close();
    throw new Error("The owner account requires ADMIN_TOTP_SECRET. Restore its configured secret before starting.");
  }

  const rateLimits = new Map();
  let activeAiRequests = 0;
  const config = {
    secureCookie: options.secureCookie ?? env("NODE_ENV", "development") === "production",
    serverVersion: "1.0.0",
  };
  const proxyHost = options.proxyHost ?? env("SCRAMJET_HOST", "127.0.0.1");
  const configuredProxyOrigin = options.proxyOrigin ?? env("SCRAMJET_ORIGIN", "");
  const configuredAppOrigin = options.appOrigin ?? env("APP_ORIGIN", "");
  const proxyPort = Number(options.proxyPort ?? env("SCRAMJET_PORT", "4174"));
  if (!Number.isInteger(proxyPort) || proxyPort < 0 || proxyPort > 65535) {
    db.close();
    throw new Error("SCRAMJET_PORT must be an integer from 0 to 65535.");
  }
  for (const [name, value] of [["SCRAMJET_ORIGIN", configuredProxyOrigin], ["APP_ORIGIN", configuredAppOrigin]]) {
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== value) throw new Error();
    } catch {
      db.close();
      throw new Error(`${name} must be a bare HTTP(S) origin with no path.`);
    }
  }
  if ((options.production ?? env("NODE_ENV", "development") === "production") && !configuredProxyOrigin) {
    db.close();
    throw new Error("SCRAMJET_ORIGIN must be configured for production so proxied sites stay isolated from the application origin.");
  }
  if ((options.production ?? env("NODE_ENV", "development") === "production") && !configuredAppOrigin) {
    db.close();
    throw new Error("APP_ORIGIN must be configured for production to restrict the Scramjet shell's embedding origin.");
  }
  const proxyOrigin = () => configuredProxyOrigin || `http://${proxyHost}:${proxyServer?.address()?.port ?? proxyPort}`;
  const proxyGrants = new Map();
  const proxySockets = new Map();
  const proxyMaintenanceTimer = setInterval(() => {
    const now = Date.now();
    for (const [grantHash, grant] of proxyGrants) {
      if (grant.expiresAt <= now) proxyGrants.delete(grantHash);
    }
    for (const sessionId of proxySockets.keys()) {
      const live = db.prepare("SELECT last_seen_at, expires_at FROM sessions WHERE id = ? AND principal = 'user'").get(sessionId);
      if (!live || Date.parse(live.expires_at) <= now || now - Date.parse(live.last_seen_at) > SESSION_IDLE_MS) closeProxySession(sessionId);
    }
  }, 30_000);
  proxyMaintenanceTimer.unref();
  let server;
  let proxyServer;
  wisp.options.allow_udp_streams = false;
  wisp.options.allow_tcp_streams = true;
  wisp.options.allow_private_ips = false;
  wisp.options.allow_loopback_ips = false;
  wisp.options.allow_direct_ip = false;
  wisp.options.port_whitelist = [80, 443];
  // Wisp 0.5 treats its stream map as an iterable in this filter; total streams remain bounded below.
  wisp.options.stream_limit_per_host = -1;
  wisp.options.stream_limit_total = 32;
  const aiModel = options.aiModel ?? env("OLLAMA_MODEL", "qwen3:4b");
  const ollamaFetch = options.ollamaFetch ?? globalThis.fetch;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(aiModel)) {
    db.close();
    throw new Error("OLLAMA_MODEL contains unsupported characters.");
  }
  const aiAutostart = options.aiAutostart ?? env("OLLAMA_AUTOSTART", "1") !== "0";
  const aiState = { status: aiAutostart ? "checking" : "stopped", startedByApp: false, error: "" };
  const desktopSecret = options.desktopSecret ?? env("DESKTOP_COMPANION_SECRET", "");
  let ollamaChild = null;

  async function ollamaAvailable() {
    try {
      const response = await ollamaFetch("http://127.0.0.1:11434/api/tags", { redirect: "error", signal: AbortSignal.timeout(900) });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function findOllamaBinary() {
    const configured = options.ollamaBinary ?? env("OLLAMA_BINARY", "");
    const candidates = configured
      ? (configured.includes("/") ? [resolve(ROOT, configured)] : (process.env.PATH ?? "").split(delimiter).filter(Boolean).map((directory) => resolve(directory, configured)))
      : (process.env.PATH ?? "").split(delimiter).filter(Boolean).map((directory) => resolve(directory, "ollama"));
    for (const candidate of candidates) {
      try {
        await access(candidate, fsConstants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }
    return null;
  }

  async function startOllamaIfNeeded() {
    if (!aiAutostart) {
      aiState.status = await ollamaAvailable() ? "running" : "stopped";
      return;
    }
    if (await ollamaAvailable()) {
      aiState.status = "running";
      return;
    }
    const binary = await findOllamaBinary();
    if (!binary) {
      aiState.status = "unavailable";
      aiState.error = "Ollama executable was not found on PATH.";
      return;
    }
    try {
      ollamaChild = spawn(binary, ["serve"], {
        shell: false,
        stdio: ["ignore", "ignore", "pipe"],
        env: { ...process.env, OLLAMA_HOST: "127.0.0.1:11434", OLLAMA_NO_CLOUD: "1" },
      });
      ollamaChild.stderr.setEncoding("utf8");
      ollamaChild.stderr.on("data", (chunk) => {
        const message = chunk.trim();
        if (!/level=(?:ERROR|WARN)/.test(message)) return;
        const summary = message.match(/\bmsg="([^"]*)"/)?.[1] ?? "Ollama reported a startup diagnostic.";
        console.error(JSON.stringify({ level: "warn", component: "ollama", message: summary.slice(0, 200) }));
      });
      ollamaChild.once("spawn", () => {
        aiState.startedByApp = true;
        aiState.status = "starting";
      });
      ollamaChild.once("error", (error) => {
        aiState.status = "unavailable";
        aiState.error = error.message;
        ollamaChild = null;
        console.error(JSON.stringify({ level: "error", component: "ollama", message: error.message }));
      });
      ollamaChild.once("exit", (code, signal) => {
        if (aiState.startedByApp) {
          aiState.status = code === 0 ? "stopped" : "unavailable";
          aiState.error = `Ollama exited (${signal ?? code ?? "unknown"}).`;
          aiState.startedByApp = false;
        }
        ollamaChild = null;
      });
    } catch (error) {
      aiState.status = "unavailable";
      aiState.error = error.message;
    }
  }

  await startOllamaIfNeeded();

  function consumeLimit(key, max, windowMs) {
    const now = Date.now();
    let item = rateLimits.get(key);
    if (!item || item.resetAt <= now) item = { count: 0, resetAt: now + windowMs };
    item.count += 1;
    rateLimits.set(key, item);
    if (rateLimits.size > 10_000) {
      for (const [entryKey, entry] of rateLimits) {
        if (entry.resetAt <= now) rateLimits.delete(entryKey);
      }
      if (rateLimits.size > 20_000) rateLimits.delete(rateLimits.keys().next().value);
    }
    if (item.count > max) throw new HttpError(429, "Too many attempts. Please wait and try again.", "rate_limited");
  }

  async function readBody(req) {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")) {
      throw new HttpError(415, "Send application/json requests.");
    }
    let length = 0;
    const chunks = [];
    for await (const chunk of req) {
      length += chunk.length;
      if (length > MAX_BODY_BYTES) {
        req.resume();
        throw new HttpError(413, "Request body is too large.");
      }
      chunks.push(chunk);
    }
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      return value;
    } catch {
      throw new HttpError(400, "Request body must be a JSON object.");
    }
  }

  function requestSession(req) {
    const isAdminRequest = req.url?.startsWith("/api/admin/");
    const cookieName = isAdminRequest ? ADMIN_SESSION_COOKIE : SESSION_COOKIE;
    const raw = parseCookies(req.headers.cookie)[cookieName];
    if (!raw || raw.length < 32 || raw.length > 128) return null;
    const session = db.prepare("SELECT * FROM sessions WHERE session_hash = ?").get(hash(raw));
    if (!session) return null;
    const now = Date.now();
    if (Date.parse(session.expires_at) <= now || now - Date.parse(session.last_seen_at) > SESSION_IDLE_MS) {
      db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
      closeProxySession(session.id);
      return null;
    }
    if (session.principal === "user") {
      const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(session.account_id);
      const token = db.prepare("SELECT * FROM tokens WHERE id = ?").get(session.token_id);
      if (!account || account.revoked_at || !token || token.revoked_at || (token.expires_at && Date.parse(token.expires_at) <= now)) {
        db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
        closeProxySession(session.id);
        return null;
      }
      session.account = account;
      session.token = token;
    }
    db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(new Date(now).toISOString(), session.id);
    return session;
  }

  function requirePrincipal(session, principal) {
    if (!session || session.principal !== principal) throw new HttpError(401, "Sign in to continue.", "authentication_required");
    return session;
  }

  function requireCsrf(req, session) {
    if (!constantEqual(hash(req.headers["x-nj-csrf"] ?? ""), session.csrf_hash)) {
      throw new HttpError(403, "Session verification failed. Refresh and try again.", "csrf_rejected");
    }
  }

  function requirePermission(session, permission) {
    const permissions = safeJson(session.account.permissions_json, []);
    const features = safeJson(session.account.features_json, []);
    if (!permissions.includes(permission) || (permission !== "browse" && !features.includes(permission))) {
      throw new HttpError(403, "This account is not permitted to use that feature.", "permission_denied");
    }
  }

  function csrfForSession(rawCookie) {
    return createHmac("sha256", rawCookie).update("nightjar-csrf-v1").digest("base64url");
  }

  function newSession(principal, accountId, tokenId) {
    const raw = randomBytes(32).toString("base64url");
    const csrf = csrfForSession(raw);
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_MAX_AGE_MS);
    const id = randomUUID();
    db.prepare(`INSERT INTO sessions(id, session_hash, principal, account_id, token_id, csrf_hash, created_at, last_seen_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, hash(raw), principal, accountId, tokenId, hash(csrf), now.toISOString(), now.toISOString(), expires.toISOString());
    return { raw, csrf };
  }

  function revokeAccount(accountId, reason, ip, actor = "system") {
    const now = new Date().toISOString();
    db.prepare("UPDATE tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE account_id = ?").run(now, accountId);
    const sessions = db.prepare("SELECT id FROM sessions WHERE account_id = ?").all(accountId);
    db.prepare("DELETE FROM sessions WHERE account_id = ?").run(accountId);
    for (const session of sessions) closeProxySession(session.id);
    audit(db, actor, "account.authorization_revoked", accountId, { reason }, ip);
  }

  function closeProxySession(sessionId) {
    const sockets = proxySockets.get(sessionId);
    if (sockets) {
      for (const socket of sockets.items) socket.destroy();
      proxySockets.delete(sessionId);
    }
    for (const [grantHash, grant] of proxyGrants) {
      if (grant.sessionId === sessionId) proxyGrants.delete(grantHash);
    }
  }

  function getSiteControls() {
    const row = db.prepare("SELECT value_json FROM site_settings WHERE key = 'controls'").get();
    const stored = safeJson(row?.value_json, DEFAULT_SITE_CONTROLS);
    return Object.fromEntries(Object.entries(DEFAULT_SITE_CONTROLS).map(([key, fallback]) => [
      key,
      typeof stored[key] === "boolean" ? stored[key] : fallback,
    ]));
  }

  async function routeApi(req, res, url) {
    const path = url.pathname;
    const method = req.method;
    const ip = clientAddress(req);
    const cookies = parseCookies(req.headers.cookie);
    const session = requestSession(req);
    const siteControls = getSiteControls();
    if (siteControls.maintenanceMode && !path.startsWith("/api/admin/") && path !== "/api/auth/logout") {
      throw new HttpError(503, "Nightjar is temporarily in maintenance mode. Please try again later.", "maintenance_mode");
    }

    if (method === "POST" && path === "/api/auth/login") {
      validateOrigin(req);
      consumeLimit(`user:${ip}`, 12, 5 * 60_000);
      const body = await readBody(req);
      if (typeof body.token !== "string" || body.token.length < 24 || body.token.length > 128) {
        throw new HttpError(401, "Invitation token was not recognized.", "invalid_token");
      }
      const token = db.prepare(`SELECT t.*, a.revoked_at AS account_revoked, a.label AS account_label
        FROM tokens t JOIN accounts a ON a.id = t.account_id WHERE t.token_hash = ?`).get(hash(body.token));
      if (!token || token.revoked_at || token.account_revoked || (token.expires_at && Date.parse(token.expires_at) <= Date.now())) {
        throw new HttpError(401, "Invitation token is invalid, expired, or revoked.", "invalid_token");
      }
      if (token.usage_limit !== null && token.usage_count >= token.usage_limit) {
        throw new HttpError(401, "This invitation was already redeemed. The signed-in browser uses its secure session cookie; ask the owner for a replacement if you need to sign in again.", "usage_limit_reached");
      }
      const live = db.prepare("SELECT * FROM sessions WHERE account_id = ? AND principal = 'user'").all(token.account_id)
        .filter((session) => Date.now() - Date.parse(session.last_seen_at) <= SESSION_IDLE_MS && Date.parse(session.expires_at) > Date.now());
      if (live.length > 0) {
        revokeAccount(token.account_id, "concurrent_sign_in", ip);
        audit(db, "system", "token.concurrent_use", token.id, { sessionCount: live.length }, ip);
        throw new HttpError(409, "This account was signed in elsewhere. Its access has been revoked; ask the owner for a replacement invitation.", "concurrent_session");
      }
      db.prepare("DELETE FROM sessions WHERE account_id = ?").run(token.account_id);
      db.prepare("UPDATE tokens SET usage_count = usage_count + 1, last_used_at = ? WHERE id = ?")
        .run(new Date().toISOString(), token.id);
      const session = newSession("user", token.account_id, token.id);
      audit(db, token.account_label, "session.created", token.account_id, { tokenId: token.id }, ip);
      const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(token.account_id);
      sendJson(res, 200, {
        authenticated: true,
        account: {
          id: account.id,
          label: account.label,
          rank: account.rank,
          settings: safeJson(account.settings_json, DEFAULT_SETTINGS),
          permissions: safeJson(account.permissions_json, []),
          features: safeJson(account.features_json, []),
        },
        csrf: session.csrf,
      }, { "Set-Cookie": cookieHeader(session.raw, config.secureCookie) });
      return;
    }

    if (method === "POST" && path === "/api/feedback") {
      const user = requirePrincipal(session, "user");
      requirePermission(user, "support");
      requireCsrf(req, user);
      const body = await readBody(req);
      const kind = body.kind;
      const subject = typeof body.subject === "string" ? body.subject.trim() : "";
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!["support", "suggestion"].includes(kind)) throw new HttpError(400, "Choose support or suggestion.");
      if (subject.length < 4 || subject.length > 120) throw new HttpError(400, "Subject must be between 4 and 120 characters.");
      if (message.length < 10 || message.length > 4000) throw new HttpError(400, "Message must be between 10 and 4000 characters.");
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare("INSERT INTO feedback(id, account_id, kind, subject, message, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, user.account_id, kind, subject, message, now);
      audit(db, user.account.label, `feedback.${kind}.submitted`, id, {}, ip);
      sendJson(res, 201, { id, status: "open", createdAt: now });
      return;
    }

    if (method === "GET" && path === "/api/admin/ranks") {
      requirePrincipal(session, "admin");
      const items = db.prepare("SELECT id, label, permissions_json, features_json, created_at FROM ranks ORDER BY label").all()
        .map((row) => ({
          id: row.id,
          label: row.label,
          permissions: safeJson(row.permissions_json, []),
          features: safeJson(row.features_json, []),
          createdAt: row.created_at,
        }));
      sendJson(res, 200, { items });
      return;
    }

    if (method === "GET" && path === "/api/admin/feedback") {
      requirePrincipal(session, "admin");
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 200);
      if (!Number.isInteger(limit) || limit < 1) throw new HttpError(400, "Limit must be between 1 and 200.");
      const items = db.prepare(`SELECT f.id, f.account_id, a.label AS account_label, f.kind, f.subject, f.message,
        f.status, f.created_at FROM feedback f JOIN accounts a ON a.id = f.account_id
        ORDER BY f.created_at DESC LIMIT ?`).all(limit).map((row) => ({
        id: row.id,
        accountId: row.account_id,
        accountLabel: row.account_label,
        kind: row.kind,
        subject: row.subject,
        message: row.message,
        status: row.status,
        createdAt: row.created_at,
      }));
      sendJson(res, 200, { items });
      return;
    }

    const feedbackStatusMatch = path.match(/^\/api\/admin\/feedback\/([0-9a-f-]{36})$/);
    if (method === "PATCH" && feedbackStatusMatch) {
      const admin = requirePrincipal(session, "admin");
      requireCsrf(req, admin);
      const body = await readBody(req);
      if (!["open", "in_progress", "resolved"].includes(body.status)) {
        throw new HttpError(400, "Choose open, in_progress, or resolved.");
      }
      const result = db.prepare("UPDATE feedback SET status = ? WHERE id = ?").run(body.status, feedbackStatusMatch[1]);
      if (!result.changes) throw new HttpError(404, "Feedback entry not found.", "not_found");
      audit(db, "owner", "feedback.status_changed", feedbackStatusMatch[1], { status: body.status }, ip);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && path === "/api/admin/ranks") {
      const admin = requirePrincipal(session, "admin");
      requireCsrf(req, admin);
      const body = await readBody(req);
      const label = typeof body.label === "string" ? body.label.trim().slice(0, 40) : "";
      const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      if (!label || !id) throw new HttpError(400, "Rank label must include letters or numbers.");
      const permissions = body.permissions ?? ["browse"];
      const features = body.features ?? [];
      if (!Array.isArray(permissions) || permissions.some((item) => !PERMISSIONS.includes(item)) || !permissions.includes("browse")) {
        throw new HttpError(400, "Choose valid account permissions, including browse.");
      }
      if (!Array.isArray(features) || features.some((item) => !FEATURES.includes(item) || !permissions.includes(item))) {
        throw new HttpError(400, "Choose valid account features that are also permitted.");
      }
      const now = new Date().toISOString();
      try {
        db.prepare("INSERT INTO ranks(id, label, permissions_json, features_json, created_at) VALUES (?, ?, ?, ?, ?)")
          .run(id, label, JSON.stringify(permissions), JSON.stringify(features), now);
      } catch (error) {
        if (error.code === "ERR_SQLITE_ERROR" && /UNIQUE/.test(error.message)) {
          throw new HttpError(409, "A rank with that label already exists.", "rank_exists");
        }
        throw error;
      }
      audit(db, "owner", "rank.created", id, { permissions, features }, ip);
      sendJson(res, 201, { item: { id, label, permissions, features, createdAt: now } });
      return;
    }

    const deleteRankMatch = path.match(/^\/api\/admin\/ranks\/([a-z0-9-]{1,40})$/);
    if (method === "DELETE" && deleteRankMatch) {
      const admin = requirePrincipal(session, "admin");
      requireCsrf(req, admin);
      if (db.prepare("SELECT COUNT(*) AS count FROM ranks").get().count <= 1) {
        throw new HttpError(409, "Keep at least one rank so new invitations can still be issued.");
      }
      const result = db.prepare("DELETE FROM ranks WHERE id = ?").run(deleteRankMatch[1]);
      if (!result.changes) throw new HttpError(404, "Rank not found.", "not_found");
      audit(db, "owner", "rank.deleted", deleteRankMatch[1], {}, ip);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && path === "/api/admin/login") {
      validateOrigin(req);
      consumeLimit(`admin:${ip}`, 6, 10 * 60_000);
      const body = await readBody(req);
      const currentOwner = db.prepare("SELECT * FROM owner WHERE id = 1").get();
      const passwordOk = typeof body.password === "string" && await verifyPassword(body.password, currentOwner.password_hash);
      const totpOk = !currentOwner.totp_enabled || (typeof body.totp === "string" && verifyTotp(totpSecret, body.totp));
      if (!passwordOk || !totpOk) {
        audit(db, "unknown", "admin.login_failed", "owner", {}, ip);
        throw new HttpError(401, "Administrator credentials were not accepted.", "invalid_admin_credentials");
      }
      const session = newSession("admin", null, null);
      audit(db, "owner", "admin.session_created", "owner", {}, ip);
      sendJson(res, 200, { authenticated: true, csrf: session.csrf }, { "Set-Cookie": cookieHeader(session.raw, config.secureCookie, false, ADMIN_SESSION_COOKIE) });
      return;
    }

    if (method === "POST" && path === "/api/browser/grant") {
      const user = requirePrincipal(session, "user");
      requirePermission(user, "browse");
      requireCsrf(req, user);
      validateOrigin(req);
      if (!req.headers.origin) throw new HttpError(403, "A same-origin browser request is required.", "origin_rejected");
      const grant = randomBytes(32).toString("base64url");
      const grantHash = hash(grant);
      proxyGrants.set(grantHash, {
        sessionId: user.id,
        expiresAt: Date.now() + SESSION_MAX_AGE_MS,
      });
      sendJson(res, 200, { grant, proxyOrigin: proxyOrigin() });
      return;
    }

    if (method === "GET" && path === "/api/me") {
      if (!session || session.principal !== "user") {
        sendJson(res, 200, { authenticated: false });
        return;
      }
      sendJson(res, 200, {
        authenticated: true,
        account: {
          id: session.account.id,
          label: session.account.label,
          rank: session.account.rank,
          settings: safeJson(session.account.settings_json, DEFAULT_SETTINGS),
          permissions: safeJson(session.account.permissions_json, []),
          features: safeJson(session.account.features_json, []),
        },
        csrf: csrfForSession(cookies[SESSION_COOKIE]),
      });
      return;
    }

    if (method === "GET" && path === "/api/session") {
      if (!session || session.principal !== "user") {
        sendJson(res, 401, { error: "Sign in to continue.", code: "authentication_required" });
        return;
      }
      sendJson(res, 200, {
        authenticated: true,
        csrf: csrfForSession(cookies[SESSION_COOKIE]),
        account: {
          id: session.account.id,
          label: session.account.label,
          rank: session.account.rank,
          settings: safeJson(session.account.settings_json, DEFAULT_SETTINGS),
          permissions: safeJson(session.account.permissions_json, []),
          features: safeJson(session.account.features_json, []),
        },
      });
      return;
    }

    if (method === "POST" && path === "/api/admin/logout") {
      const admin = requirePrincipal(session, "admin");
      requireCsrf(req, admin);
      db.prepare("DELETE FROM sessions WHERE id = ?").run(admin.id);
      audit(db, "owner", "admin.session_ended", "owner", {}, ip);
      sendJson(res, 200, { ok: true }, { "Set-Cookie": cookieHeader("", config.secureCookie, true, ADMIN_SESSION_COOKIE) });
      return;
    }

    if (method === "GET" && path === "/api/admin/me") {
      if (!session || session.principal !== "admin") {
        sendJson(res, 401, { error: "Administrator sign-in required.", code: "authentication_required" });
        return;
      }
      sendJson(res, 200, {
        authenticated: true,
        csrf: csrfForSession(cookies[ADMIN_SESSION_COOKIE]),
        twoFactorEnabled: Boolean(db.prepare("SELECT totp_enabled FROM owner WHERE id = 1").get().totp_enabled),
      });
      return;
    }

    if (method === "GET" && path === "/api/admin/site-controls") {
      requirePrincipal(session, "admin");
      sendJson(res, 200, { settings: getSiteControls() });
      return;
    }

    if (method === "PATCH" && path === "/api/admin/site-controls") {
      const admin = requirePrincipal(session, "admin");
      requireCsrf(req, admin);
      const body = await readBody(req);
      const current = getSiteControls();
      const keys = Object.keys(DEFAULT_SITE_CONTROLS);
      if (keys.some((key) => typeof body[key] !== "boolean")) {
        throw new HttpError(400, "Provide boolean values for maintenance, invitations and assistant controls.");
      }
      const settings = Object.fromEntries(keys.map((key) => [key, body[key]]));
      db.prepare("UPDATE site_settings SET value_json = ?, updated_at = ? WHERE key = 'controls'")
        .run(JSON.stringify(settings), new Date().toISOString());
      if (!current.maintenanceMode && settings.maintenanceMode) {
        for (const sessionId of proxySockets.keys()) closeProxySession(sessionId);
      }
      audit(db, "owner", "site.controls_updated", "site", { previous: current, settings }, ip);
      sendJson(res, 200, { settings });
      return;
    }

    if (method === "POST" && path === "/api/admin/desktop/ticket") {
      const admin = requirePrincipal(session, "admin");
      requireCsrf(req, admin);
      if (!/^[a-f0-9]{64}$/i.test(desktopSecret)) {
        throw new HttpError(503, "Set DESKTOP_COMPANION_SECRET in .env before pairing the local companion.", "companion_not_configured");
      }
      consumeLimit(`desktop-ticket:${admin.id}`, 6, 60_000);
      const payload = Buffer.from(JSON.stringify({
        audience: "nightjar-linux-companion",
        expiresAt: Date.now() + 90_000,
        nonce: randomBytes(24).toString("base64url"),
      })).toString("base64url");
      const signature = createHmac("sha256", desktopSecret).update(payload).digest("base64url");
      audit(db, "owner", "desktop.pairing_ticket_issued", "local-companion", { expiresInSeconds: 90 }, ip);
      sendJson(res, 200, { ticket: `${payload}.${signature}`, expiresInSeconds: 90 });
      return;
    }

    if (method === "POST" && path === "/api/auth/logout") {
      const user = requirePrincipal(session, "user");
      requireCsrf(req, user);
      db.prepare("DELETE FROM sessions WHERE id = ?").run(user.id);
      closeProxySession(user.id);
      audit(db, user.account.label, "session.ended", user.account_id, {}, ip);
      sendJson(res, 200, { ok: true }, { "Set-Cookie": cookieHeader("", config.secureCookie, true) });
      return;
    }

    if (method === "GET" && path === "/api/admin/summary") {
      requirePrincipal(session, "admin");
      if (await ollamaAvailable()) aiState.status = "running";
      const activeUserSessions = db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE principal = 'user' AND expires_at > ?").get(new Date().toISOString()).count;
      const tokenStats = db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) THEN 1 ELSE 0 END) AS active FROM tokens")
        .get(new Date().toISOString());
      const usageStats = {
        visits: db.prepare("SELECT COUNT(*) AS count FROM history").get().count,
        bookmarks: db.prepare("SELECT COUNT(*) AS count FROM bookmarks").get().count,
        assistantRequests: db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'assistant.request'").get().count,
      };
      sendJson(res, 200, {
        activeSessions: activeUserSessions,
        accounts: db.prepare("SELECT COUNT(*) AS count FROM accounts WHERE revoked_at IS NULL").get().count,
        tokens: tokenStats.total,
        activeTokens: tokenStats.active ?? 0,
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
        database: "SQLite",
        siteControls,
        localAi: { model: aiModel, autoStart: aiAutostart, serviceStatus: aiState.status, startedByApp: aiState.startedByApp, cloudDisabledForManagedServer: true },
        usage: usageStats,
      });
      return;
    }

    if (method === "GET" && path === "/api/admin/tokens") {
      requirePrincipal(session, "admin");
      const rows = db.prepare(`SELECT t.*, a.label AS account_label FROM tokens t JOIN accounts a ON a.id = t.account_id
        ORDER BY t.created_at DESC LIMIT 200`).all();
      sendJson(res, 200, { items: rows.map(rowToToken) });
      return;
    }

    if (method === "GET" && path === "/api/admin/accounts") {
      requirePrincipal(session, "admin");
      const items = db.prepare("SELECT * FROM accounts ORDER BY created_at DESC LIMIT 200").all()
        .map((row) => ({
          id: row.id,
          label: row.label,
          rank: row.rank,
          createdAt: row.created_at,
          revokedAt: row.revoked_at,
          settings: safeJson(row.settings_json, DEFAULT_SETTINGS),
          permissions: safeJson(row.permissions_json, []),
          features: safeJson(row.features_json, []),
        }));
      sendJson(res, 200, { items });
      return;
    }

    const accountMatch = path.match(/^\/api\/admin\/accounts\/([0-9a-f-]{36})$/i);
    if (method === "PATCH" && accountMatch) {
      const admin = requirePrincipal(session, "admin");
      requireCsrf(req, admin);
      const body = await readBody(req);
      const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountMatch[1]);
      if (!account) throw new HttpError(404, "Account not found.", "not_found");
      if (account.revoked_at) throw new HttpError(409, "Revoked accounts cannot be edited.", "account_revoked");
      const label = typeof body.label === "string" ? body.label.trim().slice(0, 80) : "";
      if (!label) throw new HttpError(400, "Account label is required.");
      const permissions = body.permissions;
      const features = body.features;
      if (!Array.isArray(permissions) || permissions.some((item) => !PERMISSIONS.includes(item)) || !permissions.includes("browse")) {
        throw new HttpError(400, "Choose valid account permissions, including browse.");
      }
      if (!Array.isArray(features) || features.some((item) => !FEATURES.includes(item) || !permissions.includes(item))) {
        throw new HttpError(400, "Choose valid account features that are also permitted.");
      }
      const rank = typeof body.rank === "string" ? body.rank : "";
      if (!rank || rank.length > 40) throw new HttpError(400, "Choose an account rank.");
      if (rank !== account.rank && !db.prepare("SELECT id FROM ranks WHERE id = ?").get(rank)) {
        throw new HttpError(400, "Choose an available account rank.", "invalid_rank");
      }
      const settings = normalizeSettings(body.settings ?? {}, safeJson(account.settings_json, DEFAULT_SETTINGS));
      const sessions = db.prepare("SELECT id FROM sessions WHERE account_id = ? AND principal = 'user'").all(account.id);
      db.prepare("UPDATE accounts SET label = ?, rank = ?, permissions_json = ?, features_json = ?, settings_json = ? WHERE id = ?")
        .run(label, rank, JSON.stringify(permissions), JSON.stringify(features), JSON.stringify(settings), account.id);
      db.prepare("DELETE FROM sessions WHERE account_id = ? AND principal = 'user'").run(account.id);
      for (const active of sessions) closeProxySession(active.id);
      audit(db, "owner", "account.updated", account.id, { label, rank, permissions, features, sessionCountTerminated: sessions.length }, ip);
      sendJson(res, 200, { ok: true, sessionsTerminated: sessions.length });
      return;
    }

    const revokeAccountMatch = path.match(/^\/api\/admin\/accounts\/([0-9a-f-]{36})\/revoke$/i);
    if (method === "POST" && revokeAccountMatch) {
      const admin = requirePrincipal(session, "admin");
      requireCsrf(req, admin);
      const account = db.prepare("SELECT id, revoked_at FROM accounts WHERE id = ?").get(revokeAccountMatch[1]);
      if (!account) throw new HttpError(404, "Account not found.", "not_found");
      if (!account.revoked_at) {
        db.prepare("UPDATE accounts SET revoked_at = ? WHERE id = ?").run(new Date().toISOString(), account.id);
        revokeAccount(account.id, "owner_revoked", ip, "owner");
      }
      audit(db, "owner", "account.revoked", account.id, {}, ip);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && path === "/api/admin/sessions") {
      requirePrincipal(session, "admin");
      const items = db.prepare(`SELECT s.id, s.account_id, s.token_id, s.created_at, s.last_seen_at, s.expires_at, a.label AS account_label
        FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.principal = 'user' ORDER BY s.last_seen_at DESC`).all()
        .map((row) => ({ id: row.id, accountId: row.account_id, tokenId: row.token_id, accountLabel: row.account_label, createdAt: row.created_at, lastSeenAt: row.last_seen_at, expiresAt: row.expires_at }));
      sendJson(res, 200, { items });
      return;
    }

    if (method === "POST" && path === "/api/admin/tokens") {
      const admin = requirePrincipal(session, "admin");
      requireCsrf(req, admin);
      if (!siteControls.invitationsEnabled) throw new HttpError(423, "New invitations are disabled by the owner.", "invitations_disabled");
      const body = await readBody(req);
      const label = typeof body.label === "string" ? body.label.trim().slice(0, 80) : "";
      const requestedAccountLabel = typeof body.accountLabel === "string" ? body.accountLabel.trim().slice(0, 80) : "";
      if (!label) throw new HttpError(400, "Token label is required.");
      const accountId = typeof body.accountId === "string" && body.accountId
        ? body.accountId
        : randomUUID();
      const existingAccount = db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId);
      if (existingAccount && existingAccount.revoked_at) throw new HttpError(400, "Revoked accounts cannot receive replacement invitations.");
      let rankId = typeof body.rank === "string" && body.rank ? body.rank : (existingAccount?.rank ?? "standard");
      let rank = db.prepare("SELECT * FROM ranks WHERE id = ?").get(rankId);
      if (!rank && existingAccount && !body.rank) {
        rank = { permissions_json: existingAccount.permissions_json, features_json: existingAccount.features_json };
      } else if (!rank && !existingAccount && !body.rank) {
        rank = db.prepare("SELECT * FROM ranks ORDER BY label LIMIT 1").get();
        rankId = rank?.id;
      }
      if (!rank) throw new HttpError(400, "Choose an available account rank.", "invalid_rank");
      const permissions = body.permissions ?? (existingAccount && !body.rank ? safeJson(existingAccount.permissions_json, []) : safeJson(rank.permissions_json, []));
      const features = body.features ?? (existingAccount && !body.rank ? safeJson(existingAccount.features_json, []) : safeJson(rank.features_json, []));
      if (!Array.isArray(permissions) || permissions.some((item) => !PERMISSIONS.includes(item)) || !permissions.includes("browse")) {
        throw new HttpError(400, "Choose valid account permissions, including browse.");
      }
      if (!Array.isArray(features) || features.some((item) => !FEATURES.includes(item) || !permissions.includes(item))) {
        throw new HttpError(400, "Choose valid account features that are also permitted.");
      }
      let expiresAt = null;
      if (body.expiresAt !== undefined && body.expiresAt !== null && body.expiresAt !== "") {
        if (typeof body.expiresAt !== "string" || !Number.isFinite(Date.parse(body.expiresAt)) || Date.parse(body.expiresAt) <= Date.now()) {
          throw new HttpError(400, "Expiration must be a future date.");
        }
        expiresAt = new Date(body.expiresAt).toISOString();
      }
      const usageLimit = body.usageLimit === "" || body.usageLimit === null || body.usageLimit === undefined
        ? 1 : Number(body.usageLimit);
      if (usageLimit !== 1) {
        throw new HttpError(400, "Invitation tokens can be redeemed once by one person. The browser session cookie keeps that person signed in.");
      }
      const accountLabel = requestedAccountLabel || existingAccount?.label || label;
      if (!existingAccount) {
        const settings = normalizeSettings(body.settings ?? {}, DEFAULT_SETTINGS);
        db.prepare(`INSERT INTO accounts(id, label, settings_json, permissions_json, features_json, rank, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(accountId, accountLabel, JSON.stringify(settings), JSON.stringify(permissions), JSON.stringify(features), rankId, new Date().toISOString());
      } else {
        const updated = body.settings === undefined
          ? safeJson(existingAccount.settings_json, DEFAULT_SETTINGS)
          : normalizeSettings(body.settings, safeJson(existingAccount.settings_json, DEFAULT_SETTINGS));
        db.prepare("UPDATE accounts SET label = ?, settings_json = ?, permissions_json = ?, features_json = ?, rank = ? WHERE id = ?")
          .run(accountLabel, JSON.stringify(updated), JSON.stringify(permissions), JSON.stringify(features), rankId, accountId);
      }
      const value = randomBytes(32).toString("base64url");
      const tokenId = randomUUID();
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO tokens(id, account_id, token_hash, label, permissions_json, rank, expires_at, usage_limit, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(tokenId, accountId, hash(value), label, JSON.stringify(permissions), rankId, expiresAt, usageLimit, now);
      audit(db, "owner", "token.created", tokenId, { accountId, rank: rankId, permissions, expiresAt, usageLimit }, ip);
      sendJson(res, 201, { token: value, item: {
        id: tokenId,
        accountId,
        accountLabel,
        label,
        rank: rankId,
        permissions,
        expiresAt,
        usageLimit,
        usageCount: 0,
        createdAt: now,
        lastUsedAt: null,
        revokedAt: null,
        status: "active",
      } });
      return;
    }

    const revokeMatch = path.match(/^\/api\/admin\/tokens\/([0-9a-f-]{36})\/revoke$/);
    if (method === "POST" && revokeMatch) {
      const admin = requirePrincipal(session, "admin");
      requireCsrf(req, admin);
      const row = db.prepare("SELECT * FROM tokens WHERE id = ?").get(revokeMatch[1]);
      if (!row) throw new HttpError(404, "Invitation not found.", "not_found");
      db.prepare("UPDATE tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?").run(new Date().toISOString(), row.id);
      const sessions = db.prepare("SELECT id FROM sessions WHERE token_id = ?").all(row.id);
      db.prepare("DELETE FROM sessions WHERE token_id = ?").run(row.id);
      for (const item of sessions) closeProxySession(item.id);
      audit(db, "owner", "token.revoked", row.id, { accountId: row.account_id }, ip);
      sendJson(res, 200, { ok: true });
      return;
    }

    const terminateMatch = path.match(/^\/api\/admin\/sessions\/([0-9a-f-]{36})\/terminate$/);
    if (method === "POST" && terminateMatch) {
      const admin = requirePrincipal(session, "admin");
      requireCsrf(req, admin);
      const row = db.prepare("SELECT id, account_id FROM sessions WHERE id = ? AND principal = 'user'").get(terminateMatch[1]);
      if (!row) throw new HttpError(404, "Session not found.", "not_found");
      db.prepare("DELETE FROM sessions WHERE id = ?").run(row.id);
      closeProxySession(row.id);
      audit(db, "owner", "session.terminated", row.id, { accountId: row.account_id }, ip);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && path === "/api/admin/audit") {
      requirePrincipal(session, "admin");
      const limit = pageLimit(url);
      const before = url.searchParams.get("before");
      const rows = before
        ? db.prepare("SELECT * FROM audit_logs WHERE created_at < ? ORDER BY created_at DESC LIMIT ?").all(before, limit)
        : db.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?").all(limit);
      sendJson(res, 200, { items: rows.map((row) => ({
        id: row.id, actor: row.actor, action: row.action, subject: row.subject,
        detail: safeJson(row.detail_json, {}), ipAddress: row.ip_address, createdAt: row.created_at,
      })) });
      return;
    }

    if (method === "GET" && path === "/api/settings") {
      const user = requirePrincipal(session, "user");
      requirePermission(user, "settings");
      sendJson(res, 200, { settings: safeJson(user.account.settings_json, DEFAULT_SETTINGS) });
      return;
    }

    if (method === "PUT" && path === "/api/settings") {
      const user = requirePrincipal(session, "user");
      requireCsrf(req, user);
      requirePermission(user, "settings");
      const body = await readBody(req);
      const settings = normalizeSettings(body.settings, safeJson(user.account.settings_json, DEFAULT_SETTINGS));
      db.prepare("UPDATE accounts SET settings_json = ? WHERE id = ?").run(JSON.stringify(settings), user.account_id);
      sendJson(res, 200, { settings });
      return;
    }

    if (method === "POST" && path === "/api/history") {
      const user = requirePrincipal(session, "user");
      requireCsrf(req, user);
      requirePermission(user, "history");
      const body = await readBody(req);
      if (!isSafeWebUrl(body.url) || typeof body.title !== "string") throw new HttpError(400, "History requires a valid HTTP(S) URL and title.");
      db.prepare("INSERT INTO history(id, account_id, url, title, visited_at) VALUES (?, ?, ?, ?, ?)")
        .run(randomUUID(), user.account_id, body.url, body.title.slice(0, 300), new Date().toISOString());
      sendJson(res, 201, { ok: true });
      return;
    }

    if (method === "GET" && path === "/api/history") {
      const user = requirePrincipal(session, "user");
      requirePermission(user, "history");
      const limit = pageLimit(url);
      const before = parseCursor(url);
      const rows = before
        ? db.prepare("SELECT * FROM history WHERE account_id = ? AND (visited_at < ? OR (visited_at = ? AND id < ?)) ORDER BY visited_at DESC, id DESC LIMIT ?").all(user.account_id, before.timestamp, before.timestamp, before.id, limit)
        : db.prepare("SELECT * FROM history WHERE account_id = ? ORDER BY visited_at DESC, id DESC LIMIT ?").all(user.account_id, limit);
      const last = rows.at(-1);
      sendJson(res, 200, {
        items: rows.map((row) => ({ id: row.id, url: row.url, title: row.title, visitedAt: row.visited_at })),
        nextCursor: last ? `${last.visited_at}|${last.id}` : null,
      });
      return;
    }

    const historyItem = path.match(/^\/api\/history\/([0-9a-f-]{36})$/);
    if (method === "DELETE" && historyItem) {
      const user = requirePrincipal(session, "user");
      requireCsrf(req, user);
      requirePermission(user, "history");
      const result = db.prepare("DELETE FROM history WHERE id = ? AND account_id = ?").run(historyItem[1], user.account_id);
      if (!result.changes) throw new HttpError(404, "History entry not found.", "not_found");
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "DELETE" && path === "/api/history") {
      const user = requirePrincipal(session, "user");
      requireCsrf(req, user);
      requirePermission(user, "history");
      db.prepare("DELETE FROM history WHERE account_id = ?").run(user.account_id);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && path === "/api/bookmarks") {
      const user = requirePrincipal(session, "user");
      requirePermission(user, "bookmarks");
      const limit = pageLimit(url);
      const before = parseCursor(url);
      const rows = before
        ? db.prepare("SELECT * FROM bookmarks WHERE account_id = ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?").all(user.account_id, before.timestamp, before.timestamp, before.id, limit)
        : db.prepare("SELECT * FROM bookmarks WHERE account_id = ? ORDER BY created_at DESC, id DESC LIMIT ?").all(user.account_id, limit);
      const last = rows.at(-1);
      sendJson(res, 200, {
        items: rows.map((row) => ({ id: row.id, url: row.url, title: row.title, createdAt: row.created_at })),
        nextCursor: last ? `${last.created_at}|${last.id}` : null,
      });
      return;
    }

    if (method === "GET" && path === "/api/bookmarks/contains") {
      const user = requirePrincipal(session, "user");
      requirePermission(user, "bookmarks");
      const address = url.searchParams.get("url");
      if (!isSafeWebUrl(address)) throw new HttpError(400, "A valid HTTP(S) URL is required.");
      const row = db.prepare("SELECT id, url, title, created_at FROM bookmarks WHERE account_id = ? AND url = ?")
        .get(user.account_id, address);
      sendJson(res, 200, {
        bookmark: row ? { id: row.id, url: row.url, title: row.title, createdAt: row.created_at } : null,
      });
      return;
    }

    if (method === "POST" && path === "/api/bookmarks") {
      const user = requirePrincipal(session, "user");
      requireCsrf(req, user);
      requirePermission(user, "bookmarks");
      const body = await readBody(req);
      if (!isSafeWebUrl(body.url) || typeof body.title !== "string") throw new HttpError(400, "Bookmark requires a valid HTTP(S) URL and title.");
      const id = randomUUID();
      try {
        db.prepare("INSERT INTO bookmarks(id, account_id, url, title, created_at) VALUES (?, ?, ?, ?, ?)")
          .run(id, user.account_id, body.url, body.title.slice(0, 300), new Date().toISOString());
      } catch (error) {
        if (error.code === "ERR_SQLITE_ERROR" && error.message.startsWith("UNIQUE constraint failed: bookmarks.account_id, bookmarks.url")) {
          throw new HttpError(409, "That page is already bookmarked.", "already_bookmarked");
        }
        throw error;
      }
      sendJson(res, 201, { id });
      return;
    }

    const bookmarkItem = path.match(/^\/api\/bookmarks\/([0-9a-f-]{36})$/);
    if (method === "DELETE" && bookmarkItem) {
      const user = requirePrincipal(session, "user");
      requireCsrf(req, user);
      requirePermission(user, "bookmarks");
      const result = db.prepare("DELETE FROM bookmarks WHERE id = ? AND account_id = ?").run(bookmarkItem[1], user.account_id);
      if (!result.changes) throw new HttpError(404, "Bookmark not found.", "not_found");
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && path === "/api/browser/resolve") {
      const user = requirePrincipal(session, "user");
      requirePermission(user, "browse");
      const address = url.searchParams.get("q") ?? "";
      const settings = safeJson(user.account.settings_json, DEFAULT_SETTINGS);
      sendJson(res, 200, { url: normalizeAddress(address, settings.searchProvider) });
      return;
    }

    if (method === "GET" && path === "/api/capabilities") {
      const user = requirePrincipal(session, "user");
      const features = safeJson(user.account.features_json, []);
      const permissions = safeJson(user.account.permissions_json, []);
      const aiAllowed = siteControls.assistantEnabled && features.includes("assistant") && permissions.includes("assistant");
      let modelInstalled = false;
      let reachable = false;
      if (aiAllowed) {
        try {
          const response = await ollamaFetch("http://127.0.0.1:11434/api/tags", { redirect: "error", signal: AbortSignal.timeout(1500) });
          reachable = response.ok;
          if (reachable) {
            const tags = await response.json();
            modelInstalled = Array.isArray(tags.models) && tags.models.some((item) => item.name === aiModel || item.model === aiModel);
          }
          aiState.status = reachable ? "running" : aiState.status;
        } catch {
          reachable = false;
          if (aiAutostart && aiState.startedByApp) aiState.status = "starting";
        }
      }
      sendJson(res, 200, {
        downloads: { available: false, reason: "A web app cannot observe or manage host-browser downloads. This requires a signed desktop application." },
        desktopControl: { available: false, reason: "No desktop companion is installed or paired. Remote input and screen sharing are intentionally unavailable here." },
        ai: {
          allowed: aiAllowed,
          reachable,
          model: aiModel,
          modelInstalled,
          serviceStatus: aiAllowed ? aiState.status : "not_allowed",
          startedByApp: aiState.startedByApp,
          reason: !siteControls.assistantEnabled ? "The owner has disabled local assistant access for this site." : (!aiAllowed ? "The account does not have local assistant permission." : (!reachable ? "The local Ollama service is not responding yet." : (!modelInstalled ? `Model ${aiModel} is not installed. Install it locally with Ollama before chatting.` : ""))),
        },
        features,
      });
      return;
    }

    if (method === "POST" && path === "/api/ai/chat") {
      const user = requirePrincipal(session, "user");
      requireCsrf(req, user);
      requirePermission(user, "assistant");
      if (!siteControls.assistantEnabled) throw new HttpError(403, "The owner has disabled local assistant access for this site.", "assistant_disabled");
      consumeLimit(`ai:${user.account_id}`, 30, 5 * 60_000);
      const body = await readBody(req);
      if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 20) {
        throw new HttpError(400, "Send between 1 and 20 chat messages.");
      }
      const messages = [];
      let totalChars = 0;
      for (const message of body.messages) {
        if (!message || !["user", "assistant"].includes(message.role) || typeof message.content !== "string" || !message.content.trim() || message.content.length > 8000) {
          throw new HttpError(400, "Chat messages must contain a supported role and up to 8,000 characters.");
        }
        totalChars += message.content.length;
        messages.push({ role: message.role, content: message.content });
      }
      if (totalChars > 24_000 || messages.at(-1).role !== "user") {
        throw new HttpError(400, "Chat context is too large or does not end with a user message.");
      }
      if (activeAiRequests >= 1) throw new HttpError(429, "The local model is busy with another response. Try again shortly.", "ai_busy");
      activeAiRequests += 1;
      let upstream;
      const streamAbort = new AbortController();
      try {
        upstream = await ollamaFetch("http://127.0.0.1:11434/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
          redirect: "error",
          signal: AbortSignal.any([streamAbort.signal, AbortSignal.timeout(180_000)]),
          body: JSON.stringify({
            model: aiModel,
            stream: true,
            think: false,
            options: { num_ctx: 4096, num_predict: 512 },
            messages: [
              {
                role: "system",
                content: "You are Nightjar's local assistant. Help with general questions and concise writing. You have no access to browser tabs, website content, local files, credentials, desktop sharing, or remote controls. Do not claim to have used tools or accessed the device.",
              },
              ...messages,
            ],
          }),
        });
      } catch {
        activeAiRequests -= 1;
        throw new HttpError(503, "The local Ollama service is unavailable. It starts automatically when configured; check its status and try again.", "ai_unavailable");
      }
      if (!upstream.ok || !upstream.body) {
        const detail = (await upstream.text().catch(() => "")).slice(0, 300);
        activeAiRequests -= 1;
        if (upstream.status === 404) throw new HttpError(503, `Ollama could not find ${aiModel}. Install that model locally, then retry.`, "ai_model_missing");
        throw new HttpError(502, `Local Ollama returned an error${detail ? `: ${detail}` : "."}`, "ai_upstream_error");
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
      });
      res.flushHeaders?.();
      const onClose = () => streamAbort.abort();
      res.once("close", onClose);
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        let finished = false;
        while (true) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            let chunk;
            try {
              chunk = JSON.parse(line);
            } catch {
              continue;
            }
            const text = chunk.message?.content;
            if (typeof text === "string" && text && !res.destroyed) res.write(`data: ${JSON.stringify({ text })}\n\n`);
            if (chunk.done) {
              if (!res.destroyed) res.write("data: {\"done\":true}\n\n");
              finished = true;
              break;
            }
          }
          if (done || finished || res.destroyed) break;
        }
      } catch (error) {
        if (!res.destroyed && !streamAbort.signal.aborted) res.write(`data: ${JSON.stringify({ error: "Local model streaming failed. Try again." })}\n\n`);
      } finally {
        reader.releaseLock();
        activeAiRequests -= 1;
        res.end();
        res.removeListener("close", onClose);
      }
      audit(db, user.account.label, "assistant.request", user.account_id, { messageCount: messages.length, model: aiModel }, ip);
      return;
    }

    throw new HttpError(404, "API route not found.", "not_found");
  }

  function securityHeaders(res, isHtml = false, isAdmin = false) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), display-capture=()");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    if (isHtml) {
      res.setHeader("Content-Security-Policy", [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        `frame-src ${proxyOrigin()}`,
        `img-src 'self' data: https:${isAdmin ? " blob:" : ""}`,
        "font-src 'self' data:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        `connect-src 'self'${isAdmin ? " http://127.0.0.1:4175" : ""}`,
        "upgrade-insecure-requests",
      ].join("; "));
    }
  }

  async function route(req, res) {
    const start = Date.now();
    const url = new URL(req.url, "http://nightjar.local");
    try {
      if (url.pathname.startsWith("/api/")) {
        await routeApi(req, res, url);
      } else {
        if (!["GET", "HEAD"].includes(req.method)) throw new HttpError(405, "Method not allowed.");
        const pathname = url.pathname === "/" ? "/index.html" : (url.pathname === "/admin" ? "/admin.html" : url.pathname);
        const filePath = resolve(PUBLIC_ROOT, `.${decodeURIComponent(pathname)}`);
        if (filePath !== PUBLIC_ROOT && !filePath.startsWith(PUBLIC_ROOT + sep)) throw new HttpError(404, "Not found.", "not_found");
        const data = await readFile(filePath);
        securityHeaders(res, extname(filePath) === ".html", pathname === "/admin" || pathname === "/admin.html");
        res.setHeader("Content-Type", MIME_TYPES[extname(filePath)] ?? "application/octet-stream");
        res.setHeader("Cache-Control", extname(filePath) === ".html" ? "no-store" : "public, max-age=3600");
        res.statusCode = 200;
        res.end(req.method === "HEAD" ? undefined : data);
      }
    } catch (error) {
      const known = error instanceof HttpError;
      const status = known ? error.status : 500;
      const message = known ? error.message : "The request could not be completed.";
      if (!known) console.error(JSON.stringify({ level: "error", message: error.message, path: url.pathname, method: req.method }));
      if (!res.headersSent) sendJson(res, status, { error: message, code: known ? error.code : "internal_error" });
      else res.destroy();
    } finally {
      const durationMs = Date.now() - start;
      if (req.url?.startsWith("/api/") && durationMs > 1000) {
        console.info(JSON.stringify({ level: "info", method: req.method, path: url.pathname, status: res.statusCode, durationMs }));
      }
    }
  }

  const webApp = express();
  webApp.disable("x-powered-by");
  webApp.use((req, res) => { void route(req, res); });
  server = createServer(webApp);

  const proxyApp = express();
  proxyApp.disable("x-powered-by");
  proxyApp.use((req, res) => { void routeProxy(req, res); });
  proxyServer = createServer(proxyApp);

  async function routeProxy(req, res) {
    const url = new URL(req.url, proxyOrigin());
    try {
      if (!["GET", "HEAD"].includes(req.method)) throw new HttpError(405, "Method not allowed.");
      const filePath = proxyAssetPath(url.pathname);
      const data = await readFile(filePath);
      const extension = extname(filePath);
      res.setHeader("Content-Type", MIME_TYPES[extension] ?? "application/octet-stream");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      res.setHeader("Cache-Control", extension === ".html" ? "no-store" : "public, max-age=3600");
      if (extension === ".html") {
        const appPort = server?.address()?.port ?? Number(env("PORT", "4173"));
        const appOrigins = configuredAppOrigin
          ? configuredAppOrigin
          : [`http://127.0.0.1:${appPort}`, `http://localhost:${appPort}`].join(" ");
        res.setHeader("Content-Security-Policy", [
          "default-src 'self'",
          "base-uri 'self'",
          "object-src 'none'",
          "form-action 'self'",
          `frame-ancestors ${appOrigins}`,
          "frame-src 'self' data: blob:",
          "img-src 'self' data: blob: https: http:",
          "font-src 'self' data: https: http:",
          "style-src 'self' 'unsafe-inline'",
          "script-src 'self' 'unsafe-eval' 'sha256-YOor7VYcglFdKUc0YXTT9tDRe3nHGs6MXznzTO1OHkA='",
          "connect-src 'self' ws: wss: https: http:",
          "worker-src 'self' blob:",
        ].join("; "));
      }
      res.statusCode = 200;
      res.end(req.method === "HEAD" ? undefined : data);
    } catch (error) {
      const known = error instanceof HttpError;
      if (!known) console.error(JSON.stringify({ level: "error", message: error.message, path: url.pathname, method: req.method }));
      res.statusCode = known ? error.status : 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.end(known ? error.message : "Not found.");
    }
  }

  function proxyAssetPath(pathname) {
    const assets = new Map([
      ["/", resolve(PUBLIC_ROOT, "proxy-shell.html")],
      ["/proxy-shell.html", resolve(PUBLIC_ROOT, "proxy-shell.html")],
      ["/proxy-shell.css", resolve(PUBLIC_ROOT, "proxy-shell.css")],
      ["/dist/proxy-shell.js", resolve(PUBLIC_ROOT, "dist/proxy-shell.js")],
      ["/sw.js", resolve(PUBLIC_ROOT, "sw.js")],
      ["/scram/scramjet.bundle.js", resolve(ROOT, "node_modules/@mercuryworkshop/scramjet/dist/scramjet.bundle.js")],
      ["/scram/scramjet.all.js", resolve(ROOT, "node_modules/@mercuryworkshop/scramjet/dist/scramjet.all.js")],
      ["/scram/scramjet.sync.js", resolve(ROOT, "node_modules/@mercuryworkshop/scramjet/dist/scramjet.sync.js")],
      ["/scram/scramjet.wasm.wasm", resolve(ROOT, "node_modules/@mercuryworkshop/scramjet/dist/scramjet.wasm.wasm")],
      ["/baremux/worker.js", resolve(ROOT, "node_modules/@mercuryworkshop/bare-mux/dist/worker.js")],
      ["/baremux/index.mjs", resolve(ROOT, "node_modules/@mercuryworkshop/bare-mux/dist/index.mjs")],
      ["/epoxy/index.mjs", resolve(ROOT, "node_modules/@mercuryworkshop/epoxy-transport/dist/index.mjs")],
    ]);
    const filePath = assets.get(pathname);
    if (!filePath) throw new HttpError(404, "Not found.", "not_found");
    return filePath;
  }

  proxyServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, proxyOrigin());
    const origin = req.headers.origin;
    const grantParameter = url.searchParams.get("grant");
    const grant = typeof grantParameter === "string" && grantParameter.endsWith("/")
      ? grantParameter.slice(0, -1)
      : grantParameter ?? "";
    const record = proxyGrants.get(hash(grant));
    const sessionRow = record && record.expiresAt > Date.now()
      ? db.prepare(`SELECT s.id, s.account_id, s.last_seen_at, s.expires_at, a.revoked_at
        FROM sessions s JOIN accounts a ON a.id = s.account_id
        WHERE s.id = ? AND s.principal = 'user'`).get(record.sessionId)
      : null;
    if (
      url.pathname !== "/wisp/" ||
      !record ||
      record.expiresAt <= Date.now() ||
      !sessionRow ||
      sessionRow.revoked_at ||
      Date.now() - Date.parse(sessionRow.last_seen_at) > SESSION_IDLE_MS ||
      Date.parse(sessionRow.expires_at) <= Date.now() ||
      origin !== proxyOrigin()
    ) {
      socket.destroy();
      return;
    }
    try {
      consumeLimit(`wisp:${clientAddress(req)}`, 100, 60_000);
    } catch {
      socket.destroy();
      return;
    }
    const sessionSockets = proxySockets.get(sessionRow.id) ?? { accountId: sessionRow.account_id, items: new Set() };
    if (sessionSockets.items.size >= 8) {
      socket.destroy();
      return;
    }
    sessionSockets.items.add(socket);
    proxySockets.set(sessionRow.id, sessionSockets);
    socket.once("close", () => {
      sessionSockets.items.delete(socket);
      if (!sessionSockets.items.size) proxySockets.delete(sessionRow.id);
    });
    try {
      req.url = "/wisp/";
      wisp.routeRequest(req, socket, head);
    } catch {
      socket.destroy();
    }
  });

  return {
    server,
    proxyServer,
    db,
    stop() {
      clearInterval(proxyMaintenanceTimer);
      for (const sessionId of proxySockets.keys()) closeProxySession(sessionId);
      if (ollamaChild) {
        ollamaChild.kill("SIGTERM");
        ollamaChild = null;
      }
    },
  };
}

let consoleInput = null;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = env("HOST", "127.0.0.1");
  const port = Number(env("PORT", "4173"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535.");
  const app = await createApp();
  let shuttingDown = false;
  const close = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.stop();
    if (consoleInput) consoleInput.close();
    app.server.close(() => {
      app.proxyServer.close(() => {
        app.db.close();
        process.exit(0);
      });
    });
  };
  app.proxyServer.listen(Number(env("SCRAMJET_PORT", "4174")), env("SCRAMJET_HOST", "127.0.0.1"), () => {
    console.info(JSON.stringify({ level: "info", message: "Scramjet browsing engine is ready", host: env("SCRAMJET_HOST", "127.0.0.1"), port: app.proxyServer.address().port, origin: env("SCRAMJET_ORIGIN", `http://${env("SCRAMJET_HOST", "127.0.0.1")}:${app.proxyServer.address().port}`) }));
  });
  app.server.listen(port, host, () => {
    console.info(JSON.stringify({ level: "info", message: "Nightjar is ready", host, port, database: resolve(env("DATABASE_PATH", resolve(ROOT, "data/nightjar.sqlite"))) }));
    if (process.stdin.isTTY) {
      console.info("Owner commands are available in this terminal. Type `help` for token and account management.");
      consoleInput = createInterface({ input: process.stdin, output: process.stdout, prompt: "nightjar> " });
      consoleInput.on("line", async (line) => {
        const trimmed = line.trim();
        if (!trimmed) {
          consoleInput.prompt();
          return;
        }
        if (trimmed === "help") {
          printConsoleHelp();
          consoleInput.prompt();
          return;
        }
        if (trimmed === "exit" || trimmed === "quit") {
          console.info("Stopping Nightjar…");
          close();
          return;
        }
        try {
          const result = await runAdminCommand(tokenizeConsoleInput(trimmed));
          printConsoleResult(result);
        } catch (error) {
          console.error(`Nightjar: ${error.message}`);
        }
        if (!shuttingDown) consoleInput.prompt();
      });
      consoleInput.on("SIGINT", close);
      consoleInput.on("close", () => {
        if (!shuttingDown) close();
      });
      consoleInput.prompt();
    }
  });
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

function tokenizeConsoleInput(line) {
  const values = [];
  let current = "";
  let quote = "";
  let escaped = false;
  for (const char of line) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (char === quote) quote = "";
      else current += char;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        values.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (escaped) current += "\\";
  if (quote) throw new Error("Unclosed quote. Wrap names with spaces in double quotes.");
  if (current) values.push(current);
  return values;
}

function printConsoleHelp() {
  console.log(`Owner commands (changes are saved immediately)
  help
accounts
tokens
ranks list
token make [label] [rank]
token renew <account-id> [label] [rank]
tokens create --label "Guest laptop" [options]
tokens revoke <token-id>
ranks create "Study group" [--permissions ...] [--features ...]
ranks delete <rank-id>
revoke <token-id>
quit
 
Create options:
--account-label "Guest"          Account label
--account-id <uuid>              Add a replacement invitation to an existing account
--rank <rank-id>                  Apply an access preset
--uses 1                         Every invitation is single-use
--expires <date-or-timestamp>    e.g. 2026-12-31
--permissions <comma-list>       browse,bookmarks,history,settings,assistant,games,support
--features <comma-list|none>     bookmarks,history,settings,assistant,games,support
 
Each invitation can be redeemed once. The signed-in browser uses an HttpOnly cookie session;
use \`token renew\` to issue a replacement. Ranks only grant browser features, never owner access.
Enabled features must also appear in permissions. A token is shown only once.
Revoking a token also terminates the session created by that token.`);
}

function printConsoleResult(result) {
  if (result.type === "help") {
    printConsoleHelp();
  } else if (result.type === "created") {
    console.log(`Invitation created for ${result.accountLabel} (${result.rank}). Copy this token now; it cannot be retrieved later:\n\n${result.token}\n\nToken ID: ${result.id}\nAccount ID: ${result.accountId}\nPermissions: ${result.permissions.join(", ")}\nFeatures: ${result.features.length ? result.features.join(", ") : "none"}\nRedemptions: one\nExpires: ${result.expiresAt ?? "never"}`);
  } else if (result.type === "revoked") {
    console.log(`Invitation ${result.id} revoked. Any session established with that invitation was terminated.`);
  } else if (result.type === "tokens") {
    if (!result.items.length) console.log("No invitations yet.");
    for (const item of result.items) {
      console.log(`${item.status.padEnd(8)} ${item.id}  ${item.account_label} / ${item.label}  rank=${item.rank}  ${item.usage_count}/1 redemptions  [${item.permissions.join(", ")}]`);
    }
  } else if (result.type === "ranks") {
    if (!result.items.length) console.log("No access ranks are configured.");
    for (const item of result.items) console.log(`${item.id.padEnd(16)} ${item.label} [${item.permissions.join(", ")}] features=[${item.features.join(", ") || "none"}]`);
  } else if (result.type === "rank-created") {
    console.log(`Rank "${result.label}" created as ${result.id}.`);
  } else if (result.type === "rank-deleted") {
    console.log(`Rank ${result.id} removed from new invitation choices.`);
  } else if (result.type === "accounts") {
    if (!result.items.length) console.log("No accounts yet.");
    for (const item of result.items) {
      console.log(`${item.revoked_at ? "revoked" : "active "} ${item.id}  ${item.label}  rank=${item.rank}  permissions=[${item.permissions.join(", ")}] features=[${item.features.join(", ") || "none"}]`);
    }
  }
}
