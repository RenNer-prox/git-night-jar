import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { connect } from "node:net";
import WebSocket from "ws";
import { client as wisp } from "@mercuryworkshop/wisp-js/client";
import { createApp, runAdminCommand } from "../server.js";

const password = "a-strong-owner-password-for-tests";
let app;
let baseUrl;
let adminCookie;
let adminCsrf;
let tempDirectory;

const ollamaFetch = async (url, options = {}) => {
  assert.equal(options.redirect, "error");
  const path = new URL(url).pathname;
  if (path === "/api/tags") {
    return new Response(JSON.stringify({ models: [{ name: "qwen3:4b" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (path === "/api/chat") {
    const payload = JSON.parse(options.body);
    assert.equal(payload.model, "qwen3:4b");
    assert.equal(payload.think, false);
    assert.equal(payload.messages[0].role, "system");
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"message":{"content":"Hello "},"done":false}\n{"message":{"content":"from local."},"done":false}\n{"done":true}\n'));
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
  }
  return new Response("not found", { status: 404 });
};

async function request(path, { method = "GET", cookie, csrf, body, origin } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers["X-NJ-CSRF"] = csrf;
  if (origin) headers.Origin = origin;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = response.headers.get("content-type")?.includes("application/json")
    ? await response.json()
    : await response.text();
  return { response, data };
}

function cookieFrom(response, name) {
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, `expected ${name} cookie`);
  const match = setCookie.match(new RegExp(`(?:^|,\\s*)${name}=([^;]*)`));
  assert.ok(match, `expected ${name} cookie`);
  return `${name}=${match[1]}`;
}

async function websocketUpgrade(port, path, origin) {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    let response = "";
    const finish = () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(response);
    };
    const timer = setTimeout(finish, 1000);
    socket.on("connect", () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nOrigin: ${origin}\r\n\r\n`);
    });
    socket.on("data", (chunk) => { response += chunk.toString(); finish(); });
    socket.on("close", finish);
    socket.on("error", finish);
  });
}

async function connectWisp(url, origin) {
  class OriginWispConnection extends wisp.ClientConnection {
    connect_ws() {
      const subprotocol = this.wisp_version === 2 ? "wisp-v2" : undefined;
      this.ws = new WebSocket(this.wisp_url, subprotocol, { headers: { Origin: origin } });
      this.ws.binaryType = "arraybuffer";
      this.connecting = true;
      this.ws.onmessage = (event) => {
        this.on_ws_msg(event);
        if (this.connected && this.connecting) {
          this.connecting = false;
          this.onopen();
        }
      };
      this.ws.onclose = () => {
        this.cleanup();
        this.onclose();
      };
      this.ws.onerror = () => {
        this.cleanup();
        this.onerror();
      };
    }
  }

  const connection = new OriginWispConnection(url);
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Wisp handshake timed out.")), 5000);
      connection.onopen = () => {
        clearTimeout(timeout);
        resolve();
      };
      connection.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Wisp handshake failed."));
      };
    });
    return connection;
  } catch (error) {
    connection.close();
    throw error;
  }
}

async function issueToken({ label, usageLimit = "", accountId = "", rank, features = ["bookmarks", "history", "settings", "assistant"], permissions = ["browse", "bookmarks", "history", "settings", "assistant"] } = {}) {
  const { response, data } = await request("/api/admin/tokens", {
    method: "POST", cookie: adminCookie, csrf: adminCsrf,
    body: {
      label: label ?? `Test ${Date.now()}`,
      accountLabel: label ?? "Test Account",
      accountId,
      rank,
      usageLimit,
      permissions,
      features,
    },
  });
  assert.equal(response.status, 201, JSON.stringify(data));
  return data;
}

before(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "nightjar-test-"));
  app = await createApp({
    databasePath: join(tempDirectory, "nightjar.sqlite"),
    proxyHost: "127.0.0.1",
    proxyPort: 0,
    adminPassword: password,
    aiAutostart: false,
    desktopSecret: "a".repeat(64),
    ollamaFetch,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  await new Promise((resolve) => app.proxyServer.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  const admin = await request("/api/admin/login", {
    method: "POST",
    body: { password },
  });
  assert.equal(admin.response.status, 200, JSON.stringify(admin.data));
  adminCookie = cookieFrom(admin.response, "nj_admin");
  adminCsrf = admin.data.csrf;
  const refreshed = await request("/api/admin/me", { cookie: adminCookie });
  assert.equal(refreshed.response.status, 200);
  adminCsrf = refreshed.data.csrf;
});

after(async () => {
  if (app?.server.listening) await new Promise((resolve) => app.server.close(resolve));
  if (app?.proxyServer.listening) await new Promise((resolve) => app.proxyServer.close(resolve));
  app?.stop();
  app?.db.close();
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
});

test("serves the browser and keeps administrator routes isolated", async () => {
  const page = await fetch(`${baseUrl}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), new RegExp(`frame-src http://127\\.0\\.0\\.1:${app.proxyServer.address().port}`));
  const pageHtml = await page.text();
  assert.match(pageHtml, /id="theme-toggle"/);
  assert.match(pageHtml, /id="help-open"/);
  const client = await fetch(`${baseUrl}/app.js`);
  assert.equal(client.status, 200);
  const appScript = await client.text();
  assert.match(appScript, /function openHelp\(\)/);
  assert.match(appScript, /https:\/\/gn-math\.dev/);
  assert.match(appScript, /function openQuickMathGame\(\)/);
  const styles = await fetch(`${baseUrl}/styles.css`);
  assert.equal(styles.status, 200);
  assert.match(await styles.text(), /\.game-lounge/);
  const adminPage = await fetch(`${baseUrl}/admin`);
  assert.equal(adminPage.status, 200);
  const adminCsp = adminPage.headers.get("content-security-policy");
  assert.match(adminCsp, /img-src 'self' data: https: blob:/);
  assert.match(adminCsp, /connect-src 'self' http:\/\/127\.0\.0\.1:4175/);
  const adminHtml = await adminPage.text();
  assert.match(adminHtml, /Administrator sign-in/);
  assert.match(adminHtml, /Pair this owner session/);
  assert.match(adminHtml, /HttpOnly session cookie and CSRF protection/);
  assert.doesNotMatch(adminHtml, /desktop-pair-code|one-time code shown in companion terminal/);
  const proxyOrigin = `http://127.0.0.1:${app.proxyServer.address().port}`;
  const proxyPage = await fetch(`${proxyOrigin}/`);
  assert.equal(proxyPage.status, 200);
  const proxyCsp = proxyPage.headers.get("content-security-policy");
  assert.match(proxyCsp, new RegExp(`frame-ancestors ${baseUrl.replaceAll(".", "\\.")} http://localhost:${app.server.address().port}`));
  assert.match(await proxyPage.text(), /browsing engine/);
  const directProxyShell = await fetch(`${proxyOrigin}/proxy-shell.html`);
  assert.equal(directProxyShell.status, 200);
  const directProxyHtml = await directProxyShell.text();
  assert.match(directProxyHtml, /browsing engine/);
  assert.match(directProxyHtml, /scramjet\.all\.js/);
  assert.doesNotMatch(directProxyHtml, /scramjet\.bundle\.js/);
  const proxyClient = await fetch(`${proxyOrigin}/dist/proxy-shell.js`);
  assert.equal(proxyClient.status, 200);
  const proxyClientScript = await proxyClient.text();
  assert.match(proxyClientScript, /standalone-shell/);
  assert.match(proxyClientScript, /Open Nightjar/);
  const scramjet = await fetch(`${proxyOrigin}/scram/scramjet.all.js`);
  assert.equal(scramjet.status, 200);
  assert.match(scramjet.headers.get("content-type"), /javascript/);
  const forbiddenProxyAsset = await fetch(`${proxyOrigin}/../server.js`);
  assert.equal(forbiddenProxyAsset.status, 404);
  const forbidden = await request("/api/admin/summary");
  assert.equal(forbidden.response.status, 401);
});

test("allows multiple independent owner sessions", async () => {
  const adminIndexes = app.db.prepare("PRAGMA index_list(sessions)").all();
  assert.ok(!adminIndexes.some((index) => index.name === "one_admin_session"));
  assert.ok(app.db.prepare("SELECT version FROM schema_migrations WHERE version = 6").get());

  const secondLogin = await request("/api/admin/login", { method: "POST", body: { password } });
  assert.equal(secondLogin.response.status, 200, JSON.stringify(secondLogin.data));
  const secondCookie = cookieFrom(secondLogin.response, "nj_admin");
  const secondMe = await request("/api/admin/me", { cookie: secondCookie });
  assert.equal(secondMe.response.status, 200);

  const logout = await request("/api/admin/logout", {
    method: "POST", cookie: secondCookie, csrf: secondMe.data.csrf, body: {},
  });
  assert.equal(logout.response.status, 200);
  assert.equal((await request("/api/admin/me", { cookie: adminCookie })).response.status, 200);
  assert.equal((await request("/api/admin/me", { cookie: secondCookie })).response.status, 401);
});

test("hashes invitation tokens, enforces permissions, and persists bookmarks, history and settings", async () => {
  const issued = await issueToken({ label: "Research account", usageLimit: 1 });
  assert.equal(issued.item.status, "active");
  assert.ok(!JSON.stringify(app.db.prepare("SELECT token_hash FROM tokens").all()).includes(issued.token));
  const login = await request("/api/auth/login", { method: "POST", body: { token: issued.token } });
  assert.equal(login.response.status, 200, JSON.stringify(login.data));
  assert.match(login.response.headers.get("set-cookie"), /HttpOnly/);
  assert.match(login.response.headers.get("set-cookie"), /SameSite=Strict/);
  const userCookie = cookieFrom(login.response, "nj_session");
  const userCsrf = login.data.csrf;
  assert.equal(login.data.account.label, "Research account");
  const stolenInvitation = await request("/api/auth/login", { method: "POST", body: { token: issued.token } });
  assert.equal(stolenInvitation.response.status, 401);
  assert.equal(stolenInvitation.data.code, "usage_limit_reached");
  const sessionRow = app.db.prepare("SELECT id FROM sessions WHERE account_id = ? AND principal = 'user'").get(issued.item.accountId);
  app.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 2 * 60_000).toISOString(), sessionRow.id);
  assert.equal((await request("/api/session", { cookie: userCookie })).response.status, 200, "a short idle period must not invalidate the cookie session");
  const tokenList = await request("/api/admin/tokens", { cookie: adminCookie });
  assert.equal(tokenList.data.items.find((item) => item.id === issued.item.id).status, "redeemed");
  const grant = await request("/api/browser/grant", {
    method: "POST", cookie: userCookie, csrf: userCsrf, body: {}, origin: baseUrl,
  });
  assert.equal(grant.response.status, 200, JSON.stringify(grant.data));
  assert.equal(grant.data.proxyOrigin, `http://127.0.0.1:${app.proxyServer.address().port}`);
  const proxyPort = app.proxyServer.address().port;
  const deniedWisp = await websocketUpgrade(proxyPort, "/wisp/?grant=not-a-session-grant", grant.data.proxyOrigin);
  assert.doesNotMatch(deniedWisp, /101 Switching Protocols/);
  const validWisp = await connectWisp(
    `ws://127.0.0.1:${proxyPort}/wisp/?grant=${encodeURIComponent(grant.data.grant)}/`,
    grant.data.proxyOrigin,
  );
  assert.equal(validWisp.connected, true);
  validWisp.close();

  const adminOwnSession = await request("/api/admin/me", { cookie: adminCookie });
  assert.equal(adminOwnSession.response.status, 200, "separate admin and user cookies remain independent");
  const adminBlockedWithUserCookie = await request("/api/admin/summary", { cookie: userCookie });
  assert.equal(adminBlockedWithUserCookie.response.status, 401);
  const userBlockedFromAdminRoute = await request("/api/session", { cookie: adminCookie });
  assert.equal(userBlockedFromAdminRoute.response.status, 401);

  const noCsrf = await request("/api/bookmarks", {
    method: "POST", cookie: userCookie, body: { url: "https://example.org/", title: "Example" },
  });
  assert.equal(noCsrf.response.status, 403);

  const bookmark = await request("/api/bookmarks", {
    method: "POST", cookie: userCookie, csrf: userCsrf,
    body: { url: "https://example.org/", title: "Example" },
  });
  assert.equal(bookmark.response.status, 201, JSON.stringify(bookmark.data));
  const bookmarks = await request("/api/bookmarks?limit=1", { cookie: userCookie });
  assert.equal(bookmarks.response.status, 200);
  assert.equal(bookmarks.data.items[0].title, "Example");
  const duplicate = await request("/api/bookmarks", {
    method: "POST", cookie: userCookie, csrf: userCsrf,
    body: { url: "https://example.org/", title: "Example again" },
  });
  assert.equal(duplicate.response.status, 409);
  const removeBookmark = await request(`/api/bookmarks/${bookmark.data.id}`, {
    method: "DELETE", cookie: userCookie, csrf: userCsrf,
  });
  assert.equal(removeBookmark.response.status, 200);
  assert.equal((await request("/api/bookmarks", { cookie: userCookie })).data.items.length, 0);

  const history = await request("/api/history", {
    method: "POST", cookie: userCookie, csrf: userCsrf,
    body: { url: "https://example.org/", title: "Example" },
  });
  assert.equal(history.response.status, 201);
  const visits = await request("/api/history?limit=1", { cookie: userCookie });
  assert.equal(visits.data.items.length, 1);
  assert.ok(visits.data.nextCursor);
  const deletedHistory = await request(`/api/history/${visits.data.items[0].id}`, {
    method: "DELETE", cookie: userCookie, csrf: userCsrf,
  });
  assert.equal(deletedHistory.response.status, 200);
  assert.equal((await request("/api/history", { cookie: userCookie })).data.items.length, 0);
  await request("/api/history", {
    method: "POST", cookie: userCookie, csrf: userCsrf,
    body: { url: "https://example.org/second", title: "Second page" },
  });
  const cleared = await request("/api/history", { method: "DELETE", cookie: userCookie, csrf: userCsrf });
  assert.equal(cleared.response.status, 200);
  assert.equal((await request("/api/history", { cookie: userCookie })).data.items.length, 0);

  const savedSettings = await request("/api/settings", {
    method: "PUT", cookie: userCookie, csrf: userCsrf,
    body: { settings: { theme: "light", accent: "#286f91", density: "compact", homepage: "home", searchProvider: "brave", customCursor: false, privacy: { suppressReferrer: false, clearOnExit: true } } },
  });
  assert.equal(savedSettings.response.status, 200, JSON.stringify(savedSettings.data));
  const reloaded = await request("/api/session", { cookie: userCookie });
  assert.equal(reloaded.data.account.settings.theme, "light");
  assert.equal(reloaded.data.csrf, userCsrf);

  const unsafeAddress = await request("/api/browser/resolve?q=javascript%3Aalert(1)", { cookie: userCookie });
  assert.equal(unsafeAddress.response.status, 400);
  const unsupportedScheme = await request("/api/browser/resolve?q=ftp%3A%2F%2Fexample.org", { cookie: userCookie });
  assert.equal(unsupportedScheme.response.status, 400);
  const hostPort = await request("/api/browser/resolve?q=example.org%3A8443%2Fpage", { cookie: userCookie });
  assert.equal(hostPort.data.url, "https://example.org:8443/page");
  const noTld = await request("/api/browser/resolve?q=nightjar", { cookie: userCookie });
  assert.equal(noTld.data.url, "https://search.brave.com/search?q=nightjar");
  const unknownTld = await request("/api/browser/resolve?q=some%20madeup.invalidtld", { cookie: userCookie });
  assert.equal(unknownTld.data.url, "https://search.brave.com/search?q=some%20madeup.invalidtld");
  const recognizedTld = await request("/api/browser/resolve?q=example.com%2Fsearch", { cookie: userCookie });
  assert.equal(recognizedTld.data.url, "https://example.com/search");

  const caps = await request("/api/capabilities", { cookie: userCookie });
  assert.equal(caps.data.ai.allowed, true);
  assert.equal(caps.data.ai.modelInstalled, true);
  assert.equal(caps.data.desktopControl.available, false);
  assert.equal(caps.data.downloads.available, false);

  const chat = await request("/api/ai/chat", {
    method: "POST", cookie: userCookie, csrf: userCsrf,
    body: { messages: [{ role: "user", content: "Hello" }] },
  });
  assert.equal(chat.response.status, 200);
  assert.match(chat.response.headers.get("content-type"), /text\/event-stream/);
  const streamedText = chat.data.split("\n").filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)).text ?? "").join("");
  assert.equal(streamedText, "Hello from local.");

  const revoked = await request(`/api/admin/tokens/${issued.item.id}/revoke`, {
    method: "POST", cookie: adminCookie, csrf: adminCsrf, body: {},
  });
  assert.equal(revoked.response.status, 200);
  assert.equal((await request("/api/session", { cookie: userCookie })).response.status, 401);
  const reuse = await request("/api/auth/login", { method: "POST", body: { token: issued.token } });
  assert.equal(reuse.response.status, 401);
});

test("a second active account sign-in revokes authorization and permits a replacement invitation", async () => {
  const issued = await issueToken({ label: "Single session" });
  const secondInvitation = await issueToken({ label: "Second invite", accountId: issued.item.accountId });
  const firstLogin = await request("/api/auth/login", { method: "POST", body: { token: issued.token } });
  assert.equal(firstLogin.response.status, 200);
  const firstCookie = cookieFrom(firstLogin.response, "nj_session");
  const spentToken = await request("/api/auth/login", { method: "POST", body: { token: issued.token } });
  assert.equal(spentToken.response.status, 401);
  assert.equal((await request("/api/session", { cookie: firstCookie })).response.status, 200);
  const conflict = await request("/api/auth/login", { method: "POST", body: { token: secondInvitation.token } });
  assert.equal(conflict.response.status, 409);
  assert.equal((await request("/api/session", { cookie: firstCookie })).response.status, 401);

  const listed = await request("/api/admin/tokens", { cookie: adminCookie });
  const revoked = listed.data.items.find((item) => item.id === issued.item.id);
  assert.equal(revoked.status, "revoked");
  assert.equal(listed.data.items.find((item) => item.id === secondInvitation.item.id).status, "revoked");
  const replacement = await issueToken({ label: "Replacement", accountId: issued.item.accountId });
  const relogin = await request("/api/auth/login", { method: "POST", body: { token: replacement.token } });
  assert.equal(relogin.response.status, 200, JSON.stringify(relogin.data));
  const newCookie = cookieFrom(relogin.response, "nj_session");
  const sessionId = app.db.prepare("SELECT id FROM sessions WHERE principal = 'user' AND account_id = ?").get(replacement.item.accountId).id;
  const terminate = await request(`/api/admin/sessions/${sessionId}/terminate`, {
    method: "POST", cookie: adminCookie, csrf: adminCsrf, body: {},
  });
  assert.equal(terminate.response.status, 200);
  assert.equal((await request("/api/session", { cookie: newCookie })).response.status, 401);
});

test("feature grants are enforced and the administrator can revoke and audit access", async () => {
  const issued = await issueToken({ label: "Browse only", features: [], permissions: ["browse"] });
  const login = await request("/api/auth/login", { method: "POST", body: { token: issued.token } });
  const cookie = cookieFrom(login.response, "nj_session");
  const chatDenied = await request("/api/ai/chat", {
    method: "POST", cookie, csrf: login.data.csrf, body: { messages: [{ role: "user", content: "Hello" }] },
  });
  assert.equal(chatDenied.response.status, 403);
  assert.equal(chatDenied.data.code, "permission_denied");
  const result = await request("/api/settings", { cookie });
  assert.equal(result.response.status, 403);
  const summary = await request("/api/admin/summary", { cookie: adminCookie });
  assert.equal(summary.response.status, 200);
  assert.ok(summary.data.localAi);
  const audit = await request("/api/admin/audit?limit=100", { cookie: adminCookie });
  assert.ok(audit.data.items.some((item) => item.action === "token.concurrent_use"));
});

test("owner CLI creates one-time invitations and revokes their active session", async () => {
  const created = await runAdminCommand([
    "tokens", "create", "--label", "CLI limited", "--account-label", "CLI account",
    "--uses", "1", "--permissions", "browse,bookmarks", "--features", "bookmarks",
  ], { databasePath: join(tempDirectory, "nightjar.sqlite") });
  assert.equal(created.type, "created");
  assert.equal(created.usageLimit, 1);
  assert.deepEqual(created.permissions, ["browse", "bookmarks"]);
  assert.deepEqual(created.features, ["bookmarks"]);
  assert.ok(!app.db.prepare("SELECT token_hash FROM tokens WHERE id = ?").get(created.id).token_hash.includes(created.token));
  const login = await request("/api/auth/login", { method: "POST", body: { token: created.token } });
  assert.equal(login.response.status, 200);
  const cookie = cookieFrom(login.response, "nj_session");
  const revoked = await runAdminCommand(["tokens", "revoke", created.id], { databasePath: join(tempDirectory, "nightjar.sqlite") });
  assert.equal(revoked.type, "revoked");
  assert.equal((await request("/api/session", { cookie })).response.status, 401);
  const listed = await runAdminCommand(["tokens", "list"], { databasePath: join(tempDirectory, "nightjar.sqlite") });
  assert.equal(listed.items.find((item) => item.id === created.id).status, "revoked");
});

test("supports named ranks and concise single-use renewal commands", async () => {
  const ranks = await runAdminCommand(["ranks"], { databasePath: join(tempDirectory, "nightjar.sqlite") });
  const withAi = ranks.items.find((rank) => rank.id === "with-ai");
  const withoutAi = ranks.items.find((rank) => rank.id === "without-ai");
  assert.ok(withAi && withoutAi);
  assert.ok(withAi.features.includes("assistant"));
  assert.ok(withAi.permissions.includes("assistant"));
  assert.ok(!withoutAi.features.includes("assistant"));
  assert.ok(!withoutAi.permissions.includes("assistant"));
  const noAiToken = await runAdminCommand(["token", "make", "No AI invite", "without-ai"], {
    databasePath: join(tempDirectory, "nightjar.sqlite"),
  });
  const aiToken = await runAdminCommand(["token", "make", "AI invite", "with-ai"], {
    databasePath: join(tempDirectory, "nightjar.sqlite"),
  });
  assert.ok(!noAiToken.features.includes("assistant"));
  assert.ok(aiToken.features.includes("assistant"));
  const made = await runAdminCommand(["token", "make", "One person", "basic"], {
    databasePath: join(tempDirectory, "nightjar.sqlite"),
  });
  assert.equal(made.type, "created");
  assert.equal(made.rank, "basic");
  assert.deepEqual(made.permissions, ["browse", "support"]);
  const renewal = await runAdminCommand(["token", "renew", made.accountId, "Replacement", "full"], {
    databasePath: join(tempDirectory, "nightjar.sqlite"),
  });
  assert.equal(renewal.type, "created");
  assert.equal(renewal.rank, "full");
  assert.equal(renewal.usageLimit, 1);
  const custom = await runAdminCommand(["ranks", "create", "Study group", "--permissions", "browse,games,support", "--features", "games,support"], {
    databasePath: join(tempDirectory, "nightjar.sqlite"),
  });
  assert.equal(custom.id, "study-group");
  const customToken = await runAdminCommand(["token", "make", "Classroom", custom.id], {
    databasePath: join(tempDirectory, "nightjar.sqlite"),
  });
  assert.equal(customToken.rank, custom.id);
  assert.deepEqual(customToken.features, ["games", "support"]);
  const removed = await runAdminCommand(["ranks", "delete", custom.id], { databasePath: join(tempDirectory, "nightjar.sqlite") });
  assert.equal(removed.type, "rank-deleted");
  const preserved = await runAdminCommand(["token", "renew", customToken.accountId, "Classroom replacement"], {
    databasePath: join(tempDirectory, "nightjar.sqlite"),
  });
  assert.equal(preserved.rank, custom.id);
  assert.deepEqual(preserved.permissions, customToken.permissions);
  assert.deepEqual(preserved.features, customToken.features);
  assert.equal((await runAdminCommand(["tokens"], { databasePath: join(tempDirectory, "nightjar.sqlite") })).type, "tokens");
  assert.equal((await runAdminCommand(["accounts"], { databasePath: join(tempDirectory, "nightjar.sqlite") })).type, "accounts");
});

test("owner can manage ranks and review private support requests", async () => {
  const ranks = await request("/api/admin/ranks", { cookie: adminCookie });
  assert.equal(ranks.response.status, 200);
  assert.ok(ranks.data.items.some((rank) => rank.id === "basic"));
  const customRank = await request("/api/admin/ranks", {
    method: "POST", cookie: adminCookie, csrf: adminCsrf,
    body: { label: "Quiet reader", permissions: ["browse", "support"], features: ["support"] },
  });
  assert.equal(customRank.response.status, 201, JSON.stringify(customRank.data));
  assert.equal((await request(`/api/admin/ranks/${customRank.data.item.id}`, {
    method: "DELETE", cookie: adminCookie, csrf: adminCsrf,
  })).response.status, 200);

  const invitation = await issueToken({ label: "Feedback user", rank: "basic", permissions: ["browse", "support"], features: ["support"] });
  const login = await request("/api/auth/login", { method: "POST", body: { token: invitation.token } });
  const cookie = cookieFrom(login.response, "nj_session");
  const message = await request("/api/feedback", {
    method: "POST", cookie, csrf: login.data.csrf,
    body: { kind: "suggestion", subject: "A calmer new-tab page", message: "Could we add a compact option for the start page?" },
  });
  assert.equal(message.response.status, 201, JSON.stringify(message.data));
  const inbox = await request("/api/admin/feedback?limit=20", { cookie: adminCookie });
  assert.equal(inbox.response.status, 200);
  assert.ok(inbox.data.items.some((item) => item.id === message.data.id));
  const status = await request(`/api/admin/feedback/${message.data.id}`, {
    method: "PATCH", cookie: adminCookie, csrf: adminCsrf, body: { status: "in_progress" },
  });
  assert.equal(status.response.status, 200);
  const denied = await request("/api/admin/feedback", { cookie });
  assert.equal(denied.response.status, 401);
});

test("owner account and site controls are enforced server-side", async () => {
  assert.equal((await request("/api/admin/site-controls")).response.status, 401);
  assert.equal((await request("/api/admin/desktop/ticket", { method: "POST", body: {} })).response.status, 401);
  const desktopTicket = await request("/api/admin/desktop/ticket", {
    method: "POST", cookie: adminCookie, csrf: adminCsrf, body: {},
  });
  assert.equal(desktopTicket.response.status, 200);
  const [ticketPayload, ticketSignature] = desktopTicket.data.ticket.split(".");
  assert.equal(ticketSignature, createHmac("sha256", "a".repeat(64)).update(ticketPayload).digest("base64url"));
  const ticketClaims = JSON.parse(Buffer.from(ticketPayload, "base64url").toString("utf8"));
  assert.equal(ticketClaims.audience, "nightjar-linux-companion");
  assert.ok(ticketClaims.expiresAt > Date.now());
  const userInvite = await issueToken({ label: "Managed account", rank: "full" });
  const assistantInvite = await issueToken({ label: "AI control account", rank: "full" });
  const userLogin = await request("/api/auth/login", { method: "POST", body: { token: userInvite.token } });
  const userCookie = cookieFrom(userLogin.response, "nj_session");
  const assistantLogin = await request("/api/auth/login", { method: "POST", body: { token: assistantInvite.token } });
  const assistantCookie = cookieFrom(assistantLogin.response, "nj_session");

  const currentAccounts = await request("/api/admin/accounts", { cookie: adminCookie });
  const account = currentAccounts.data.items.find((item) => item.id === userInvite.item.accountId);
  const update = await request(`/api/admin/accounts/${account.id}`, {
    method: "PATCH", cookie: adminCookie, csrf: adminCsrf,
    body: {
      label: "Managed reader",
      rank: "standard",
      permissions: ["browse", "bookmarks"],
      features: ["bookmarks"],
      settings: account.settings,
    },
  });
  assert.equal(update.response.status, 200, JSON.stringify(update.data));
  assert.equal(update.data.sessionsTerminated, 1);
  assert.equal((await request("/api/session", { cookie: userCookie })).response.status, 401);
  const edited = (await request("/api/admin/accounts", { cookie: adminCookie })).data.items.find((item) => item.id === account.id);
  assert.equal(edited.label, "Managed reader");
  assert.deepEqual(edited.permissions, ["browse", "bookmarks"]);

  const defaults = await request("/api/admin/site-controls", { cookie: adminCookie });
  assert.equal(defaults.response.status, 200);
  const disabled = await request("/api/admin/site-controls", {
    method: "PATCH", cookie: adminCookie, csrf: adminCsrf,
    body: { maintenanceMode: false, invitationsEnabled: false, assistantEnabled: false },
  });
  assert.equal(disabled.response.status, 200);
  const createBlocked = await request("/api/admin/tokens", {
    method: "POST", cookie: adminCookie, csrf: adminCsrf, body: { label: "Blocked invite" },
  });
  assert.equal(createBlocked.response.status, 423);
  await assert.rejects(runAdminCommand(["token", "make", "Blocked invite", "basic"], {
    databasePath: join(tempDirectory, "nightjar.sqlite"),
  }), /Invitation creation is disabled/);
  const aiBlocked = await request("/api/ai/chat", {
    method: "POST", cookie: assistantCookie, csrf: assistantLogin.data.csrf,
    body: { messages: [{ role: "user", content: "hello" }] },
  });
  assert.equal(aiBlocked.response.status, 403);
  assert.equal(aiBlocked.data.code, "assistant_disabled");

  const maintenance = await request("/api/admin/site-controls", {
    method: "PATCH", cookie: adminCookie, csrf: adminCsrf,
    body: { maintenanceMode: true, invitationsEnabled: false, assistantEnabled: false },
  });
  assert.equal(maintenance.response.status, 200);
  assert.equal((await request("/api/session", { cookie: assistantCookie })).response.status, 503);
  assert.equal((await request("/api/admin/summary", { cookie: adminCookie })).response.status, 200);
  const restored = await request("/api/admin/site-controls", {
    method: "PATCH", cookie: adminCookie, csrf: adminCsrf,
    body: { maintenanceMode: false, invitationsEnabled: true, assistantEnabled: true },
  });
  assert.equal(restored.response.status, 200);
  const revoked = await request(`/api/admin/accounts/${account.id}/revoke`, {
    method: "POST", cookie: adminCookie, csrf: adminCsrf, body: {},
  });
  assert.equal(revoked.response.status, 200);
  const revokedAccount = (await request("/api/admin/accounts", { cookie: adminCookie })).data.items.find((item) => item.id === account.id);
  assert.ok(revokedAccount.revokedAt);
});

test("optional TOTP is required for the owner console when configured", async () => {
  const path = await mkdtemp(join(tmpdir(), "nightjar-totp-test-"));
  const secret = "JBSWY3DPEHPK3PXP";
  let totpApp;
  try {
    totpApp = await createApp({
      databasePath: join(path, "nightjar.sqlite"),
      adminPassword: password,
      totpSecret: secret,
      aiAutostart: false,
      ollamaFetch,
    });
    await new Promise((resolve) => totpApp.server.listen(0, "127.0.0.1", resolve));
    const address = `http://127.0.0.1:${totpApp.server.address().port}`;
    const noCode = await fetch(`${address}/api/admin/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    assert.equal(noCode.status, 401);

    let bits = "";
    for (const char of secret) bits += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(char).toString(2).padStart(5, "0");
    const key = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
    const counter = Math.floor(Date.now() / 30_000);
    const message = Buffer.alloc(8);
    message.writeBigUInt64BE(BigInt(counter));
    const digest = createHmac("sha1", key).update(message).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const code = ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
    const accepted = await fetch(`${address}/api/admin/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, totp: code }),
    });
    assert.equal(accepted.status, 200);
    const adminStatus = await fetch(`${address}/api/admin/me`, { headers: { Cookie: cookieFrom(accepted, "nj_admin") } });
    assert.equal((await adminStatus.json()).twoFactorEnabled, true);
  } finally {
    if (totpApp?.server.listening) await new Promise((resolve) => totpApp.server.close(resolve));
    totpApp?.stop();
    totpApp?.db.close();
    await rm(path, { recursive: true, force: true });
  }
});
