import { createServer } from "node:http";
import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { createRequire } from "node:module";
import { readFile, mkdir } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash, createHmac } from "node:crypto";
import { promisify } from "node:util";
import { spawn, spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { delimiter } from "node:path";
import { constants as fsConstants } from "node:fs";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import express from "express";

const scrypt = promisify(scryptCallback);
const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = resolve(ROOT, "public");
const require = createRequire(import.meta.url);
const { RammerheadProxy, RammerheadSession, RammerheadJSMemCache } = require("rammerhead");
const { parseProxyUrl } = require("testcafe-hammerhead");
const destinationRequestAgent = require("testcafe-hammerhead/lib/request-pipeline/destination-request/agent");
const SESSION_COOKIE = "nj_session";
const ADMIN_SESSION_COOKIE = "nj_admin";
const MAX_BODY_BYTES = 64 * 1024;
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const SESSION_IDLE_MS = SESSION_MAX_AGE_MS;
const ADMIN_REMEMBER_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const GUEST_SESSION_MAX_AGE_MS = 30 * 60 * 1000;
const GUEST_SESSION_IDLE_MS = 10 * 60 * 1000;
const GUEST_PROXY_REQUEST_LIMIT = 1200;
const GUEST_PROXY_SOCKET_LIMIT = 24;

function sessionIdleLimitMs(session) {
  const sessionAgeMs = Date.parse(session.expires_at) - Date.parse(session.created_at);
  return session.principal === "admin" && sessionAgeMs > SESSION_MAX_AGE_MS
    ? ADMIN_REMEMBER_MAX_AGE_MS
    : SESSION_IDLE_MS;
}
const DESKTOP_RELAY_IDLE_MS = 60_000;
const PERMISSIONS = ["browse", "bookmarks", "history", "settings", "assistant", "games", "support", "notes", "storage", "chat", "bugs"];
const FEATURES = ["bookmarks", "history", "settings", "assistant", "games", "support", "notes", "storage", "chat", "bugs"];
const BASIC_AI_REQUEST_LIMIT = 20;
const LIMITED_AI_RANKS = new Set(["basic", "basic-plus"]);
const CUSTOMIZABLE_TOOLBAR_ITEMS = ["bookmarks-open", "history-open", "downloads-open", "assistant-open", "games-open", "open-regular", "theme-toggle", "settings-open", "help-open", "admin-link"];
const DEFAULT_SITE_CONTROLS = {
  maintenanceMode: false,
  invitationsEnabled: true,
  assistantEnabled: true,
};
const DEFAULT_RANKS = [
  { id: "basic", label: "Basic", permissions: ["browse", "assistant", "notes", "storage", "chat", "bugs"], features: ["assistant", "notes", "storage", "chat", "bugs"] },
  { id: "basic-plus", label: "Basic+", permissions: ["browse", "bookmarks", "history", "assistant", "notes", "storage", "chat", "bugs"], features: ["bookmarks", "history", "assistant", "notes", "storage", "chat", "bugs"] },
  { id: "ai", label: "AI", permissions: ["browse", "bookmarks", "history", "assistant", "notes", "storage", "chat", "bugs"], features: ["bookmarks", "history", "assistant", "notes", "storage", "chat", "bugs"] },
  { id: "full-minus", label: "Full-", permissions: ["browse", "bookmarks", "history", "settings", "assistant", "games", "support", "notes", "storage", "chat", "bugs"], features: ["bookmarks", "history", "settings", "assistant", "games", "support", "notes", "storage", "chat", "bugs"] },
  { id: "owner", label: "Owner", permissions: ["browse", "bookmarks", "history", "settings", "assistant", "games", "support", "notes", "storage", "chat", "bugs"], features: ["bookmarks", "history", "settings", "assistant", "games", "support", "notes", "storage", "chat", "bugs"] },
  { id: "standard", label: "Standard", permissions: ["browse", "bookmarks", "history", "notes", "storage", "chat", "bugs"], features: ["bookmarks", "history", "notes", "storage", "chat", "bugs"] },
  { id: "with-ai", label: "With AI", permissions: ["browse", "bookmarks", "history", "assistant", "notes", "storage", "chat", "bugs"], features: ["bookmarks", "history", "assistant", "notes", "storage", "chat", "bugs"] },
  { id: "without-ai", label: "Without AI", permissions: ["browse", "bookmarks", "history", "notes", "storage", "chat", "bugs"], features: ["bookmarks", "history", "notes", "storage", "chat", "bugs"] },
  { id: "full", label: "Full", permissions: ["browse", "bookmarks", "history", "settings", "assistant", "games", "support", "notes", "storage", "chat", "bugs"], features: ["bookmarks", "history", "settings", "assistant", "games", "support", "notes", "storage", "chat", "bugs"] },
];
const BUILT_IN_RANK_IDS = new Set(DEFAULT_RANKS.map(({ id }) => id));
const LEGACY_RANK_IDS = new Set(["basic-plus", "ai", "full-minus", "owner"]);
const DEFAULT_SETTINGS = {
  theme: "dark",
  accent: "#75cfff",
  density: "comfortable",
  homepage: "home",
  searchProvider: "duckduckgo",
  customCursor: true,
  customTitle: "",
  customIcon: "",
  toolbarOrder: CUSTOMIZABLE_TOOLBAR_ITEMS,
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

export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const octets = address.split(".").map(Number);
    const value = octets.reduce((result, octet) => (result << 8) | octet, 0) >>> 0;
    const blockedRanges = [
      [0x00000000, 0x00ffffff], [0x0a000000, 0x0affffff], [0x64400000, 0x647fffff],
      [0x7f000000, 0x7fffffff], [0xa9fe0000, 0xa9feffff], [0xac100000, 0xac1fffff],
      [0xc0000000, 0xc00000ff], [0xc0000200, 0xc00002ff], [0xc0586300, 0xc05863ff],
      [0xc0a80000, 0xc0a8ffff], [0xc6120000, 0xc613ffff], [0xc6336400, 0xc63364ff],
      [0xcb007100, 0xcb0071ff], [0xe0000000, 0xffffffff],
    ];
    return !blockedRanges.some(([start, end]) => value >= start && value <= end);
  }
  if (family !== 6) return false;
  const normalized = address.toLowerCase().split("%")[0];
  const mapped = normalized.match(/^(?:::ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPublicAddress(mapped[1]);
  const withoutIpv4 = normalized.replace(/(\d{1,3}\.){3}\d{1,3}$/, (ipv4) => {
    const octets = ipv4.split(".").map(Number);
    return `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  });
  const halves = withoutIpv4.split("::");
  if (halves.length > 2) return false;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && left.length !== 8) return false;
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 2 && missing < 1)) return false;
  const words = [...left, ...Array(missing).fill("0"), ...right].map((word) => Number.parseInt(word, 16));
  if (words.length !== 8 || words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)) return false;
  const mappedV4 = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  if (mappedV4) return isPublicAddress(`${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`);
  return words[0] >= 0x2000 && words[0] <= 0x3fff &&
    !(words[0] === 0x2001 && words[1] <= 0x01ff) &&
    !(words[0] === 0x2001 && words[1] === 0x0db8) &&
    !(words[0] === 0x3fff && words[1] <= 0x0fff) &&
    words[0] !== 0x2002;
}

export function restrictedLookup(hostname, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  void dnsLookup(hostname, { all: true, verbatim: true }).then((addresses) => {
    const family = options?.family ?? 0;
    const matches = addresses.filter((entry) => !family || entry.family === family);
    if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address)) || !matches.length) {
      const error = new Error("Rammerhead cannot connect to private or reserved network addresses.");
      error.code = "EACCES";
      callback(error);
      return;
    }
    if (options?.all) callback(null, matches);
    else callback(null, matches[0].address, matches[0].family);
  }).catch((error) => callback(error));
}

const originalDestinationAgentAssign = destinationRequestAgent.assign;
destinationRequestAgent.assign = (options) => {
  originalDestinationAgentAssign(options);
  if (!options.proxy) options.lookup = restrictedLookup;
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
  const remoteAddress = req.socket.remoteAddress ?? "unknown";
  if (["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remoteAddress)) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string") {
      const lastForwarded = forwarded.split(",").at(-1)?.trim();
      if (lastForwarded && isIP(lastForwarded)) return lastForwarded;
    }
  }
  return remoteAddress;
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
  const settings = {
    ...DEFAULT_SETTINGS,
    ...current,
    ...input,
    privacy: { ...DEFAULT_SETTINGS.privacy, ...current.privacy, ...(input.privacy ?? {}) },
  };
  if (!["dark", "light", "system"].includes(settings.theme)) throw new HttpError(400, "Choose a supported theme.");
  if (!/^#[0-9a-f]{6}$/i.test(settings.accent)) throw new HttpError(400, "Accent must be a six-digit hex color.");
  if (!["compact", "comfortable", "spacious"].includes(settings.density)) throw new HttpError(400, "Choose a supported interface density.");
  if (typeof settings.homepage !== "string" || settings.homepage.length > 2048) throw new HttpError(400, "Homepage must be at most 2,048 characters.");
  if (!["home", "blank"].includes(settings.homepage) && !isSafeWebUrl(settings.homepage)) throw new HttpError(400, "Homepage must be the new-tab page, blank, or an HTTP(S) URL.");
  if (!Object.hasOwn(SEARCH_PROVIDERS, settings.searchProvider)) throw new HttpError(400, "Choose a supported search provider.");
  if (typeof settings.customCursor !== "boolean" || typeof settings.privacy.suppressReferrer !== "boolean" || typeof settings.privacy.clearOnExit !== "boolean") {
    throw new HttpError(400, "Settings contain an invalid toggle.");
  }
  if (typeof settings.customTitle !== "string" || settings.customTitle.length > 60 || /[\u0000-\u001f]/.test(settings.customTitle)) {
    throw new HttpError(400, "Custom title must be at most 60 characters.");
  }
  if (typeof settings.customIcon !== "string" || [...settings.customIcon].length > 4 || /[\u0000-\u001f]/.test(settings.customIcon)) {
    throw new HttpError(400, "Custom tab icon must be at most four printable characters.");
  }
  if (!Array.isArray(settings.toolbarOrder)
    || settings.toolbarOrder.length !== CUSTOMIZABLE_TOOLBAR_ITEMS.length
    || new Set(settings.toolbarOrder).size !== CUSTOMIZABLE_TOOLBAR_ITEMS.length
    || settings.toolbarOrder.some((item) => !CUSTOMIZABLE_TOOLBAR_ITEMS.includes(item))) {
    throw new HttpError(400, "Toolbar layout is invalid.");
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

function cookieHeader(value, secure, clear = false, name = SESSION_COOKIE, maxAgeMs = SESSION_MAX_AGE_MS) {
  const parts = [
    `${name}=${clear ? "" : encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (secure) parts.push("Secure");
  if (clear) parts.push("Max-Age=0");
  else parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
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
      email TEXT UNIQUE,
      password_hash TEXT,
      settings_json TEXT NOT NULL,
      permissions_json TEXT NOT NULL,
      features_json TEXT NOT NULL,
      rank TEXT NOT NULL DEFAULT 'basic-plus',
      is_friend INTEGER NOT NULL DEFAULT 0,
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
      rank TEXT NOT NULL DEFAULT 'basic-plus',
      expires_at TEXT,
      usage_limit INTEGER,
      usage_count INTEGER NOT NULL DEFAULT 0,
      ai_usage_count INTEGER NOT NULL DEFAULT 0,
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
      kind TEXT NOT NULL CHECK (kind IN ('support', 'suggestion', 'bug')),
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS feedback_by_time ON feedback(created_at DESC);
    CREATE TABLE IF NOT EXISTS project_areas (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('proxy', 'games', 'custom')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(account_id, name)
    );
    CREATE INDEX IF NOT EXISTS project_areas_by_account ON project_areas(account_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notes_by_account_time ON notes(account_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS cloud_files (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      content BLOB NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cloud_files_by_account_time ON cloud_files(account_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      sender_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      recipient_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chat_thread_by_time ON chat_messages(sender_account_id, recipient_account_id, created_at);
    CREATE TABLE IF NOT EXISTS chat_blocks (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      blocked_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY(account_id, blocked_account_id)
    );
    CREATE TABLE IF NOT EXISTS moderation_events (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      actor TEXT NOT NULL,
      subject_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
      message_id TEXT,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS moderation_events_by_time ON moderation_events(created_at DESC);
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
  if (!accountColumns.has("email")) db.exec("ALTER TABLE accounts ADD COLUMN email TEXT");
  if (!accountColumns.has("password_hash")) db.exec("ALTER TABLE accounts ADD COLUMN password_hash TEXT");
  const tokenColumns = new Set(db.prepare("PRAGMA table_info(tokens)").all().map((column) => column.name));
  if (!tokenColumns.has("rank")) db.exec("ALTER TABLE tokens ADD COLUMN rank TEXT NOT NULL DEFAULT 'standard'");
  if (!tokenColumns.has("ai_usage_count")) db.exec("ALTER TABLE tokens ADD COLUMN ai_usage_count INTEGER NOT NULL DEFAULT 0");
  const friendColumns = new Set(db.prepare("PRAGMA table_info(accounts)").all().map((column) => column.name));
  if (!friendColumns.has("is_friend")) db.exec("ALTER TABLE accounts ADD COLUMN is_friend INTEGER NOT NULL DEFAULT 0");
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
  if (!db.prepare("SELECT version FROM schema_migrations WHERE version = 7").get()) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const legacyOwner = db.prepare("SELECT id FROM ranks WHERE id = 'owner'").get();
      if (legacyOwner) {
        let safeId = "legacy-owner";
        let suffix = 1;
        while (db.prepare("SELECT id FROM ranks WHERE id = ?").get(safeId)) {
          safeId = `legacy-owner-${suffix}`;
          suffix += 1;
        }
        db.prepare("UPDATE accounts SET rank = ? WHERE rank = 'owner'").run(safeId);
        db.prepare("UPDATE tokens SET rank = ? WHERE rank = 'owner'").run(safeId);
        db.prepare("UPDATE ranks SET id = ?, label = ? WHERE id = 'owner'").run(safeId, "Legacy owner preset");
      }
      const upsertRank = db.prepare(`INSERT INTO ranks(id, label, permissions_json, features_json, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET label = excluded.label,
          permissions_json = excluded.permissions_json, features_json = excluded.features_json`);
      for (const rank of DEFAULT_RANKS) {
        const labelConflict = db.prepare("SELECT id FROM ranks WHERE label = ? AND id != ?").get(rank.label, rank.id);
        if (labelConflict) {
          let legacyLabel = `${rank.label} (legacy)`;
          let suffix = 1;
          while (db.prepare("SELECT id FROM ranks WHERE label = ?").get(legacyLabel)) {
            legacyLabel = `${rank.label} (legacy ${suffix})`;
            suffix += 1;
          }
          db.prepare("UPDATE ranks SET label = ? WHERE id = ?").run(legacyLabel, labelConflict.id);
        }
        upsertRank.run(rank.id, rank.label, JSON.stringify(rank.permissions), JSON.stringify(rank.features), new Date().toISOString());
        if (BUILT_IN_RANK_IDS.has(rank.id)) {
          db.prepare("UPDATE accounts SET permissions_json = ?, features_json = ? WHERE rank = ?")
            .run(JSON.stringify(rank.permissions), JSON.stringify(rank.features), rank.id);
          db.prepare("UPDATE tokens SET permissions_json = ? WHERE rank = ?")
            .run(JSON.stringify(rank.permissions), rank.id);
        }
      }
      db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (7, CURRENT_TIMESTAMP)").run();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (!db.prepare("SELECT version FROM schema_migrations WHERE version = 8").get()) {
    const createdAt = new Date().toISOString();
    for (const account of db.prepare("SELECT id FROM accounts").all()) createDefaultProjectAreas(db, account.id, createdAt);
    db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (8, CURRENT_TIMESTAMP)").run();
  }
  if (!db.prepare("SELECT version FROM schema_migrations WHERE version = 9").get()) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const upsert = db.prepare("INSERT OR IGNORE INTO ranks(id, label, permissions_json, features_json, created_at) VALUES (?, ?, ?, ?, ?)");
      for (const preset of DEFAULT_RANKS) {
        upsert.run(preset.id, preset.label, JSON.stringify(preset.permissions), JSON.stringify(preset.features), new Date().toISOString());
        const rank = db.prepare("SELECT permissions_json, features_json FROM ranks WHERE id = ?").get(preset.id);
        const permissions = [...new Set([...safeJson(rank.permissions_json, []), ...preset.permissions])];
        const features = [...new Set([...safeJson(rank.features_json, []), ...preset.features])];
        db.prepare("UPDATE ranks SET permissions_json = ?, features_json = ? WHERE id = ?")
          .run(JSON.stringify(permissions), JSON.stringify(features), preset.id);
        db.prepare("UPDATE accounts SET permissions_json = ?, features_json = ? WHERE rank = ?")
          .run(JSON.stringify(permissions), JSON.stringify(features), preset.id);
        db.prepare("UPDATE tokens SET permissions_json = ? WHERE rank = ?")
          .run(JSON.stringify(permissions), preset.id);
      }
      db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (9, CURRENT_TIMESTAMP)").run();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (!db.prepare("SELECT version FROM schema_migrations WHERE version = 10").get()) {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE feedback_v10 (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        kind TEXT NOT NULL CHECK (kind IN ('support', 'suggestion', 'bug')),
        subject TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
        created_at TEXT NOT NULL
      );
      INSERT INTO feedback_v10 SELECT id, account_id, kind, subject, message, status, created_at FROM feedback;
      DROP TABLE feedback;
      ALTER TABLE feedback_v10 RENAME TO feedback;
      CREATE INDEX feedback_by_time ON feedback(created_at DESC);
      INSERT INTO schema_migrations(version, applied_at) VALUES (10, CURRENT_TIMESTAMP);
      COMMIT;
    `);
  }
  if (!db.prepare("SELECT version FROM schema_migrations WHERE version = 11").get()) {
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const account of db.prepare("SELECT id, settings_json FROM accounts").all()) {
        const settings = safeJson(account.settings_json, null);
        if (typeof settings?.accent === "string" && settings.accent.toLowerCase() === "#ff7048") {
          settings.accent = DEFAULT_SETTINGS.accent;
          db.prepare("UPDATE accounts SET settings_json = ? WHERE id = ?").run(JSON.stringify(settings), account.id);
        }
      }
      db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (11, CURRENT_TIMESTAMP)").run();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
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
        .filter((row) => !LEGACY_RANK_IDS.has(row.id))
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
      if (BUILT_IN_RANK_IDS.has(identifier)) throw new Error("Built-in access ranks cannot be removed.");
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
      let rankId = flags.rank ?? positional[3] ?? existingAccount?.rank ?? "basic";
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
          db.prepare("UPDATE tokens SET rank = ?, permissions_json = ? WHERE account_id = ?")
            .run(rankId, JSON.stringify(permissions), accountId);
        } else {
          db.prepare("INSERT INTO accounts(id, label, settings_json, permissions_json, features_json, rank, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .run(accountId, accountLabel, JSON.stringify(settings), JSON.stringify(permissions), JSON.stringify(features), rankId, now);
          createDefaultProjectAreas(db, accountId, now);
          createDefaultProjectAreas(db, accountId, now);
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

function createDefaultProjectAreas(db, accountId, now = new Date().toISOString()) {
  const insert = db.prepare(`INSERT OR IGNORE INTO project_areas(id, account_id, name, kind, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`);
  insert.run(randomUUID(), accountId, "Proxy", "proxy", now, now);
  insert.run(randomUUID(), accountId, "games", "games", now, now);
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
    aiUsageLimit: LIMITED_AI_RANKS.has(row.rank) ? BASIC_AI_REQUEST_LIMIT : null,
    aiUsageCount: row.ai_usage_count ?? 0,
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
  const userLoginLimit = options.userLoginLimit ?? 12;
  const guestGrantLimit = options.guestGrantLimit ?? 10;
  const guestSessionLimit = options.guestSessionLimit ?? 3;
  const guestProxyRequestLimit = options.guestProxyRequestLimit ?? GUEST_PROXY_REQUEST_LIMIT;
  let activeAiRequests = 0;
  const config = {
    secureCookie: options.secureCookie ?? env("NODE_ENV", "development") === "production",
    serverVersion: "1.0.0",
  };
  const proxyHost = options.proxyHost ?? env("RAMMERHEAD_HOST", env("SCRAMJET_HOST", "127.0.0.1"));
  const configuredProxyOrigin = options.proxyOrigin ?? env("RAMMERHEAD_ORIGIN", env("SCRAMJET_ORIGIN", ""));
  const configuredAppOrigin = options.appOrigin ?? env("APP_ORIGIN", "");
  const configuredDashboardOrigins = options.dashboardOrigins ?? env("DASHBOARD_ORIGINS", "");
  const dashboardOriginsInput = Array.isArray(configuredDashboardOrigins)
    ? configuredDashboardOrigins
    : String(configuredDashboardOrigins).split(",");
  const dashboardOrigins = new Set(dashboardOriginsInput.map((origin) => String(origin).trim()).filter(Boolean));
  const proxyPort = Number(options.proxyPort ?? env("RAMMERHEAD_PORT", env("SCRAMJET_PORT", "4174")));
  if (!Number.isInteger(proxyPort) || proxyPort < 0 || proxyPort > 65535) {
    db.close();
    throw new Error("RAMMERHEAD_PORT must be an integer from 0 to 65535.");
  }
  for (const [name, value] of [["RAMMERHEAD_ORIGIN", configuredProxyOrigin], ["APP_ORIGIN", configuredAppOrigin]]) {
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== value) throw new Error();
    } catch {
      db.close();
      throw new Error(`${name} must be a bare HTTP(S) origin with no path.`);
    }
  }
  for (const value of dashboardOrigins) {
    try {
      const parsed = new URL(value);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== value || value === "*") throw new Error();
      if ((options.production ?? env("NODE_ENV", "development") === "production") && parsed.protocol !== "https:") throw new Error();
    } catch {
      db.close();
      throw new Error("DASHBOARD_ORIGINS must be a comma-separated list of exact HTTP(S) origins; production origins must use HTTPS.");
    }
  }
  if ((options.production ?? env("NODE_ENV", "development") === "production") && !configuredProxyOrigin) {
    db.close();
    throw new Error("RAMMERHEAD_ORIGIN must be configured for production so proxied sites stay isolated from the application origin.");
  }
  if ((options.production ?? env("NODE_ENV", "development") === "production") && !configuredAppOrigin) {
    db.close();
    throw new Error("APP_ORIGIN must be configured for production to restrict the Rammerhead shell's embedding origin.");
  }
  const proxyOrigin = () => configuredProxyOrigin || `http://${proxyHost}:${proxyServer?.address()?.port ?? proxyPort}`;
  const rammerheadSessions = new Map();
  const proxySockets = new Map();
  const guestProxySocketCounts = new Map();
  const proxyMaintenanceTimer = setInterval(() => {
    const now = Date.now();
    expireDesktopRelayIfInactive(now);
    for (const [engineSessionId, record] of rammerheadSessions) {
      if (record.principal === "guest") {
        if (record.expiresAt <= now || now - record.lastSeenAt > GUEST_SESSION_IDLE_MS) {
          closeRammerheadSession(engineSessionId);
        }
        continue;
      }
      const live = db.prepare("SELECT last_seen_at, expires_at FROM sessions WHERE id = ? AND principal = 'user'").get(record.userSessionId);
      if (
        record.expiresAt <= now ||
        !live ||
        Date.parse(live.expires_at) <= now ||
        now - Date.parse(live.last_seen_at) > SESSION_IDLE_MS
      ) closeProxySession(record.userSessionId);
    }
    for (const engineSessionId of proxySockets.keys()) {
      if (!rammerheadSessions.has(engineSessionId)) {
        for (const socket of proxySockets.get(engineSessionId) ?? []) socket.destroy();
        proxySockets.delete(engineSessionId);
      }
    }
  }, 30_000);
  proxyMaintenanceTimer.unref();
  let server;
  let proxyServer;
  const rammerhead = new RammerheadProxy({
    bindingAddress: proxyHost,
    port: proxyPort,
    crossDomainPort: null,
    dontListen: true,
    disableHttp2: true,
    jsCache: new RammerheadJSMemCache(50 * 1024 * 1024),
    getServerInfo(req) {
      const requestOrigin = new URL(`${req.socket.encrypted ? "https" : "http"}://${req.headers.host}`);
      const externalOrigin = configuredProxyOrigin ? new URL(configuredProxyOrigin) : requestOrigin;
      return {
        hostname: externalOrigin.hostname,
        port: Number(externalOrigin.port || (externalOrigin.protocol === "https:" ? 443 : 80)),
        crossDomainPort: Number(externalOrigin.port || (externalOrigin.protocol === "https:" ? 443 : 80)),
        protocol: externalOrigin.protocol,
      };
    },
  });
  const aiModel = options.aiModel ?? env("OLLAMA_MODEL", "qwen3:4b");
  const ollamaFetch = options.ollamaFetch ?? globalThis.fetch;
  const emailApiKey = options.emailApiKey ?? env("RESEND_API_KEY", "");
  const emailFrom = options.emailFrom ?? env("EMAIL_FROM", "");
  const feedbackEmail = options.feedbackEmail ?? env("FEEDBACK_EMAIL", "");
  const emailFetch = options.emailFetch ?? globalThis.fetch;
  const emailConfigured = Boolean(emailApiKey && emailFrom && feedbackEmail);
  async function notifyFeedback(subject, text) {
    if (!emailConfigured) return "not_configured";
    try {
      const response = await emailFetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${emailApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: emailFrom, to: [feedbackEmail], subject, text }),
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        console.error(`Luma email notification failed with HTTP ${response.status}.`);
        return "failed";
      }
      return "sent";
    } catch (error) {
      console.error(`Luma email notification failed: ${error.message}`);
      return "failed";
    }
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(aiModel)) {
    db.close();
    throw new Error("OLLAMA_MODEL contains unsupported characters.");
  }
  const aiAutostart = options.aiAutostart ?? env("OLLAMA_AUTOSTART", "1") !== "0";
  const aiState = { status: aiAutostart ? "checking" : "stopped", startedByApp: false, error: "" };
  const desktopSecret = options.desktopSecret ?? env("DESKTOP_COMPANION_SECRET", "");
  const desktopViewerTickets = new Map();
  const desktopRelay = {
    companionLastSeen: 0,
    ownerSessionId: "",
    ownerLastSeen: 0,
    sessionId: "",
    sessionExpiresAt: 0,
    sharing: false,
    input: false,
    lastFrame: null,
    lastFrameAt: 0,
    lastFrameUploadAt: 0,
    commands: [],
    pendingCommands: new Map(),
    usedNonces: new Map(),
  };
  function desktopOwnerSessionIsActive(now = Date.now()) {
    if (!desktopRelay.ownerSessionId) return false;
    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(desktopRelay.ownerSessionId);
    if (
      !session ||
      Date.parse(session.expires_at) <= now ||
      now - Date.parse(session.last_seen_at) > sessionIdleLimitMs(session)
    ) return false;
    if (session.principal === "admin") return true;
    if (session.principal !== "user") return false;
    const account = db.prepare("SELECT rank, revoked_at FROM accounts WHERE id = ?").get(session.account_id);
    const token = db.prepare("SELECT revoked_at, expires_at FROM tokens WHERE id = ?").get(session.token_id);
    return Boolean(
      account?.rank === "owner" &&
      !account.revoked_at &&
      token &&
      !token.revoked_at &&
      (!token.expires_at || Date.parse(token.expires_at) > now)
    );
  }
  function expireDesktopRelayIfInactive(now = Date.now()) {
    if (desktopRelay.ownerSessionId && (
      desktopRelay.sessionExpiresAt <= now ||
      now - desktopRelay.ownerLastSeen > DESKTOP_RELAY_IDLE_MS ||
      now - desktopRelay.companionLastSeen > 60_000 ||
      !desktopOwnerSessionIsActive(now)
    )) {
      desktopRelay.commands = [{ id: randomUUID(), sessionId: desktopRelay.sessionId, action: "stop" }];
      desktopRelay.pendingCommands.clear();
      desktopRelay.ownerSessionId = "";
      desktopRelay.ownerLastSeen = 0;
      desktopRelay.sessionId = "";
      desktopRelay.sessionExpiresAt = 0;
      desktopRelay.sharing = false;
      desktopRelay.input = false;
      desktopRelay.lastFrame = null;
      desktopRelay.lastFrameAt = 0;
      desktopRelay.lastFrameUploadAt = 0;
    }
  }
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

  async function readBody(req, maxBytes = MAX_BODY_BYTES) {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")) {
      throw new HttpError(415, "Send application/json requests.");
    }
    let length = 0;
    const chunks = [];
    for await (const chunk of req) {
      length += chunk.length;
      if (length > maxBytes) {
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
    const cookies = parseCookies(req.headers.cookie);
    const adminPath = req.url?.startsWith("/api/admin/") || req.url?.startsWith("/admin/");
    const dashboardPath = req.url?.startsWith("/api/owner/dashboard/");
    const candidates = adminPath || dashboardPath
      ? [[ADMIN_SESSION_COOKIE, cookies[ADMIN_SESSION_COOKIE]], [SESSION_COOKIE, cookies[SESSION_COOKIE]]]
      : [[SESSION_COOKIE, cookies[SESSION_COOKIE]]];
    for (const [cookieName, raw] of candidates) {
      if (!raw || raw.length < 32 || raw.length > 128) continue;
      const session = db.prepare("SELECT * FROM sessions WHERE session_hash = ?").get(hash(raw));
      if (!session) continue;
      const now = Date.now();
      if (Date.parse(session.expires_at) <= now || now - Date.parse(session.last_seen_at) > sessionIdleLimitMs(session)) {
        db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
        closeProxySession(session.id);
        continue;
      }
      if (session.principal === "user") {
        const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(session.account_id);
        const token = db.prepare("SELECT * FROM tokens WHERE id = ?").get(session.token_id);
        if (!account || account.revoked_at || !token || token.revoked_at || (token.expires_at && Date.parse(token.expires_at) <= now)) {
          db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
          closeProxySession(session.id);
          continue;
        }
        session.account = account;
        session.token = token;
      }
      session.cookieName = cookieName;
      db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(new Date(now).toISOString(), session.id);
      return session;
    }
    return null;
  }

  function requirePrincipal(session, principal) {
    if (!session || session.principal !== principal) throw new HttpError(401, "Sign in to continue.", "authentication_required");
    return session;
  }

  function requireOwner(session) {
    if (!session) throw new HttpError(401, "Owner sign-in required.", "authentication_required");
    if (session.principal !== "admin" && !(session.principal === "user" && session.account?.rank === "owner")) {
      throw new HttpError(403, "This account is not authorized to use the owner console.", "owner_required");
    }
    return session;
  }

  function requireCsrf(req, session) {
    if (!constantEqual(hash(req.headers["x-nj-csrf"] ?? ""), session.csrf_hash)) {
      throw new HttpError(403, "Session verification failed. Refresh and try again.", "csrf_rejected");
    }
  }

  function activeDesktopOwner(sessionId) {
    return Boolean(
      desktopRelay.ownerSessionId === sessionId &&
      desktopRelay.sessionId &&
      desktopRelay.sessionExpiresAt > Date.now() &&
      Date.now() - desktopRelay.ownerLastSeen <= DESKTOP_RELAY_IDLE_MS &&
      Date.now() - desktopRelay.companionLastSeen <= 60_000 &&
      desktopOwnerSessionIsActive()
    );
  }

  function queueDesktopCommand(action, values = {}) {
    if (desktopRelay.pendingCommands.size >= 32) {
      throw new HttpError(429, "The desktop companion is busy. Wait and try again.", "desktop_busy");
    }
    const command = { id: randomUUID(), sessionId: desktopRelay.sessionId, action, ...values };
    desktopRelay.commands.push(command);
    desktopRelay.pendingCommands.set(command.id, command);
    return command;
  }

  async function readRawBody(req, maxBytes) {
    const contentLength = req.headers["content-length"];
    if (contentLength !== undefined && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)) {
      req.resume();
      throw new HttpError(413, "Desktop relay request is too large.", "desktop_payload_too_large");
    }
    const chunks = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > maxBytes) {
        req.resume();
        throw new HttpError(413, "Desktop relay request is too large.", "desktop_payload_too_large");
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  function authenticateDesktopCompanion(req, url, body) {
    if (!/^[a-f0-9]{64}$/i.test(desktopSecret)) {
      throw new HttpError(503, "Desktop relay is not configured.", "companion_not_configured");
    }
    const timestamp = req.headers["x-nj-desktop-timestamp"];
    const nonce = req.headers["x-nj-desktop-nonce"];
    const signature = req.headers["x-nj-desktop-signature"];
    const milliseconds = Number(timestamp);
    if (
      typeof timestamp !== "string" ||
      !Number.isSafeInteger(milliseconds) ||
      Math.abs(Date.now() - milliseconds) > 30_000 ||
      typeof nonce !== "string" ||
      !/^[A-Za-z0-9_-]{20,80}$/.test(nonce) ||
      typeof signature !== "string" ||
      !/^[a-f0-9]{64}$/i.test(signature)
    ) {
      throw new HttpError(401, "Desktop companion authentication failed.", "companion_authentication_required");
    }
    for (const [oldNonce, expiry] of desktopRelay.usedNonces) {
      if (expiry <= Date.now()) desktopRelay.usedNonces.delete(oldNonce);
    }
    if (desktopRelay.usedNonces.has(nonce)) {
      throw new HttpError(401, "Desktop companion request was already used.", "companion_request_replayed");
    }
    const digest = createHash("sha256").update(body).digest("hex");
    const message = `${req.method}\n${url.pathname}\n${timestamp}\n${nonce}\n${digest}`;
    const expected = createHmac("sha256", Buffer.from(desktopSecret, "hex")).update(message).digest("hex");
    if (!constantEqual(expected, signature.toLowerCase())) {
      throw new HttpError(401, "Desktop companion authentication failed.", "companion_authentication_required");
    }
    desktopRelay.usedNonces.set(nonce, milliseconds + 60_000);
  }

  async function routeDesktopCompanion(req, res, url) {
    if (!url.pathname.startsWith("/api/desktop/companion/")) return false;
    consumeLimit(`desktop-companion-ip:${clientAddress(req)}`, 20, 1000);
    const body = await readRawBody(req, req.method === "POST" && url.pathname.endsWith("/frame") ? 8 * 1024 * 1024 : 32 * 1024);
    authenticateDesktopCompanion(req, url, body);
    consumeLimit(`desktop-companion:${clientAddress(req)}`, 10, 1000);
    if (req.method === "GET" && url.pathname === "/api/desktop/companion/poll") {
      desktopRelay.companionLastSeen = Date.now();
      expireDesktopRelayIfInactive();
      const command = desktopRelay.commands.shift() ?? null;
      sendJson(res, 200, {
        command,
        paired: activeDesktopOwner(desktopRelay.ownerSessionId),
        sharing: desktopRelay.sharing,
        inputEnabled: desktopRelay.input,
      });
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/desktop/companion/result") {
      let result;
      try {
        result = JSON.parse(body.toString("utf8"));
      } catch {
        throw new HttpError(400, "Companion result must be JSON.", "invalid_companion_result");
      }
      if (!result || typeof result !== "object" || typeof result.action !== "string") {
        throw new HttpError(400, "Companion result is invalid.", "invalid_companion_result");
      }
      const command = desktopRelay.pendingCommands.get(result.commandId);
      if (!command || command.sessionId !== desktopRelay.sessionId || command.action !== result.action || result.sessionId !== command.sessionId) {
        sendJson(res, 200, { ok: true, stale: true });
        return true;
      }
      desktopRelay.pendingCommands.delete(command.id);
      desktopRelay.companionLastSeen = Date.now();
      if (result.action === "start") desktopRelay.sharing = result.ok === true;
      if (result.action === "enable-input") desktopRelay.input = result.ok === true && desktopRelay.sharing;
      if (result.action === "stop") {
        desktopRelay.sharing = false;
        desktopRelay.input = false;
        desktopRelay.lastFrame = null;
        desktopRelay.lastFrameAt = 0;
        desktopRelay.lastFrameUploadAt = 0;
      }
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/desktop/companion/frame") {
      if (!desktopRelay.sharing || body.length < 8 || !body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        throw new HttpError(409, "No approved desktop share is active.", "desktop_not_sharing");
      }
      if (Date.now() - desktopRelay.lastFrameUploadAt < 500) {
        throw new HttpError(429, "Desktop screen frames are arriving too quickly.", "desktop_frame_rate_limited");
      }
      desktopRelay.companionLastSeen = Date.now();
      desktopRelay.lastFrameUploadAt = Date.now();
      desktopRelay.lastFrame = body;
      desktopRelay.lastFrameAt = Date.now();
      res.writeHead(204, { "Cache-Control": "no-store" });
      res.end();
      return true;
    }
    throw new HttpError(404, "Desktop companion route not found.", "not_found");
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

  function newSession(principal, accountId, tokenId, maxAgeMs = SESSION_MAX_AGE_MS) {
    const raw = randomBytes(32).toString("base64url");
    const csrf = csrfForSession(raw);
    const now = new Date();
    const expires = new Date(now.getTime() + maxAgeMs);
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
    for (const [engineSessionId, record] of rammerheadSessions) {
      if (record.userSessionId !== sessionId) continue;
      closeRammerheadSession(engineSessionId);
    }
  }

  function closeRammerheadSession(engineSessionId) {
    for (const socket of proxySockets.get(engineSessionId) ?? []) socket.destroy();
    proxySockets.delete(engineSessionId);
    const engineSession = rammerhead.openSessions.get(engineSessionId);
    if (engineSession) rammerhead.closeSession(engineSession);
    rammerheadSessions.delete(engineSessionId);
  }

  function authorizedRammerheadSession(req, requestUrl) {
    const engineSessionId = rammerheadSessionId(req, requestUrl);
    const record = engineSessionId && rammerheadSessions.get(engineSessionId);
    const now = Date.now();
    if (!record || record.expiresAt <= now || getSiteControls().maintenanceMode) return null;
    if (record.principal === "guest") {
      if (record.ip !== clientAddress(req) || now - record.lastSeenAt > GUEST_SESSION_IDLE_MS) return null;
      record.lastSeenAt = now;
      return { engineSessionId, principal: "guest", ip: record.ip };
    }
    const session = db.prepare(`SELECT s.id, s.last_seen_at, s.expires_at, a.revoked_at, a.permissions_json,
      t.revoked_at AS token_revoked_at, t.expires_at AS token_expires_at
      FROM sessions s JOIN accounts a ON a.id = s.account_id JOIN tokens t ON t.id = s.token_id
      WHERE s.id = ? AND s.principal = 'user'`).get(record.userSessionId);
    if (
      !session ||
      session.revoked_at ||
      session.token_revoked_at ||
      (session.token_expires_at && Date.parse(session.token_expires_at) <= Date.now()) ||
      Date.parse(session.expires_at) <= Date.now() ||
      Date.now() - Date.parse(session.last_seen_at) > SESSION_IDLE_MS ||
      !safeJson(session.permissions_json, []).includes("browse") ||
      getSiteControls().maintenanceMode
    ) return null;
    return { engineSessionId, principal: "user", userSessionId: record.userSessionId };
  }

  function rammerheadSessionId(req, requestUrl) {
    const direct = parseProxyUrl(new URL(req.url, proxyOrigin()).href)?.sessionId;
    if (direct) return direct;
    const querySessionId = requestUrl.searchParams.get("sessionId") ?? requestUrl.searchParams.get("id");
    if (querySessionId && /^[a-f0-9]{32}$/i.test(querySessionId)) return querySessionId;
    const referer = req.headers.referer;
    if (!referer) return null;
    try {
      return parseProxyUrl(referer)?.sessionId ?? null;
    } catch {
      return null;
    }
  }

  function allowedRammerheadDestination(requestUrl) {
    const parsed = parseProxyUrl(requestUrl.href);
    if (!parsed?.destUrl) {
      return new Set([
        "/api/shuffleDict", "/hammerhead.js", "/iframe-task.js", "/mainport",
        "/messaging", "/rammerhead.js", "/sessionexists", "/syncLocalStorage",
        "/task.js", "/transport-worker.js", "/worker-hammerhead.js",
      ]).has(requestUrl.pathname);
    }
    let destination;
    try {
      destination = new URL(parsed.destUrl);
    } catch {
      return false;
    }
    if (!["http:", "https:"].includes(destination.protocol) || destination.username || destination.password) return false;
    if (destination.port && !["80", "443"].includes(destination.port)) return false;
    const hostname = destination.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) return false;
    return !isIP(hostname) || isPublicAddress(hostname);
  }

  function trackProxySocket(authorized, socket) {
    const { engineSessionId, principal, ip } = authorized;
    const sockets = proxySockets.get(engineSessionId) ?? new Set();
    const isNewSocket = !sockets.has(socket);
    if (isNewSocket && principal === "guest" &&
        (sockets.size >= GUEST_PROXY_SOCKET_LIMIT ||
         (guestProxySocketCounts.get(ip) ?? 0) >= GUEST_PROXY_SOCKET_LIMIT * guestSessionLimit)) return false;
    if (isNewSocket && principal !== "guest" && sockets.size >= 128) return false;
    sockets.add(socket);
    proxySockets.set(engineSessionId, sockets);
    if (isNewSocket && principal === "guest") guestProxySocketCounts.set(ip, (guestProxySocketCounts.get(ip) ?? 0) + 1);
    socket.once("close", () => {
      sockets.delete(socket);
      if (principal === "guest") {
        const remaining = (guestProxySocketCounts.get(ip) ?? 1) - 1;
        if (remaining <= 0) guestProxySocketCounts.delete(ip);
        else guestProxySocketCounts.set(ip, remaining);
      }
      if (!sockets.size) proxySockets.delete(engineSessionId);
    });
    return true;
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
    if (siteControls.maintenanceMode && !path.startsWith("/api/admin/") && path !== "/api/owner/dashboard/tokens" && path !== "/api/auth/logout") {
      throw new HttpError(503, "Nightjar is temporarily in maintenance mode. Please try again later.", "maintenance_mode");
    }

    if (method === "GET" && path === "/api/owner/dashboard/tokens") {
      requireOwner(session);
      if (req.headers.origin && !dashboardOrigins.has(req.headers.origin)) {
        throw new HttpError(403, "This dashboard origin is not configured.", "origin_rejected");
      }
      const rows = db.prepare(`SELECT id, rank, expires_at, usage_limit, usage_count, ai_usage_count, created_at, revoked_at
        FROM tokens ORDER BY created_at DESC LIMIT 500`).all();
      const now = Date.now();
      const tokens = rows.map((row) => {
        const status = row.revoked_at ? "revoked" : (row.expires_at && Date.parse(row.expires_at) <= now ? "expired" : "active");
        return {
          id: row.id,
          tokenIdMasked: `••••${row.id.slice(-6)}`,
          rank: row.rank,
          status,
          limit: row.usage_limit,
          used: row.usage_count,
          aiLimit: LIMITED_AI_RANKS.has(row.rank) ? BASIC_AI_REQUEST_LIMIT : null,
          aiUsed: row.ai_usage_count,
          expiresAt: row.expires_at,
          revokedAt: row.revoked_at,
          createdAt: row.created_at,
        };
      });
      const summary = {
        total: tokens.length,
        active: tokens.filter((token) => token.status === "active").length,
        revoked: tokens.filter((token) => token.status === "revoked").length,
        expired: tokens.filter((token) => token.status === "expired").length,
        totalLimit: tokens.reduce((total, token) => total + (token.limit ?? 0), 0),
        totalUsed: tokens.reduce((total, token) => total + token.used, 0),
      };
      sendJson(res, 200, { tokens, summary }, { "Cache-Control": "no-store" });
      return;
    }

    if (method === "POST" && path === "/api/auth/basic-signup") {
      validateOrigin(req);
      consumeLimit(`basic-signup:${ip}`, 5, 24 * 60 * 60_000);
      const body = await readBody(req);
      const label = typeof body.label === "string" ? body.label.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (label.length < 2 || label.length > 40 || /[\u0000-\u001f]/.test(label)) {
        throw new HttpError(400, "Display name must be between 2 and 40 printable characters.");
      }
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new HttpError(400, "Enter a valid email address.");
      }
      if (password.length < 12 || password.length > 128) {
        throw new HttpError(400, "Password must be between 12 and 128 characters.");
      }
      const rank = db.prepare("SELECT permissions_json, features_json FROM ranks WHERE id = 'basic'").get();
      const accountId = randomUUID();
      const tokenId = randomUUID();
      const tokenValue = randomBytes(32).toString("base64url");
      const now = new Date().toISOString();
      try {
        db.exec("BEGIN IMMEDIATE");
        db.prepare(`INSERT INTO accounts(id, label, email, password_hash, settings_json, permissions_json, features_json, rank, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'basic', ?)`)
          .run(accountId, label, email, await hashPassword(password), JSON.stringify(DEFAULT_SETTINGS),
            rank.permissions_json, rank.features_json, now);
        db.prepare(`INSERT INTO tokens(id, account_id, token_hash, label, permissions_json, rank, usage_limit, created_at, last_used_at)
          VALUES (?, ?, ?, 'Free Basic account sign-in', ?, 'basic', NULL, ?, ?)`)
          .run(tokenId, accountId, hash(tokenValue), rank.permissions_json, now, now);
        createDefaultProjectAreas(db, accountId, now);
        const auth = newSession("user", accountId, tokenId);
        db.exec("COMMIT");
        audit(db, label, "account.basic_signup", accountId, {}, ip);
        sendJson(res, 201, {
          authenticated: true,
          account: {
            id: accountId, label, rank: "basic",
            settings: DEFAULT_SETTINGS,
            permissions: safeJson(rank.permissions_json, []),
            features: safeJson(rank.features_json, []),
          },
          csrf: auth.csrf,
        }, { "Set-Cookie": cookieHeader(auth.raw, config.secureCookie) });
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        if (error.code === "ERR_SQLITE_ERROR" && /UNIQUE/.test(error.message)) {
          throw new HttpError(409, "An account already uses that email address.", "email_exists");
        }
        throw error;
      }
      return;
    }

    if (method === "POST" && path === "/api/auth/email-login") {
      validateOrigin(req);
      consumeLimit(`email-login:${ip}`, userLoginLimit, 5 * 60_000);
      const body = await readBody(req);
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const account = db.prepare("SELECT * FROM accounts WHERE email = ?").get(email);
      if (!account || !account.password_hash || account.revoked_at || !(await verifyPassword(password, account.password_hash))) {
        throw new HttpError(401, "Email or password was not recognized.", "invalid_credentials");
      }
      const token = db.prepare("SELECT * FROM tokens WHERE account_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1").get(account.id);
      if (!token) throw new HttpError(401, "Account access is no longer active.", "account_unavailable");
      const live = db.prepare("SELECT id FROM sessions WHERE account_id = ? AND principal = 'user'").all(account.id)
        .filter((item) => {
          const current = db.prepare("SELECT last_seen_at, expires_at FROM sessions WHERE id = ?").get(item.id);
          return current && Date.now() - Date.parse(current.last_seen_at) <= SESSION_IDLE_MS && Date.parse(current.expires_at) > Date.now();
        });
      if (live.length) throw new HttpError(409, "This account is already signed in. Sign out of the other browser first.", "account_session_active");
      db.prepare("DELETE FROM sessions WHERE account_id = ?").run(account.id);
      const auth = newSession("user", account.id, token.id);
      audit(db, account.label, "session.email_login", account.id, {}, ip);
      sendJson(res, 200, {
        authenticated: true,
        account: {
          id: account.id, label: account.label, rank: account.rank,
          settings: safeJson(account.settings_json, DEFAULT_SETTINGS),
          permissions: safeJson(account.permissions_json, []),
          features: safeJson(account.features_json, []),
        },
        csrf: auth.csrf,
      }, { "Set-Cookie": cookieHeader(auth.raw, config.secureCookie) });
      return;
    }

    if (method === "POST" && path === "/api/auth/login") {
      validateOrigin(req);
      consumeLimit(`user:${ip}`, userLoginLimit, 5 * 60_000);
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
      requireCsrf(req, user);
      const body = await readBody(req);
      const kind = body.kind;
      const subject = typeof body.subject === "string" ? body.subject.trim() : "";
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!["support", "suggestion", "bug"].includes(kind)) throw new HttpError(400, "Choose support, suggestion, or bug report.");
      if (kind === "support") requirePermission(user, "support");
      if (kind === "bug") requirePermission(user, "bugs");
      if (subject.length < 4 || subject.length > 120) throw new HttpError(400, "Subject must be between 4 and 120 characters.");
      if (message.length < 10 || message.length > 4000) throw new HttpError(400, "Message must be between 10 and 4000 characters.");
      consumeLimit(`feedback:${user.account_id}`, 5, 60 * 60_000);
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare("INSERT INTO feedback(id, account_id, kind, subject, message, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, user.account_id, kind, subject, message, now);
      audit(db, user.account.label, `feedback.${kind}.submitted`, id, {}, ip);
      const emailStatus = await notifyFeedback(
        `Luma ${kind}: ${subject}`,
        `A ${kind} was submitted in Luma.\nAccount: ${user.account.label}\nSubject: ${subject}\n\n${message}`,
      );
      sendJson(res, 201, { id, status: "open", createdAt: now, emailNotification: emailStatus });
      return;
    }

    if (method === "GET" && path === "/api/rank-store") {
      const items = db.prepare("SELECT id, label, permissions_json, features_json FROM ranks WHERE id IN ('basic', 'full', 'standard', 'with-ai', 'without-ai') ORDER BY CASE id WHEN 'basic' THEN 0 WHEN 'standard' THEN 1 WHEN 'without-ai' THEN 2 WHEN 'with-ai' THEN 3 WHEN 'full' THEN 4 ELSE 5 END, label")
        .all().map((row) => ({
          id: row.id,
          label: row.label,
          permissions: safeJson(row.permissions_json, []),
          features: safeJson(row.features_json, []),
          price: row.id === "basic" ? 0 : null,
          available: row.id === "basic",
        }));
      sendJson(res, 200, {
        items,
        checkoutConfigured: false,
        message: "Basic is free. Paid rank checkout is not configured; higher ranks remain available by owner-issued invitation.",
      });
      return;
    }

    if (method === "POST" && path === "/api/rank-store/request") {
      const user = requirePrincipal(session, "user");
      requireCsrf(req, user);
      const body = await readBody(req);
      if (!["full", "standard", "with-ai", "without-ai"].includes(body.rank)) {
        throw new HttpError(400, "Choose an upgrade rank from the store.");
      }
      const rank = db.prepare("SELECT label FROM ranks WHERE id = ?").get(body.rank);
      if (!rank) throw new HttpError(404, "That rank is not available.", "rank_not_found");
      consumeLimit(`rank-request:${user.account_id}`, 3, 24 * 60 * 60_000);
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare("INSERT INTO feedback(id, account_id, kind, subject, message, created_at) VALUES (?, ?, 'suggestion', ?, ?, ?)")
        .run(id, user.account_id, `Rank upgrade request: ${rank.label}`, `Account requested access to ${rank.label}. No payment was collected.`, now);
      audit(db, user.account.label, "rank.upgrade_requested", id, { rank: body.rank }, ip);
      await notifyFeedback(`Luma rank request: ${rank.label}`, `Account ${user.account.label} requested ${rank.label}. No payment was collected.`);
      sendJson(res, 201, { requested: true, checkoutConfigured: false, message: "Request sent to the owner; no payment was collected." });
      return;
    }

    if (method === "GET" && path === "/api/admin/ranks") {
      requireOwner(session);
      const items = db.prepare("SELECT id, label, permissions_json, features_json, created_at FROM ranks ORDER BY label").all()
        .filter((row) => !LEGACY_RANK_IDS.has(row.id))
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

    if (method === "GET" && path === "/api/admin/friends") {
      requireOwner(session);
      const items = db.prepare(`SELECT id, label, rank, created_at, revoked_at FROM accounts
        WHERE is_friend = 1 ORDER BY label`).all().map((row) => ({
        id: row.id,
        label: row.label,
        rank: row.rank,
        createdAt: row.created_at,
        revokedAt: row.revoked_at,
        status: row.revoked_at ? "revoked" : "active",
      }));
      sendJson(res, 200, { items });
      return;
    }

    const friendMatch = path.match(/^\/api\/admin\/friends\/([0-9a-f-]{36})$/i);
    if (method === "DELETE" && friendMatch) {
      const admin = requireOwner(session);
      requireCsrf(req, admin);
      const result = db.prepare("UPDATE accounts SET is_friend = 0 WHERE id = ? AND is_friend = 1").run(friendMatch[1]);
      if (!result.changes) throw new HttpError(404, "Friend account not found.", "not_found");
      audit(db, "owner", "friend.removed", friendMatch[1], {}, ip);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && path === "/api/admin/feedback") {
      requireOwner(session);
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
      const admin = requireOwner(session);
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

    if (method === "GET" && path === "/api/admin/moderation") {
      requireOwner(session);
      const items = db.prepare(`SELECT m.id, m.kind, m.actor, m.subject_account_id, m.message_id, m.reason, m.status, m.created_at,
        target.label AS subject_label, reporter.label AS reporter_label
        FROM moderation_events m
        LEFT JOIN accounts target ON target.id = m.subject_account_id
        LEFT JOIN accounts reporter ON reporter.id = m.actor
        ORDER BY m.created_at DESC LIMIT 200`).all().map((row) => ({
        id: row.id,
        kind: row.kind,
        reporterLabel: row.reporter_label ?? "",
        subjectAccountId: row.subject_account_id,
        subjectLabel: row.subject_label ?? "Deleted account",
        messageId: row.message_id,
        reason: row.reason,
        status: row.status,
        createdAt: row.created_at,
      }));
      sendJson(res, 200, { items });
      return;
    }

    const moderationMatch = path.match(/^\/api\/admin\/moderation\/([0-9a-f-]{36})$/i);
    if (method === "PATCH" && moderationMatch) {
      const admin = requireOwner(session);
      requireCsrf(req, admin);
      const body = await readBody(req);
      if (!["resolved", "dismissed"].includes(body.status)) {
        throw new HttpError(400, "Choose resolved or dismissed.");
      }
      const event = db.prepare("SELECT id, kind, subject_account_id FROM moderation_events WHERE id = ?").get(moderationMatch[1]);
      if (!event) throw new HttpError(404, "Moderation entry not found.", "not_found");
      db.prepare("UPDATE moderation_events SET status = ? WHERE id = ?").run(body.status, event.id);
      if (body.ban === true && event.subject_account_id) {
        db.prepare("UPDATE accounts SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?").run(new Date().toISOString(), event.subject_account_id);
        revokeAccount(event.subject_account_id, "moderation_ban", ip, "owner");
        const banId = randomUUID();
        db.prepare(`INSERT INTO moderation_events(id, kind, actor, subject_account_id, reason, status, created_at)
          VALUES (?, 'account_ban', 'owner', ?, ?, 'resolved', ?)`)
          .run(banId, event.subject_account_id, `Banned after moderation event ${event.id}`, new Date().toISOString());
      }
      audit(db, "owner", body.ban === true ? "moderation.account_banned" : "moderation.report_updated", event.id, { status: body.status, ban: body.ban === true }, ip);
      sendJson(res, 200, { updated: true, banned: body.ban === true });
      return;
    }

    if (method === "POST" && path === "/api/admin/ranks") {
      const admin = requireOwner(session);
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
      const admin = requireOwner(session);
      requireCsrf(req, admin);
      if (DEFAULT_RANKS.some((rank) => rank.id === deleteRankMatch[1])) {
        throw new HttpError(409, "Built-in access ranks cannot be removed.", "built_in_rank");
      }
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
      const rememberSession = body.keepSignedIn === true;
      const maxAgeMs = rememberSession ? ADMIN_REMEMBER_MAX_AGE_MS : SESSION_MAX_AGE_MS;
      const session = newSession("admin", null, null, maxAgeMs);
      audit(db, "owner", "admin.session_created", "owner", {}, ip);
      sendJson(res, 200, { authenticated: true, csrf: session.csrf }, { "Set-Cookie": cookieHeader(session.raw, config.secureCookie, false, ADMIN_SESSION_COOKIE, maxAgeMs) });
      return;
    }

    if (method === "POST" && path === "/api/browser/grant") {
      validateOrigin(req);
      if (!req.headers.origin) throw new HttpError(403, "A same-origin browser request is required.", "origin_rejected");
      const guest = !session || session.principal !== "user";
      if (guest) {
        consumeLimit(`guest-grant:${ip}`, guestGrantLimit, 60_000);
        for (const [engineSessionId, record] of rammerheadSessions) {
          if (record.principal === "guest" && record.ip === ip &&
            (record.expiresAt <= Date.now() || Date.now() - record.lastSeenAt > GUEST_SESSION_IDLE_MS)) {
            closeRammerheadSession(engineSessionId);
          }
        }
        const activeGuestSessions = [...rammerheadSessions.values()]
          .filter((record) => record.principal === "guest" && record.ip === ip).length;
        if (activeGuestSessions >= guestSessionLimit) {
          throw new HttpError(429, "Too many guest browsing sessions are active from this network. Close an unused session and try again.", "guest_session_limit");
        }
      } else {
        requirePermission(session, "browse");
        requireCsrf(req, session);
      }
      const engineSessionId = randomBytes(16).toString("hex");
      const engineSession = new RammerheadSession({ id: engineSessionId, disableShuffling: true });
      rammerhead.openSessions.set(engineSessionId, engineSession);
      const now = Date.now();
      rammerheadSessions.set(engineSessionId, guest
        ? { principal: "guest", ip, lastSeenAt: now, expiresAt: now + GUEST_SESSION_MAX_AGE_MS }
        : { principal: "user", userSessionId: session.id, expiresAt: now + SESSION_MAX_AGE_MS });
      sendJson(res, 200, { sessionId: engineSessionId, proxyOrigin: proxyOrigin() });
      return;
    }

    if (method === "POST" && path === "/api/browser/adopt") {
      validateOrigin(req);
      const user = requirePrincipal(session, "user");
      requirePermission(user, "browse");
      requireCsrf(req, session);
      const body = await readBody(req);
      const engineSessionId = typeof body.sessionId === "string" ? body.sessionId : "";
      if (!/^[a-f0-9]{32}$/i.test(engineSessionId)) throw new HttpError(400, "A valid guest browsing session is required.");
      const record = rammerheadSessions.get(engineSessionId);
      if (!record || record.principal !== "guest" || record.ip !== ip ||
          record.expiresAt <= Date.now() || Date.now() - record.lastSeenAt > GUEST_SESSION_IDLE_MS) {
        throw new HttpError(404, "This guest browsing session has expired. Start a new tab to continue browsing.", "guest_session_expired");
      }
      rammerheadSessions.set(engineSessionId, {
        principal: "user",
        userSessionId: session.id,
        expiresAt: Date.now() + SESSION_MAX_AGE_MS,
      });
      sendJson(res, 200, { adopted: true });
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

    if (path === "/api/notes") {
      const user = requirePrincipal(session, "user");
      requirePermission(user, "notes");
      if (method === "GET") {
        const items = db.prepare("SELECT id, title, content, created_at, updated_at FROM notes WHERE account_id = ? ORDER BY updated_at DESC LIMIT 50")
          .all(user.account_id).map((row) => ({
            id: row.id, title: row.title, content: row.content, createdAt: row.created_at, updatedAt: row.updated_at,
          }));
        sendJson(res, 200, { items });
        return;
      }
      if (method !== "POST") throw new HttpError(405, "Method not allowed.");
      requireCsrf(req, user);
      const body = await readBody(req);
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const content = typeof body.content === "string" ? body.content : "";
      if (!title || title.length > 120 || content.length > 20_000) {
        throw new HttpError(400, "Notes need a title of 1–120 characters and up to 20,000 characters of text.");
      }
      if (db.prepare("SELECT COUNT(*) AS count FROM notes WHERE account_id = ?").get(user.account_id).count >= 50) {
        throw new HttpError(413, "This account has reached its limit of 50 notes.", "notes_quota_exceeded");
      }
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare("INSERT INTO notes(id, account_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, user.account_id, title, content, now, now);
      sendJson(res, 201, { item: { id, title, content, createdAt: now, updatedAt: now } });
      return;
    }

    const noteMatch = path.match(/^\/api\/notes\/([0-9a-f-]{36})$/i);
    if (noteMatch) {
      const user = requirePrincipal(session, "user");
      requirePermission(user, "notes");
      const current = db.prepare("SELECT id, title, content, created_at FROM notes WHERE id = ? AND account_id = ?")
        .get(noteMatch[1], user.account_id);
      if (!current) throw new HttpError(404, "Note not found.", "not_found");
      if (method === "DELETE") {
        requireCsrf(req, user);
        db.prepare("DELETE FROM notes WHERE id = ? AND account_id = ?").run(current.id, user.account_id);
        sendJson(res, 200, { deleted: true });
        return;
      }
      if (method !== "PATCH") throw new HttpError(405, "Method not allowed.");
      requireCsrf(req, user);
      const body = await readBody(req);
      const title = body.title === undefined ? current.title : (typeof body.title === "string" ? body.title.trim() : "");
      const content = body.content === undefined ? current.content : body.content;
      if (!title || title.length > 120 || typeof content !== "string" || content.length > 20_000) {
        throw new HttpError(400, "Notes need a title of 1–120 characters and up to 20,000 characters of text.");
      }
      const updatedAt = new Date().toISOString();
      db.prepare("UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ? AND account_id = ?")
        .run(title, content, updatedAt, current.id, user.account_id);
      sendJson(res, 200, { item: { id: current.id, title, content, createdAt: current.created_at, updatedAt } });
      return;
    }

    if (path === "/api/storage") {
      const user = requirePrincipal(session, "user");
      requirePermission(user, "storage");
      if (method === "GET") {
        const items = db.prepare("SELECT id, name, mime_type, length(content) AS size, created_at FROM cloud_files WHERE account_id = ? ORDER BY created_at DESC LIMIT 200")
          .all(user.account_id).map((row) => ({
            id: row.id, name: row.name, type: row.mime_type, size: row.size, createdAt: row.created_at,
          }));
        const usedBytes = db.prepare("SELECT COALESCE(SUM(length(content)), 0) AS bytes FROM cloud_files WHERE account_id = ?").get(user.account_id).bytes;
        sendJson(res, 200, { items, usedBytes, quotaBytes: 10 * 1024 * 1024 });
        return;
      }
      if (method !== "POST") throw new HttpError(405, "Method not allowed.");
      requireCsrf(req, user);
      const body = await readBody(req, 2 * 1024 * 1024);
      const name = typeof body.name === "string" ? body.name.trim().replace(/[\\/\u0000-\u001f]/g, "_") : "";
      const allowedTypes = new Set(["text/plain", "application/pdf", "application/json", "image/png", "image/jpeg", "image/webp"]);
      if (!name || name.length > 120 || typeof body.type !== "string" || !allowedTypes.has(body.type) || typeof body.content !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.content)) {
        throw new HttpError(400, "Choose a supported file (text, PDF, JSON, PNG, JPEG, or WebP) with a valid name.");
      }
      const content = Buffer.from(body.content, "base64");
      if (!content.length || content.length > 1024 * 1024 || content.toString("base64") !== body.content) {
        throw new HttpError(413, "Files must be between 1 byte and 1 MB.", "file_size_limit");
      }
      const usedBytes = db.prepare("SELECT COALESCE(SUM(length(content)), 0) AS bytes FROM cloud_files WHERE account_id = ?").get(user.account_id).bytes;
      if (usedBytes + content.length > 10 * 1024 * 1024) {
        throw new HttpError(413, "This account has reached its 10 MB cloud storage quota.", "storage_quota_exceeded");
      }
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare("INSERT INTO cloud_files(id, account_id, name, mime_type, content, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, user.account_id, name, body.type, content, now);
      sendJson(res, 201, { item: { id, name, type: body.type, size: content.length, createdAt: now } });
      return;
    }

    const cloudFileMatch = path.match(/^\/api\/storage\/([0-9a-f-]{36})(?:\/download)?$/i);
    if (cloudFileMatch) {
      const user = requirePrincipal(session, "user");
      requirePermission(user, "storage");
      const file = db.prepare("SELECT id, name, mime_type, content FROM cloud_files WHERE id = ? AND account_id = ?")
        .get(cloudFileMatch[1], user.account_id);
      if (!file) throw new HttpError(404, "File not found.", "not_found");
      if (method === "DELETE" && !path.endsWith("/download")) {
        requireCsrf(req, user);
        db.prepare("DELETE FROM cloud_files WHERE id = ? AND account_id = ?").run(file.id, user.account_id);
        sendJson(res, 200, { deleted: true });
        return;
      }
      if (method !== "GET") throw new HttpError(405, "Method not allowed.");
      const safeName = file.name.replace(/["\r\n]/g, "_");
      res.writeHead(200, {
        "Content-Type": file.mime_type,
        "Content-Length": file.content.length,
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(file.content);
      return;
    }

    if (path === "/api/chat/contacts") {
      const user = requirePrincipal(session, "user");
      requirePermission(user, "chat");
      if (method !== "GET") throw new HttpError(405, "Method not allowed.");
      const items = db.prepare(`SELECT id, label, rank FROM accounts
        WHERE is_friend = 1 AND revoked_at IS NULL AND id != ? ORDER BY label LIMIT 100`).all(user.account_id);
      sendJson(res, 200, { items });
      return;
    }

    if (path === "/api/chat/messages") {
      const user = requirePrincipal(session, "user");
      requirePermission(user, "chat");
      const body = method === "POST" ? await readBody(req) : null;
      const peerId = method === "GET" ? url.searchParams.get("peer") : body?.peer;
      if (typeof peerId !== "string" || !/^[0-9a-f-]{36}$/i.test(peerId)) {
        throw new HttpError(400, "Choose an available chat contact.");
      }
      const peer = db.prepare("SELECT id FROM accounts WHERE id = ? AND is_friend = 1 AND revoked_at IS NULL").get(peerId);
      if (!peer || peer.id === user.account_id) throw new HttpError(404, "Chat contact not found.", "not_found");
      const blocked = db.prepare(`SELECT 1 FROM chat_blocks WHERE
        (account_id = ? AND blocked_account_id = ?) OR (account_id = ? AND blocked_account_id = ?)`)
        .get(user.account_id, peerId, peerId, user.account_id);
      if (blocked) throw new HttpError(403, "This chat is blocked.", "chat_blocked");
      if (method === "GET") {
        const items = db.prepare(`SELECT id, sender_account_id, recipient_account_id, message, created_at FROM chat_messages
          WHERE (sender_account_id = ? AND recipient_account_id = ?) OR (sender_account_id = ? AND recipient_account_id = ?)
          ORDER BY created_at DESC LIMIT 100`).all(user.account_id, peerId, peerId, user.account_id).reverse();
        sendJson(res, 200, { items });
        return;
      }
      if (method !== "POST") throw new HttpError(405, "Method not allowed.");
      requireCsrf(req, user);
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!message || message.length > 2000 || /\u0000/.test(message)) throw new HttpError(400, "Chat messages must contain 1–2,000 characters.");
      consumeLimit(`chat:${user.account_id}`, 30, 60_000);
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      db.prepare("INSERT INTO chat_messages(id, sender_account_id, recipient_account_id, message, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(id, user.account_id, peerId, message, createdAt);
      sendJson(res, 201, { item: { id, senderAccountId: user.account_id, recipientAccountId: peerId, message, createdAt } });
      return;
    }

    const chatBlockMatch = path.match(/^\/api\/chat\/blocks\/([0-9a-f-]{36})$/i);
    if (chatBlockMatch) {
      const user = requirePrincipal(session, "user");
      requirePermission(user, "chat");
      requireCsrf(req, user);
      const peer = db.prepare("SELECT id FROM accounts WHERE id = ? AND is_friend = 1 AND revoked_at IS NULL").get(chatBlockMatch[1]);
      if (!peer || peer.id === user.account_id) throw new HttpError(404, "Chat contact not found.", "not_found");
      if (method === "POST") {
        db.prepare("INSERT OR IGNORE INTO chat_blocks(account_id, blocked_account_id, created_at) VALUES (?, ?, ?)")
          .run(user.account_id, peer.id, new Date().toISOString());
        sendJson(res, 200, { blocked: true });
        return;
      }
      if (method === "DELETE") {
        db.prepare("DELETE FROM chat_blocks WHERE account_id = ? AND blocked_account_id = ?").run(user.account_id, peer.id);
        sendJson(res, 200, { blocked: false });
        return;
      }
      throw new HttpError(405, "Method not allowed.");
    }

    if (method === "POST" && path === "/api/chat/report") {
      const user = requirePrincipal(session, "user");
      requirePermission(user, "chat");
      requireCsrf(req, user);
      const body = await readBody(req);
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (typeof body.messageId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.messageId) || reason.length < 5 || reason.length > 500) {
        throw new HttpError(400, "Choose a chat message and provide a 5–500 character report reason.");
      }
      const message = db.prepare("SELECT sender_account_id, recipient_account_id FROM chat_messages WHERE id = ? AND (sender_account_id = ? OR recipient_account_id = ?)")
        .get(body.messageId, user.account_id, user.account_id);
      if (!message || message.sender_account_id === user.account_id) throw new HttpError(404, "Reportable message not found.", "not_found");
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO moderation_events(id, kind, actor, subject_account_id, message_id, reason, created_at)
        VALUES (?, 'chat_report', ?, ?, ?, ?, ?)`)
        .run(id, user.account_id, message.sender_account_id, body.messageId, reason, now);
      sendJson(res, 201, { reported: true, id });
      return;
    }

    if (method === "GET" && path === "/api/project-areas") {
      const user = requirePrincipal(session, "user");
      const items = db.prepare(`SELECT id, name, kind, created_at, updated_at FROM project_areas
        WHERE account_id = ? ORDER BY created_at DESC`).all(user.account_id).map((row) => ({
        id: row.id,
        kind: row.kind,
        name: row.name,
        label: `${user.account.label}'s ${row.name}`,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
      sendJson(res, 200, { items });
      return;
    }

    if (method === "POST" && path === "/api/project-areas") {
      const user = requirePrincipal(session, "user");
      requireCsrf(req, user);
      const body = await readBody(req);
      const kind = body.kind;
      if (!["proxy", "games", "custom"].includes(kind)) throw new HttpError(400, "Choose Proxy, games, or a custom project area.");
      const fallbackName = kind === "proxy" ? "Proxy" : kind === "games" ? "games" : "";
      const name = typeof body.name === "string" ? body.name.trim() : fallbackName;
      if (!name || name.length > 50 || /[\u0000-\u001f]/.test(name)) {
        throw new HttpError(400, "Project area name must be between 1 and 50 printable characters.");
      }
      const id = randomUUID();
      const now = new Date().toISOString();
      try {
        db.prepare("INSERT INTO project_areas(id, account_id, name, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(id, user.account_id, name, kind, now, now);
      } catch (error) {
        if (error.code === "ERR_SQLITE_ERROR" && /UNIQUE/.test(error.message)) {
          throw new HttpError(409, "You already have a project area with that name.", "project_area_exists");
        }
        throw error;
      }
      audit(db, user.account.label, "project_area.created", id, { kind, name }, ip);
      sendJson(res, 201, { item: { id, kind, name, label: `${user.account.label}'s ${name}`, createdAt: now, updatedAt: now } });
      return;
    }

    const projectAreaMatch = path.match(/^\/api\/project-areas\/([0-9a-f-]{36})$/i);
    if (method === "PATCH" && projectAreaMatch) {
      const user = requirePrincipal(session, "user");
      requireCsrf(req, user);
      const body = await readBody(req);
      const current = db.prepare("SELECT id, name, kind, created_at FROM project_areas WHERE id = ? AND account_id = ?")
        .get(projectAreaMatch[1], user.account_id);
      if (!current) throw new HttpError(404, "Project area not found.", "not_found");
      const name = body.name === undefined ? current.name : (typeof body.name === "string" ? body.name.trim() : "");
      const kind = body.kind === undefined ? current.kind : body.kind;
      if (!name || name.length > 50 || /[\u0000-\u001f]/.test(name)) {
        throw new HttpError(400, "Project area name must be between 1 and 50 printable characters.");
      }
      if (!["proxy", "games", "custom"].includes(kind)) throw new HttpError(400, "Choose Proxy, games, or a custom project area.");
      const now = new Date().toISOString();
      try {
        db.prepare("UPDATE project_areas SET name = ?, kind = ?, updated_at = ? WHERE id = ? AND account_id = ?")
          .run(name, kind, now, current.id, user.account_id);
      } catch (error) {
        if (error.code === "ERR_SQLITE_ERROR" && /UNIQUE/.test(error.message)) {
          throw new HttpError(409, "You already have a project area with that name.", "project_area_exists");
        }
        throw error;
      }
      audit(db, user.account.label, "project_area.updated", current.id, { kind, name }, ip);
      sendJson(res, 200, { item: { id: current.id, kind, name, label: `${user.account.label}'s ${name}`, createdAt: current.created_at, updatedAt: now } });
      return;
    }

    if (method === "DELETE" && projectAreaMatch) {
      const user = requirePrincipal(session, "user");
      requireCsrf(req, user);
      const result = db.prepare("DELETE FROM project_areas WHERE id = ? AND account_id = ?").run(projectAreaMatch[1], user.account_id);
      if (!result.changes) throw new HttpError(404, "Project area not found.", "not_found");
      audit(db, user.account.label, "project_area.deleted", projectAreaMatch[1], {}, ip);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && path === "/api/admin/logout") {
      const admin = requireOwner(session);
      requireCsrf(req, admin);
      db.prepare("DELETE FROM sessions WHERE id = ?").run(admin.id);
      audit(db, "owner", "admin.session_ended", "owner", {}, ip);
      sendJson(res, 200, { ok: true }, { "Set-Cookie": cookieHeader("", config.secureCookie, true, admin.cookieName) });
      return;
    }

    if (method === "GET" && path === "/api/admin/me") {
      const ownerSession = requireOwner(session);
      sendJson(res, 200, {
        authenticated: true,
        csrf: csrfForSession(cookies[ownerSession.cookieName]),
        twoFactorEnabled: Boolean(db.prepare("SELECT totp_enabled FROM owner WHERE id = 1").get().totp_enabled),
      });
      return;
    }

    if (method === "GET" && path === "/api/admin/site-controls") {
      requireOwner(session);
      sendJson(res, 200, { settings: getSiteControls() });
      return;
    }

    if (method === "PATCH" && path === "/api/admin/site-controls") {
      const admin = requireOwner(session);
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

    if (method === "POST" && path === "/api/admin/desktop/relay/pair") {
      const admin = requireOwner(session);
      requireCsrf(req, admin);
      if (!/^[a-f0-9]{64}$/i.test(desktopSecret)) {
        throw new HttpError(503, "Set DESKTOP_COMPANION_SECRET in .env before pairing the desktop companion.", "companion_not_configured");
      }
      if (Date.now() - desktopRelay.companionLastSeen > 60_000) {
        throw new HttpError(503, "The desktop companion is not connected to Nightjar. Start it on the Linux PC first.", "companion_offline");
      }
      if (
        desktopRelay.ownerSessionId &&
        desktopRelay.sessionExpiresAt > Date.now() &&
        Date.now() - desktopRelay.ownerLastSeen <= DESKTOP_RELAY_IDLE_MS &&
        desktopRelay.ownerSessionId !== admin.id
      ) {
        throw new HttpError(409, "The companion is already paired to another owner session.", "companion_already_paired");
      }
      if (activeDesktopOwner(admin.id)) {
        sendJson(res, 200, { paired: true, sharing: desktopRelay.sharing, inputEnabled: desktopRelay.input });
        return;
      }
      desktopRelay.ownerSessionId = admin.id;
      desktopRelay.ownerLastSeen = Date.now();
      desktopRelay.sessionId = randomBytes(24).toString("base64url");
      desktopRelay.sessionExpiresAt = Date.now() + 4 * 60 * 60 * 1000;
      desktopRelay.sharing = false;
      desktopRelay.input = false;
      desktopRelay.lastFrame = null;
      desktopRelay.lastFrameAt = 0;
      desktopRelay.lastFrameUploadAt = 0;
      desktopRelay.commands = [];
      desktopRelay.pendingCommands.clear();
      audit(db, "owner", "desktop.relay_paired", "local-companion", {}, ip);
      sendJson(res, 200, { paired: true, sharing: false, inputEnabled: false });
      return;
    }

    if (path.startsWith("/api/admin/desktop/relay/")) {
      const admin = requireOwner(session);
      const ownsRelay = activeDesktopOwner(admin.id);
      if (!ownsRelay && path !== "/api/admin/desktop/relay/status") {
        throw new HttpError(401, "Pair the connected desktop companion first.", "companion_not_paired");
      }
      if (method === "GET" && path === "/api/admin/desktop/relay/status") {
        sendJson(res, 200, {
          companionOnline: Date.now() - desktopRelay.companionLastSeen <= 60_000,
          paired: ownsRelay,
          sharing: ownsRelay && desktopRelay.sharing,
          inputEnabled: ownsRelay && desktopRelay.input,
        });
        return;
      }
      if (method === "GET" && path === "/api/admin/desktop/relay/frame") {
        if (!desktopRelay.sharing) throw new HttpError(409, "Screen sharing is not active.", "desktop_not_sharing");
        consumeLimit(`desktop-frame:${admin.id}`, 4, 1000);
        if (!desktopRelay.lastFrame || Date.now() - desktopRelay.lastFrameAt > 5000) {
          throw new HttpError(503, "Waiting for the Linux desktop companion to send a screen frame.", "desktop_frame_pending");
        }
        res.writeHead(200, {
          "Content-Type": "image/png",
          "Content-Length": desktopRelay.lastFrame.length,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(desktopRelay.lastFrame);
        return;
      }
      if (method !== "POST") throw new HttpError(405, "Method not allowed.");
      requireCsrf(req, admin);
      const body = await readBody(req);
      if (path === "/api/admin/desktop/relay/heartbeat") {
        desktopRelay.ownerLastSeen = Date.now();
        sendJson(res, 200, {
          paired: true,
          sharing: desktopRelay.sharing,
          inputEnabled: desktopRelay.input,
        });
        return;
      }
      if (path === "/api/admin/desktop/relay/start") {
        if (!desktopRelay.sharing && ![...desktopRelay.pendingCommands.values()].some((command) => command.action === "start")) {
          queueDesktopCommand("start");
        }
        sendJson(res, 202, { pending: !desktopRelay.sharing, sharing: desktopRelay.sharing });
        return;
      }
      if (path === "/api/admin/desktop/relay/enable-input") {
        if (!desktopRelay.sharing) throw new HttpError(409, "Start screen sharing first.", "desktop_not_sharing");
        if (!desktopRelay.input && ![...desktopRelay.pendingCommands.values()].some((command) => command.action === "enable-input")) {
          queueDesktopCommand("enable-input");
        }
        sendJson(res, 202, { pending: !desktopRelay.input, inputEnabled: desktopRelay.input });
        return;
      }
      if (path === "/api/admin/desktop/relay/input") {
        consumeLimit(`desktop-input:${admin.id}`, 50, 1000);
        if (!desktopRelay.sharing || !desktopRelay.input) {
          throw new HttpError(403, "Local approval for remote input is not active.", "desktop_input_not_approved");
        }
        if (desktopRelay.commands.filter((command) => command.action === "input").length >= 20) {
          throw new HttpError(429, "Desktop input is being sent too quickly.", "desktop_input_rate_limited");
        }
        if (
          !body ||
          typeof body.action !== "string" ||
          !["move", "click", "key", "type"].includes(body.action)
        ) throw new HttpError(400, "Choose a supported pointer, key, or text action.", "invalid_desktop_input");
        if (body.action === "move" || body.action === "click") {
          if (!Number.isInteger(body.x) || !Number.isInteger(body.y) || body.x < 0 || body.x > 16384 || body.y < 0 || body.y > 16384) {
            throw new HttpError(400, "Pointer coordinates are outside the allowed range.", "invalid_desktop_input");
          }
        }
        if (body.action === "click" && !["left", "right", "middle"].includes(body.button ?? "left")) {
          throw new HttpError(400, "Choose left, right, or middle click.", "invalid_desktop_input");
        }
        if (body.action === "key" && !["escape", "backspace", "tab", "enter", "space", "home", "up", "page-up", "left", "right", "end", "down", "page-down"].includes(body.key)) {
          throw new HttpError(400, "That key is not available for remote input.", "invalid_desktop_input");
        }
        if (body.action === "type" && (typeof body.text !== "string" || ![...body.text].length || [...body.text].length > 120 || [...body.text].some((character) => /\p{C}/u.test(character)))) {
          throw new HttpError(400, "Text must contain 1–120 printable characters.", "invalid_desktop_input");
        }
        queueDesktopCommand("input", { input: body });
        sendJson(res, 202, { queued: true });
        return;
      }
      if (path === "/api/admin/desktop/relay/stop") {
        const stopCommand = queueDesktopCommand("stop");
        desktopRelay.pendingCommands.delete(stopCommand.id);
        desktopRelay.ownerSessionId = "";
        desktopRelay.ownerLastSeen = 0;
        desktopRelay.sessionId = "";
        desktopRelay.sessionExpiresAt = 0;
        desktopRelay.sharing = false;
        desktopRelay.input = false;
        desktopRelay.lastFrame = null;
        desktopRelay.lastFrameAt = 0;
        desktopRelay.lastFrameUploadAt = 0;
        audit(db, "owner", "desktop.relay_stopped", "local-companion", {}, ip);
        sendJson(res, 200, { stopped: true });
        return;
      }
      throw new HttpError(404, "Desktop relay route not found.", "not_found");
    }

    if (method === "POST" && path === "/api/admin/desktop/ticket") {
      const admin = requireOwner(session);
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

    if (method === "POST" && path === "/api/admin/desktop/viewer-ticket") {
      const admin = requireOwner(session);
      requireCsrf(req, admin);
      if (!/^[a-f0-9]{64}$/i.test(desktopSecret)) {
        throw new HttpError(503, "Set DESKTOP_COMPANION_SECRET in .env before opening the desktop viewer.", "companion_not_configured");
      }
      consumeLimit(`desktop-viewer-ticket:${admin.id}`, 4, 60_000);
      const now = Date.now();
      for (const [ticketHash, ticket] of desktopViewerTickets) {
        if (ticket.expiresAt <= now) desktopViewerTickets.delete(ticketHash);
      }
      const ticket = randomBytes(32).toString("base64url");
      desktopViewerTickets.set(hash(ticket), { ownerSessionId: admin.id, expiresAt: now + 60_000 });
      audit(db, "owner", "desktop.viewer_ticket_issued", "local-companion", { expiresInSeconds: 60 }, ip);
      sendJson(res, 200, { url: `/admin/desktop-viewer?ticket=${encodeURIComponent(ticket)}`, expiresInSeconds: 60 });
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
      requireOwner(session);
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
      requireOwner(session);
      const rows = db.prepare(`SELECT t.*, a.label AS account_label FROM tokens t JOIN accounts a ON a.id = t.account_id
        ORDER BY t.created_at DESC LIMIT 200`).all();
      sendJson(res, 200, { items: rows.map(rowToToken) });
      return;
    }

    if (method === "GET" && path === "/api/admin/accounts") {
      requireOwner(session);
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
      const admin = requireOwner(session);
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
      db.prepare("UPDATE tokens SET rank = ?, permissions_json = ? WHERE account_id = ?")
        .run(rank, JSON.stringify(permissions), account.id);
      db.prepare("DELETE FROM sessions WHERE account_id = ? AND principal = 'user'").run(account.id);
      for (const active of sessions) closeProxySession(active.id);
      audit(db, "owner", "account.updated", account.id, { label, rank, permissions, features, sessionCountTerminated: sessions.length }, ip);
      sendJson(res, 200, { ok: true, sessionsTerminated: sessions.length });
      return;
    }

    const revokeAccountMatch = path.match(/^\/api\/admin\/accounts\/([0-9a-f-]{36})\/revoke$/i);
    if (method === "POST" && revokeAccountMatch) {
      const admin = requireOwner(session);
      requireCsrf(req, admin);
      const account = db.prepare("SELECT id, revoked_at FROM accounts WHERE id = ?").get(revokeAccountMatch[1]);
      if (!account) throw new HttpError(404, "Account not found.", "not_found");
      if (!account.revoked_at) {
        const revokedAt = new Date().toISOString();
        db.prepare("UPDATE accounts SET revoked_at = ? WHERE id = ?").run(revokedAt, account.id);
        revokeAccount(account.id, "owner_revoked", ip, "owner");
        db.prepare(`INSERT INTO moderation_events(id, kind, actor, subject_account_id, reason, status, created_at)
          VALUES (?, 'account_ban', 'owner', ?, 'Owner revoked account access', 'resolved', ?)`)
          .run(randomUUID(), account.id, revokedAt);
      }
      audit(db, "owner", "account.revoked", account.id, {}, ip);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && path === "/api/admin/sessions") {
      requireOwner(session);
      const items = db.prepare(`SELECT s.id, s.account_id, s.token_id, s.created_at, s.last_seen_at, s.expires_at, a.label AS account_label
        FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.principal = 'user' ORDER BY s.last_seen_at DESC`).all()
        .map((row) => ({ id: row.id, accountId: row.account_id, tokenId: row.token_id, accountLabel: row.account_label, createdAt: row.created_at, lastSeenAt: row.last_seen_at, expiresAt: row.expires_at }));
      sendJson(res, 200, { items });
      return;
    }

    if (method === "POST" && path === "/api/admin/tokens") {
      const admin = requireOwner(session);
      requireCsrf(req, admin);
      if (!siteControls.invitationsEnabled) throw new HttpError(423, "New invitations are disabled by the owner.", "invitations_disabled");
      const body = await readBody(req);
      const label = typeof body.label === "string" ? body.label.trim().slice(0, 80) : "";
      const requestedAccountLabel = typeof body.accountLabel === "string" ? body.accountLabel.trim().slice(0, 80) : "";
      if (!label) throw new HttpError(400, "Token label is required.");
      if (body.friend !== undefined && typeof body.friend !== "boolean") {
        throw new HttpError(400, "Friend status must be a boolean.");
      }
      const accountId = typeof body.accountId === "string" && body.accountId
        ? body.accountId
        : randomUUID();
      const existingAccount = db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId);
      if (existingAccount && existingAccount.revoked_at) throw new HttpError(400, "Revoked accounts cannot receive replacement invitations.");
      let rankId = typeof body.rank === "string" && body.rank ? body.rank : (existingAccount?.rank ?? "basic");
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
        db.prepare(`INSERT INTO accounts(id, label, settings_json, permissions_json, features_json, rank, is_friend, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(accountId, accountLabel, JSON.stringify(settings), JSON.stringify(permissions), JSON.stringify(features), rankId, body.friend ? 1 : 0, new Date().toISOString());
        createDefaultProjectAreas(db, accountId);
      } else {
        const updated = body.settings === undefined
          ? safeJson(existingAccount.settings_json, DEFAULT_SETTINGS)
          : normalizeSettings(body.settings, safeJson(existingAccount.settings_json, DEFAULT_SETTINGS));
        db.prepare(`UPDATE accounts SET label = ?, settings_json = ?, permissions_json = ?, features_json = ?, rank = ?,
          is_friend = CASE WHEN ? THEN 1 ELSE is_friend END WHERE id = ?`)
          .run(accountLabel, JSON.stringify(updated), JSON.stringify(permissions), JSON.stringify(features), rankId, body.friend === true ? 1 : 0, accountId);
        db.prepare("UPDATE tokens SET rank = ?, permissions_json = ? WHERE account_id = ?")
          .run(rankId, JSON.stringify(permissions), accountId);
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
        aiUsageLimit: LIMITED_AI_RANKS.has(rankId) ? BASIC_AI_REQUEST_LIMIT : null,
        aiUsageCount: 0,
        createdAt: now,
        lastUsedAt: null,
        revokedAt: null,
        status: "active",
      } });
      return;
    }

    const revokeMatch = path.match(/^\/api\/admin\/tokens\/([0-9a-f-]{36})\/revoke$/);
    if (method === "POST" && revokeMatch) {
      const admin = requireOwner(session);
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
      const admin = requireOwner(session);
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
      requireOwner(session);
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
      const address = url.searchParams.get("q") ?? "";
      const searchProvider = session?.principal === "user"
        ? safeJson(session.account.settings_json, DEFAULT_SETTINGS).searchProvider
        : DEFAULT_SETTINGS.searchProvider;
      sendJson(res, 200, { url: normalizeAddress(address, searchProvider) });
      return;
    }

    if (method === "GET" && path === "/api/capabilities") {
      const user = requirePrincipal(session, "user");
      const features = safeJson(user.account.features_json, []);
      const permissions = safeJson(user.account.permissions_json, []);
      const aiLimit = LIMITED_AI_RANKS.has(user.token.rank) ? BASIC_AI_REQUEST_LIMIT : null;
      const aiUsed = user.token.ai_usage_count ?? 0;
      const aiRemaining = aiLimit === null ? null : Math.max(0, aiLimit - aiUsed);
      const hasAiPermission = features.includes("assistant") && permissions.includes("assistant");
      const aiAllowed = siteControls.assistantEnabled && hasAiPermission && (aiRemaining === null || aiRemaining > 0);
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
        email: { configured: emailConfigured, provider: emailConfigured ? "Resend" : null },
        downloads: { available: false, reason: "A web app cannot observe or manage host-browser downloads. This requires a signed desktop application." },
        desktopControl: { available: false, reason: "No desktop companion is installed or paired. Remote input and screen sharing are intentionally unavailable here." },
        ai: {
          allowed: aiAllowed,
          reachable,
          model: aiModel,
          modelInstalled,
          serviceStatus: aiAllowed ? aiState.status : "not_allowed",
          startedByApp: aiState.startedByApp,
          usage: { limit: aiLimit, used: aiUsed, remaining: aiRemaining },
          reason: !siteControls.assistantEnabled ? "The owner has disabled local assistant access for this site." : (!hasAiPermission ? "The account does not have local assistant permission." : (aiRemaining === 0 ? "This token has used all 20 Basic AI requests." : (!reachable ? "The local Ollama service is not responding yet." : (!modelInstalled ? `Model ${aiModel} is not installed. Install it locally with Ollama before chatting.` : "")))),
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
      const aiLimit = LIMITED_AI_RANKS.has(user.token.rank) ? BASIC_AI_REQUEST_LIMIT : null;
      if (aiLimit !== null && (user.token.ai_usage_count ?? 0) >= aiLimit) {
        throw new HttpError(429, "This invitation has used all 20 Basic AI requests.", "ai_quota_exhausted");
      }
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
      db.prepare("UPDATE tokens SET ai_usage_count = ai_usage_count + 1 WHERE id = ?").run(user.token_id);
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
        "connect-src 'self'",
        "upgrade-insecure-requests",
      ].join("; "));
    }
  }

  function handleDashboardCors(req, res, url) {
    if (url.pathname !== "/api/owner/dashboard/tokens") return false;
    const origin = req.headers.origin;
    if (origin) {
      if (!dashboardOrigins.has(origin)) throw new HttpError(403, "This dashboard origin is not configured.", "origin_rejected");
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "OPTIONS") return false;
    if (!origin) throw new HttpError(403, "A configured dashboard origin is required.", "origin_rejected");
    const requestedHeaders = (req.headers["access-control-request-headers"] ?? "")
      .split(",").map((header) => header.trim().toLowerCase()).filter(Boolean);
    if (requestedHeaders.some((header) => !["content-type"].includes(header))) {
      throw new HttpError(403, "The dashboard preflight requested an unsupported header.", "headers_rejected");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    if (requestedHeaders.length) res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "600");
    res.statusCode = 204;
    res.end();
    return true;
  }

  async function route(req, res) {
    const start = Date.now();
    const url = new URL(req.url, "http://nightjar.local");
    try {
      if (handleDashboardCors(req, res, url)) return;
      if (await routeDesktopCompanion(req, res, url)) {
        return;
      } else if (url.pathname.startsWith("/api/")) {
        await routeApi(req, res, url);
      } else if (url.pathname === "/admin/desktop-viewer") {
        if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
        const owner = requireOwner(requestSession(req));
        const ticket = url.searchParams.get("ticket") ?? "";
        if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) {
          throw new HttpError(404, "This one-time desktop tab is invalid or has already been used.", "desktop_viewer_unavailable");
        }
        const ticketHash = hash(ticket);
        const launch = desktopViewerTickets.get(ticketHash);
        if (!launch || launch.expiresAt <= Date.now() || launch.ownerSessionId !== owner.id) {
          throw new HttpError(404, "This one-time desktop tab is invalid or has already been used.", "desktop_viewer_unavailable");
        }
        desktopViewerTickets.delete(ticketHash);
        const data = await readFile(resolve(PUBLIC_ROOT, "desktop-viewer.html"));
        securityHeaders(res, true, true);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.statusCode = 200;
        res.end(data);
      } else {
        if (!["GET", "HEAD"].includes(req.method)) throw new HttpError(405, "Method not allowed.");
        const pathname = url.pathname === "/" ? "/index.html" : (url.pathname === "/admin" ? "/admin.html" : url.pathname);
        const filePath = resolve(PUBLIC_ROOT, `.${decodeURIComponent(pathname)}`);
        if (filePath !== PUBLIC_ROOT && !filePath.startsWith(PUBLIC_ROOT + sep)) throw new HttpError(404, "Not found.", "not_found");
        const data = await readFile(filePath);
        securityHeaders(res, extname(filePath) === ".html", pathname === "/admin" || pathname === "/admin.html" || pathname === "/admin/desktop-viewer");
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
      const filePath = proxyAssetPath(url.pathname);
      if (filePath) {
        if (!["GET", "HEAD"].includes(req.method)) throw new HttpError(405, "Method not allowed.");
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
            "script-src 'self'",
            "connect-src 'self' ws: wss: https: http:",
            "worker-src 'self' blob:",
          ].join("; "));
        }
        res.statusCode = 200;
        res.end(req.method === "HEAD" ? undefined : data);
        return;
      }

      const authorized = authorizedRammerheadSession(req, url);
      if (!authorized || !allowedRammerheadDestination(url)) {
        throw new HttpError(403, "This Rammerhead request is not authorized.", "proxy_request_rejected");
      }
      if (authorized.principal === "guest") consumeLimit(`guest-proxy:${authorized.ip}`, guestProxyRequestLimit, 60_000);
      if (!trackProxySocket(authorized, req.socket)) {
        throw new HttpError(429, "Too many concurrent Rammerhead connections.", "proxy_connection_limit");
      }
      const pending = rammerhead._onRequest(req, res, rammerhead.server1Info);
      if (pending?.catch) pending.catch((error) => {
        console.error(JSON.stringify({ level: "error", message: error.message, path: url.pathname, method: req.method }));
        if (!res.headersSent) {
          res.statusCode = 502;
          res.end("The Rammerhead request failed.");
        }
      });
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
    ]);
    return assets.get(pathname) ?? null;
  }

  proxyServer.on("upgrade", (req, socket, head) => {
    try {
      const url = new URL(req.url, proxyOrigin());
      const authorized = authorizedRammerheadSession(req, url);
      if (!authorized || !allowedRammerheadDestination(url)) {
        socket.destroy();
        return;
      }
      if (authorized.principal === "guest") {
        try {
          consumeLimit(`guest-proxy:${authorized.ip}`, guestProxyRequestLimit, 60_000);
        } catch {
          socket.destroy();
          return;
        }
      }
      if (!trackProxySocket(authorized, socket)) {
        socket.destroy();
        return;
      }
      const pending = rammerhead._onUpgradeRequest(req, socket, head, rammerhead.server1Info);
      if (pending?.catch) pending.catch((error) => {
        console.error(JSON.stringify({ level: "error", message: error.message, path: url.pathname, method: req.method }));
        socket.destroy();
      });
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
      for (const engineSessionId of [...rammerheadSessions.keys()]) closeRammerheadSession(engineSessionId);
      if (ollamaChild) {
        ollamaChild.kill("SIGTERM");
        ollamaChild = null;
      }
    },
  };
}

let consoleInput = null;

export function formatAddressConflict(service, host, port, listenerInfo = "") {
  const setting = service === "Luma" ? "PORT" : "RAMMERHEAD_PORT";
  const owner = listenerInfo ? ` Existing listener: ${listenerInfo}.` : ` Identify it with \`ss -ltnp 'sport = :${port}'\` or \`lsof -nP -iTCP:${port} -sTCP:LISTEN\`.`;
  const proxyNote = service === "Rammerhead"
    ? " If using a manual reverse proxy, update its Rammerhead upstream to match."
    : "";
  return `Startup failed: ${service} cannot bind ${host}:${port} (EADDRINUSE).${owner} Leave the existing process untouched, or set ${setting} to an unused port, for example \`${setting}=4175 npm start\`.${proxyNote}`;
}

function findPortListener(port) {
  const result = spawnSync("ss", ["-ltnp", `sport = :${port}`], { encoding: "utf8", timeout: 1000 });
  if (result.error || result.status !== 0) return "";
  return result.stdout.split(/\r?\n/).find((line) => line.includes(`:${port}`))?.trim() ?? "";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = env("HOST", "127.0.0.1");
  const port = Number(env("PORT", "4173"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535.");
  const app = await createApp();
  let shuttingDown = false;
  const close = (exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    const finalExitCode = Number.isInteger(exitCode) ? exitCode : 0;
    app.stop();
    if (consoleInput) consoleInput.close();
    const closeServer = (server, callback) => {
      if (server.listening) server.close(callback);
      else callback();
    };
    closeServer(app.server, () => {
      closeServer(app.proxyServer, () => {
        app.db.close();
        process.exitCode = finalExitCode;
      });
    });
  };
  const proxyHost = env("RAMMERHEAD_HOST", env("SCRAMJET_HOST", "127.0.0.1"));
  const proxyPort = Number(env("RAMMERHEAD_PORT", env("SCRAMJET_PORT", "4174")));
  const listen = (server, service, listenHost, listenPort, callback) => {
    const onError = (error) => {
      if (error.code === "EADDRINUSE") {
        console.error(formatAddressConflict(service, listenHost, listenPort, findPortListener(listenPort)));
      } else {
        console.error(`Startup failed: ${service} listener error: ${error.message}`);
      }
      close(1);
    };
    server.once("error", onError);
    server.once("listening", () => server.off("error", onError));
    server.listen(listenPort, listenHost, callback);
  };
  listen(app.proxyServer, "Rammerhead", proxyHost, proxyPort, () => {
    console.info(JSON.stringify({ level: "info", message: "Rammerhead browsing engine is ready", host: proxyHost, port: app.proxyServer.address().port, origin: env("RAMMERHEAD_ORIGIN", env("SCRAMJET_ORIGIN", `http://${proxyHost}:${app.proxyServer.address().port}`)) }));
  });
  listen(app.server, "Luma", host, port, () => {
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
--rank <rank-id>                 basic,full,standard,with-ai,without-ai or custom
--uses 1                         Every invitation is single-use
--expires <date-or-timestamp>    e.g. 2026-12-31
--permissions <comma-list>       browse,bookmarks,history,settings,assistant,games,support
--features <comma-list|none>     bookmarks,history,settings,assistant,games,support
 
Each invitation can be redeemed once. The signed-in browser uses an HttpOnly cookie session;
use \`token renew\` to issue a replacement. Basic includes 20 lifetime local AI requests per
token; With AI and Full include unlimited local AI. Legacy rank IDs remain accepted for
existing accounts and tokens. Owner-console access remains a separate special authorization.
Enabled features must also appear in permissions.
A token is shown only once.
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
