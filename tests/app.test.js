import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { createApp, isPublicAddress, restrictedLookup, runAdminCommand } from "../server.js";

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

async function issueToken({ label, usageLimit = "", accountId = "", rank, friend = false, features = ["bookmarks", "history", "settings", "assistant"], permissions = ["browse", "bookmarks", "history", "settings", "assistant"] } = {}) {
  const { response, data } = await request("/api/admin/tokens", {
    method: "POST", cookie: adminCookie, csrf: adminCsrf,
    body: {
      label: label ?? `Test ${Date.now()}`,
      accountLabel: label ?? "Test Account",
      accountId,
      rank,
      friend,
      usageLimit,
      permissions,
      features,
    },
  });
  assert.equal(response.status, 201, JSON.stringify(data));
  return data;
}

async function issuePresetToken(rank) {
  const label = `Preset ${rank} ${Date.now()}`;
  const { response, data } = await request("/api/admin/tokens", {
    method: "POST",
    cookie: adminCookie,
    csrf: adminCsrf,
    body: { label, accountLabel: label, rank },
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
    dashboardOrigins: ["https://dashboard.example"],
    userLoginLimit: 100,
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
  assert.match(appScript, /function openProjectAreaDialog/);
  assert.match(appScript, /toolbarOrder/);
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
  assert.match(adminHtml, /data-panel="friends"/);
  assert.match(adminHtml, /Add friend/);
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
  assert.match(directProxyHtml, /Rammerhead/);
  assert.doesNotMatch(directProxyHtml, /scramjet|baremux|epoxy/i);
  const proxyClient = await fetch(`${proxyOrigin}/dist/proxy-shell.js`);
  assert.equal(proxyClient.status, 200);
  const proxyClientScript = await proxyClient.text();
  assert.match(proxyClientScript, /standalone-shell/);
  assert.match(proxyClientScript, /Open Nightjar/);
  const unauthorizedEngineRequest = await fetch(`${proxyOrigin}/rammerhead.js`);
  assert.equal(unauthorizedEngineRequest.status, 403);
  const forbiddenProxyAsset = await fetch(`${proxyOrigin}/../server.js`);
  assert.equal(forbiddenProxyAsset.status, 403);
  const forbidden = await request("/api/admin/summary");
  assert.equal(forbidden.response.status, 401);
});

test("allows multiple independent owner sessions", async () => {
  const adminIndexes = app.db.prepare("PRAGMA index_list(sessions)").all();
  assert.ok(!adminIndexes.some((index) => index.name === "one_admin_session"));
  assert.ok(app.db.prepare("SELECT version FROM schema_migrations WHERE version = 6").get());
  assert.ok(app.db.prepare("SELECT version FROM schema_migrations WHERE version = 7").get());
  assert.ok(app.db.prepare("SELECT version FROM schema_migrations WHERE version = 8").get());

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
  assert.match(grant.data.sessionId, /^[a-f0-9]{32}$/i);
  const proxyPort = app.proxyServer.address().port;
  const proxiedPage = `${grant.data.proxyOrigin}/${grant.data.sessionId}/https://example.org/`;
  const blockedLoopback = await fetch(`${grant.data.proxyOrigin}/${grant.data.sessionId}/http://127.0.0.1:${proxyPort}/`);
  assert.equal(blockedLoopback.status, 403);
  const blockedPrivatePort = await fetch(`${grant.data.proxyOrigin}/${grant.data.sessionId}/http://example.org:8080/`);
  assert.equal(blockedPrivatePort.status, 403);
  const rammerheadScript = await fetch(`${grant.data.proxyOrigin}/rammerhead.js`, {
    headers: { Referer: proxiedPage },
  });
  assert.equal(rammerheadScript.status, 200);
  assert.match(rammerheadScript.headers.get("content-type"), /javascript/);
  const blockedSessionCreation = await fetch(`${grant.data.proxyOrigin}/newsession`, {
    headers: { Referer: proxiedPage },
  });
  assert.equal(blockedSessionCreation.status, 403);

  const adminOwnSession = await request("/api/admin/me", { cookie: adminCookie });
  assert.equal(adminOwnSession.response.status, 200, "separate admin and user cookies remain independent");
  const adminBlockedWithUserCookie = await request("/api/admin/summary", { cookie: userCookie });
  assert.equal(adminBlockedWithUserCookie.response.status, 403);
  const ownerApiBlockedWithUserCookie = await request("/api/owner/dashboard/tokens", {
    cookie: userCookie, origin: "https://dashboard.example",
  });
  assert.equal(ownerApiBlockedWithUserCookie.response.status, 403);
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

test("blocks Rammerhead outbound connections to private and reserved addresses", async () => {
  for (const address of [
    "0.0.0.0", "10.0.0.1", "127.0.0.1", "169.254.169.254", "192.168.1.1",
    "::", "::1", "fc00::1", "fe80::1", "2001:db8::1", "3fff::1",
    "::ffff:127.0.0.1", "::ffff:192.0.2.1",
  ]) {
    assert.equal(isPublicAddress(address), false, `${address} must not be proxyable`);
  }
  assert.equal(isPublicAddress("1.1.1.1"), true);
  assert.equal(isPublicAddress("2001:4860:4860::8888"), true);
  await new Promise((resolve, reject) => restrictedLookup("127.0.0.1", { all: true }, (error) => {
    if (error?.code === "EACCES") resolve();
    else reject(error ?? new Error("The loopback lookup was not rejected."));
  }));
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

test("provides the five built-in ranks and protects built-in presets", async () => {
  const ranks = await runAdminCommand(["ranks"], { databasePath: join(tempDirectory, "nightjar.sqlite") });
  const byId = new Map(ranks.items.map((rank) => [rank.id, rank]));
  assert.deepEqual(ranks.items.map(({ id }) => id), ["basic", "basic-plus", "ai", "full-minus", "owner"]);
  const cli = spawnSync(process.execPath, ["admin-cli.js", "ranks", "list"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, DATABASE_PATH: join(tempDirectory, "nightjar.sqlite") },
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(cli.stdout.trim().split("\n"), [
    "basic            Basic [browse, assistant] features=[assistant]",
    "basic-plus       Basic+ [browse, bookmarks, history, assistant] features=[bookmarks, history, assistant]",
    "ai               AI [browse, bookmarks, history, assistant] features=[bookmarks, history, assistant]",
    "full-minus       Full- [browse, bookmarks, history, settings, assistant] features=[bookmarks, history, settings, assistant]",
    "owner            Owner [browse, bookmarks, history, settings, assistant] features=[bookmarks, history, settings, assistant]",
  ]);
  assert.deepEqual(["basic", "basic-plus", "ai", "full-minus", "owner"].map((id) => byId.get(id)?.label), ["Basic", "Basic+", "AI", "Full-", "Owner"]);
  assert.deepEqual(byId.get("basic").permissions, ["browse", "assistant"]);
  assert.deepEqual(byId.get("basic").features, ["assistant"]);
  assert.deepEqual(byId.get("basic-plus").permissions, ["browse", "bookmarks", "history", "assistant"]);
  assert.deepEqual(byId.get("basic-plus").features, ["bookmarks", "history", "assistant"]);
  assert.deepEqual(byId.get("ai").permissions, ["browse", "bookmarks", "history", "assistant"]);
  assert.deepEqual(byId.get("ai").features, ["bookmarks", "history", "assistant"]);
  assert.ok(!byId.get("ai").features.includes("settings"));
  assert.deepEqual(byId.get("full-minus").permissions, ["browse", "bookmarks", "history", "settings", "assistant"]);
  assert.deepEqual(byId.get("full-minus").features, ["bookmarks", "history", "settings", "assistant"]);
  assert.deepEqual(byId.get("owner").permissions, byId.get("full-minus").permissions);
  assert.deepEqual(byId.get("owner").features, byId.get("full-minus").features);
  const basicToken = await runAdminCommand(["token", "make", "Basic invite", "basic"], {
    databasePath: join(tempDirectory, "nightjar.sqlite"),
  });
  assert.deepEqual(basicToken.features, ["assistant"]);
  const basicPlusToken = await runAdminCommand(["token", "make", "Basic plus invite", "basic-plus"], {
    databasePath: join(tempDirectory, "nightjar.sqlite"),
  });
  assert.deepEqual(basicPlusToken.features, ["bookmarks", "history", "assistant"]);
  const aiToken = await runAdminCommand(["token", "make", "AI invite", "ai"], {
    databasePath: join(tempDirectory, "nightjar.sqlite"),
  });
  assert.equal(aiToken.rank, "ai");
  const fullToken = await runAdminCommand(["token", "make", "Full invite", "full-minus"], {
    databasePath: join(tempDirectory, "nightjar.sqlite"),
  });
  const renewal = await runAdminCommand(["token", "renew", fullToken.accountId, "Replacement", "owner"], {
    databasePath: join(tempDirectory, "nightjar.sqlite"),
  });
  assert.equal(renewal.rank, "owner");
  assert.equal(renewal.usageLimit, 1);
  await assert.rejects(runAdminCommand(["ranks", "delete", "owner"], {
    databasePath: join(tempDirectory, "nightjar.sqlite"),
  }), /Built-in access ranks cannot be removed/);
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

test("upgrades stale built-in ranks and account grants from existing databases", async () => {
  const path = await mkdtemp(join(tmpdir(), "nightjar-rank-migration-"));
  let migrationApp;
  try {
    const databasePath = join(path, "nightjar.sqlite");
    migrationApp = await createApp({ databasePath, adminPassword: password, aiAutostart: false, ollamaFetch });
    migrationApp.stop();
    migrationApp.db.close();
    migrationApp = null;

    const legacyDb = new DatabaseSync(databasePath);
    legacyDb.exec("DELETE FROM schema_migrations WHERE version = 9; DELETE FROM ranks;");
    const staleRanks = [
      ["basic", "Basic", ["browse", "support"], ["support"]],
      ["standard", "Standard", ["browse", "bookmarks", "history"], ["bookmarks", "history"]],
      ["without-ai", "Without AI", ["browse", "bookmarks", "history"], ["bookmarks", "history"]],
      ["with-ai", "With AI", ["browse", "assistant"], ["assistant"]],
      ["full", "Full", ["browse", "games", "support"], ["games", "support"]],
      ["full-minus", "Full-", ["browse"], []],
      ["owner", "Owner", ["browse"], []],
      ["legacy-owner", "Legacy owner preset", ["browse", "assistant"], ["assistant"]],
    ];
    const insertRank = legacyDb.prepare("INSERT INTO ranks(id, label, permissions_json, features_json, created_at) VALUES (?, ?, ?, ?, ?)");
    const insertAccount = legacyDb.prepare(`INSERT INTO accounts(id, label, settings_json, permissions_json, features_json, rank, created_at)
      VALUES (?, ?, '{}', ?, ?, ?, ?)`);
    const insertToken = legacyDb.prepare(`INSERT INTO tokens(id, account_id, token_hash, label, permissions_json, rank, usage_limit, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)`);
    const now = new Date().toISOString();
    staleRanks.forEach(([id, label, permissions, features], index) => {
      insertRank.run(id, label, JSON.stringify(permissions), JSON.stringify(features), now);
      if (["standard", "without-ai", "with-ai", "full", "legacy-owner"].includes(id)) {
        const accountId = `legacy-account-${index}`;
        const tokenId = `legacy-token-${index}`;
        insertAccount.run(accountId, label, JSON.stringify(permissions), JSON.stringify(features), id, now);
        insertToken.run(tokenId, accountId, `hash-${index}`, label, JSON.stringify(permissions), id, now);
      }
    });
    legacyDb.close();

    migrationApp = await createApp({ databasePath, adminPassword: password, aiAutostart: false, ollamaFetch });
    assert.ok(migrationApp.db.prepare("SELECT version FROM schema_migrations WHERE version = 9").get());
    const ranks = await runAdminCommand(["ranks"], { databasePath });
    assert.deepEqual(ranks.items.map(({ id }) => id), ["basic", "basic-plus", "ai", "full-minus", "owner"]);
    assert.deepEqual(ranks.items[0].permissions, ["browse", "assistant"]);
    assert.deepEqual(ranks.items[3].features, ["bookmarks", "history", "settings", "assistant"]);
    const migrated = migrationApp.db.prepare(`SELECT a.rank, a.permissions_json, a.features_json, t.rank AS token_rank, t.permissions_json AS token_permissions
      FROM accounts a JOIN tokens t ON t.account_id = a.id ORDER BY a.id`).all();
    assert.deepEqual(migrated.map(({ rank, token_rank }) => [rank, token_rank]), [
      ["basic-plus", "basic-plus"],
      ["basic-plus", "basic-plus"],
      ["ai", "ai"],
      ["full-minus", "full-minus"],
      ["full-minus", "full-minus"],
    ]);
    assert.deepEqual(JSON.parse(migrated[0].permissions_json), ["browse", "bookmarks", "history", "assistant"]);
    assert.deepEqual(JSON.parse(migrated[0].features_json), ["bookmarks", "history", "assistant"]);
    assert.deepEqual(JSON.parse(migrated[2].token_permissions), ["browse", "bookmarks", "history", "assistant"]);
  } finally {
    migrationApp?.stop();
    migrationApp?.db.close();
    await rm(path, { recursive: true, force: true });
  }
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
  assert.equal(denied.response.status, 403);
});

test("Owner rank is server-authorized and the token dashboard never exposes secrets", async () => {
  const unauthorized = await request("/api/owner/dashboard/tokens", { origin: "https://dashboard.example" });
  assert.equal(unauthorized.response.status, 401);
  assert.equal(unauthorized.response.headers.get("access-control-allow-origin"), "https://dashboard.example");
  assert.equal((await request("/api/owner/dashboard/tokens", { origin: "https://untrusted.example" })).response.status, 403);

  const invitation = await issueToken({ label: "Dashboard reader", rank: "basic-plus" });
  const regularLogin = await request("/api/auth/login", { method: "POST", body: { token: invitation.token } });
  const regularCookie = cookieFrom(regularLogin.response, "nj_session");
  assert.equal((await request("/api/admin/me", { cookie: regularCookie })).response.status, 403);
  assert.equal((await request("/api/owner/dashboard/tokens", {
    cookie: regularCookie, origin: "https://dashboard.example",
  })).response.status, 403);

  const ownerInvite = await issueToken({ label: "Owner dashboard", rank: "owner" });
  const ownerLogin = await request("/api/auth/login", { method: "POST", body: { token: ownerInvite.token } });
  const ownerCookie = cookieFrom(ownerLogin.response, "nj_session");
  assert.equal((await request("/api/admin/me", { cookie: ownerCookie })).response.status, 200);
  const dashboard = await request("/api/owner/dashboard/tokens", {
    cookie: ownerCookie, origin: "https://dashboard.example",
  });
  assert.equal(dashboard.response.status, 200, JSON.stringify(dashboard.data));
  assert.equal(dashboard.response.headers.get("access-control-allow-credentials"), "true");
  assert.equal(dashboard.data.summary.total, dashboard.data.tokens.length);
  const item = dashboard.data.tokens.find((token) => token.id === invitation.item.id);
  assert.deepEqual(Object.keys(item).sort(), [
    "aiLimit", "aiUsed", "createdAt", "expiresAt", "id", "limit", "rank", "revokedAt", "status", "tokenIdMasked", "used",
  ].sort());
  assert.equal(item.tokenIdMasked, `••••${item.id.slice(-6)}`);
  assert.equal(item.aiLimit, 20);
  assert.equal(item.status, "active");
  const serialized = JSON.stringify(dashboard.data);
  assert.ok(!serialized.includes(invitation.token));
  assert.ok(!serialized.includes(ownerInvite.token));
  assert.ok(!serialized.includes(app.db.prepare("SELECT token_hash FROM tokens WHERE id = ?").get(invitation.item.id).token_hash));

  const preflight = await fetch(`${baseUrl}/api/owner/dashboard/tokens`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://dashboard.example",
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-methods"), "GET, OPTIONS");
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://dashboard.example");
});

test("friends can be added one at a time without receiving admin access", async () => {
  assert.deepEqual((await request("/api/admin/friends", { cookie: adminCookie })).data.items, []);
  const friendInvite = await issueToken({ label: "Private friend", rank: "basic-plus", friend: true });
  const friendList = await request("/api/admin/friends", { cookie: adminCookie });
  assert.equal(friendList.response.status, 200);
  assert.equal(friendList.data.items.length, 1);
  assert.equal(friendList.data.items[0].id, friendInvite.item.accountId);
  const friendLogin = await request("/api/auth/login", { method: "POST", body: { token: friendInvite.token } });
  assert.equal(friendLogin.response.status, 200, JSON.stringify(friendLogin.data));
  const friendCookie = cookieFrom(friendLogin.response, "nj_session");
  assert.equal((await request("/api/admin/summary", { cookie: friendCookie })).response.status, 403);
  const removed = await request(`/api/admin/friends/${friendInvite.item.accountId}`, {
    method: "DELETE", cookie: adminCookie, csrf: adminCsrf,
  });
  assert.equal(removed.response.status, 200);
  assert.equal((await request("/api/admin/friends", { cookie: adminCookie })).data.items.length, 0);
  assert.equal((await request("/api/session", { cookie: friendCookie })).response.status, 200, "removing a friend entry must not revoke their account");
  assert.equal((await request(`/api/admin/friends/${friendInvite.item.accountId}`, {
    method: "DELETE", cookie: friendCookie, csrf: friendLogin.data.csrf,
  })).response.status, 403);
});

test("project areas are private to each signed-in account", async () => {
  const firstInvite = await issueToken({ label: "Alex" });
  const firstLogin = await request("/api/auth/login", { method: "POST", body: { token: firstInvite.token } });
  assert.equal(firstLogin.response.status, 200, JSON.stringify(firstLogin.data));
  const firstCookie = cookieFrom(firstLogin.response, "nj_session");
  const defaults = await request("/api/project-areas", { cookie: firstCookie });
  assert.deepEqual(defaults.data.items.map((area) => area.label).sort(), ["Alex's Proxy", "Alex's games"].sort());
  const created = await request("/api/project-areas", {
    method: "POST", cookie: firstCookie, csrf: firstLogin.data.csrf,
    body: { kind: "custom", name: "Research" },
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.data.item.label, "Alex's Research");

  const secondInvite = await issueToken({ label: "Morgan" });
  const secondLogin = await request("/api/auth/login", { method: "POST", body: { token: secondInvite.token } });
  assert.equal(secondLogin.response.status, 200, JSON.stringify(secondLogin.data));
  const secondCookie = cookieFrom(secondLogin.response, "nj_session");
  assert.deepEqual((await request("/api/project-areas", { cookie: secondCookie })).data.items.map((area) => area.label).sort(), ["Morgan's Proxy", "Morgan's games"].sort());
  assert.equal((await request(`/api/project-areas/${created.data.item.id}`, {
    method: "DELETE", cookie: secondCookie, csrf: secondLogin.data.csrf,
  })).response.status, 404);
  const renamed = await request(`/api/project-areas/${created.data.item.id}`, {
    method: "PATCH", cookie: firstCookie, csrf: firstLogin.data.csrf, body: { name: "Writing" },
  });
  assert.equal(renamed.response.status, 200);
  assert.equal(renamed.data.item.label, "Alex's Writing");
});

test("Basic AI quota is token-scoped and Full- customization is permission-gated", async () => {
  const basic = await issueToken({ label: "Basic AI quota", rank: "basic", permissions: ["browse", "assistant"], features: ["assistant"] });
  const basicLogin = await request("/api/auth/login", { method: "POST", body: { token: basic.token } });
  assert.equal(basicLogin.response.status, 200, JSON.stringify(basicLogin.data));
  const basicCookie = cookieFrom(basicLogin.response, "nj_session");
  app.db.prepare("UPDATE tokens SET ai_usage_count = 20 WHERE id = ?").run(basic.item.id);
  const exhausted = await request("/api/capabilities", { cookie: basicCookie });
  assert.equal(exhausted.data.ai.allowed, false);
  assert.deepEqual(exhausted.data.ai.usage, { limit: 20, used: 20, remaining: 0 });
  const blocked = await request("/api/ai/chat", {
    method: "POST", cookie: basicCookie, csrf: basicLogin.data.csrf,
    body: { messages: [{ role: "user", content: "one more" }] },
  });
  assert.equal(blocked.response.status, 429);
  assert.equal(blocked.data.code, "ai_quota_exhausted");

  const ai = await issueToken({ label: "Unlimited AI", rank: "ai", permissions: ["browse", "bookmarks", "history", "assistant"], features: ["bookmarks", "history", "assistant"] });
  const aiLogin = await request("/api/auth/login", { method: "POST", body: { token: ai.token } });
  assert.equal(aiLogin.response.status, 200, JSON.stringify(aiLogin.data));
  const aiCookie = cookieFrom(aiLogin.response, "nj_session");
  app.db.prepare("UPDATE tokens SET ai_usage_count = 999 WHERE id = ?").run(ai.item.id);
  const response = await request("/api/ai/chat", {
    method: "POST", cookie: aiCookie, csrf: aiLogin.data.csrf,
    body: { messages: [{ role: "user", content: "hello" }] },
  });
  assert.equal(response.response.status, 200);
  assert.match(response.data, /Hello /);
  assert.match(response.data, /from local\./);
  assert.equal(app.db.prepare("SELECT ai_usage_count FROM tokens WHERE id = ?").get(ai.item.id).ai_usage_count, 1000);

  const customOrder = ["admin-link", "help-open", "settings-open", "theme-toggle", "open-regular", "games-open", "assistant-open", "downloads-open", "history-open", "bookmarks-open"];
  const denied = await request("/api/settings", {
    method: "PUT", cookie: basicCookie, csrf: basicLogin.data.csrf,
    body: { settings: { ...basicLogin.data.account.settings, customTitle: "Not allowed", customIcon: "X", toolbarOrder: customOrder } },
  });
  assert.equal(denied.response.status, 403);
  const full = await issueToken({ label: "Customizable", rank: "full-minus" });
  const fullLogin = await request("/api/auth/login", { method: "POST", body: { token: full.token } });
  assert.equal(fullLogin.response.status, 200, JSON.stringify(fullLogin.data));
  const fullCookie = cookieFrom(fullLogin.response, "nj_session");
  const saved = await request("/api/settings", {
    method: "PUT", cookie: fullCookie, csrf: fullLogin.data.csrf,
    body: {
      settings: {
        ...fullLogin.data.account.settings,
        customTitle: "Alex Workspace",
        customIcon: "🌙",
        toolbarOrder: customOrder,
      },
    },
  });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.settings.customTitle, "Alex Workspace");
  assert.equal(saved.data.settings.customIcon, "🌙");
  assert.deepEqual(saved.data.settings.toolbarOrder, customOrder);
});

test("built-in rank capabilities and AI limits are enforced by the server", async () => {
  const expected = {
    basic: {
      permissions: ["browse", "assistant"],
      features: ["assistant"],
      aiLimit: 20,
      settings: false,
    },
    "basic-plus": {
      permissions: ["browse", "bookmarks", "history", "assistant"],
      features: ["bookmarks", "history", "assistant"],
      aiLimit: 20,
      settings: false,
    },
    ai: {
      permissions: ["browse", "bookmarks", "history", "assistant"],
      features: ["bookmarks", "history", "assistant"],
      aiLimit: null,
      settings: false,
    },
    "full-minus": {
      permissions: ["browse", "bookmarks", "history", "settings", "assistant"],
      features: ["bookmarks", "history", "settings", "assistant"],
      aiLimit: null,
      settings: true,
    },
    owner: {
      permissions: ["browse", "bookmarks", "history", "settings", "assistant"],
      features: ["bookmarks", "history", "settings", "assistant"],
      aiLimit: null,
      settings: true,
    },
  };
  for (const [rank, capabilities] of Object.entries(expected)) {
    const invitation = await issuePresetToken(rank);
    assert.deepEqual(invitation.item.permissions, capabilities.permissions);
    assert.equal(invitation.item.aiUsageLimit, capabilities.aiLimit);
    const login = await request("/api/auth/login", { method: "POST", body: { token: invitation.token } });
    assert.equal(login.response.status, 200, JSON.stringify(login.data));
    const cookie = cookieFrom(login.response, "nj_session");
    assert.equal(login.data.account.rank, rank);
    assert.deepEqual(login.data.account.permissions, capabilities.permissions);
    assert.deepEqual(login.data.account.features, capabilities.features);
    assert.equal((await request("/api/browser/resolve?q=nightjar", { cookie })).response.status, 200);
    assert.equal((await request("/api/bookmarks", { cookie })).response.status, capabilities.features.includes("bookmarks") ? 200 : 403);
    assert.equal((await request("/api/history", { cookie })).response.status, capabilities.features.includes("history") ? 200 : 403);
    assert.equal((await request("/api/settings", { cookie })).response.status, capabilities.settings ? 200 : 403);
    assert.equal((await request("/api/admin/me", { cookie })).response.status, rank === "owner" ? 200 : 403);
    const customOrder = ["admin-link", "help-open", "settings-open", "theme-toggle", "open-regular", "games-open", "assistant-open", "downloads-open", "history-open", "bookmarks-open"];
    const settingsUpdate = await request("/api/settings", {
      method: "PUT",
      cookie,
      csrf: login.data.csrf,
      body: {
        settings: {
          ...login.data.account.settings,
          customTitle: "Rank Workspace",
          customIcon: "N",
          toolbarOrder: customOrder,
        },
      },
    });
    assert.equal(settingsUpdate.response.status, capabilities.settings ? 200 : 403);
    if (capabilities.settings) {
      assert.equal(settingsUpdate.data.settings.customTitle, "Rank Workspace");
      assert.equal(settingsUpdate.data.settings.customIcon, "N");
      assert.deepEqual(settingsUpdate.data.settings.toolbarOrder, customOrder);
    }

    app.db.prepare("UPDATE tokens SET ai_usage_count = ? WHERE id = ?")
      .run(capabilities.aiLimit === null ? 999 : capabilities.aiLimit, invitation.item.id);
    const capability = await request("/api/capabilities", { cookie });
    assert.equal(capability.data.ai.usage.limit, capabilities.aiLimit);
    assert.equal(capability.data.ai.usage.used, capabilities.aiLimit ?? 999);
    const chat = await request("/api/ai/chat", {
      method: "POST",
      cookie,
      csrf: login.data.csrf,
      body: { messages: [{ role: "user", content: `test ${rank}` }] },
    });
    if (capabilities.aiLimit === null) {
      assert.equal(chat.response.status, 200, JSON.stringify(chat.data));
      assert.equal(app.db.prepare("SELECT ai_usage_count FROM tokens WHERE id = ?").get(invitation.item.id).ai_usage_count, 1000);
    } else {
      assert.equal(chat.response.status, 429);
      assert.equal(chat.data.code, "ai_quota_exhausted");
    }
  }
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
  const userInvite = await issueToken({ label: "Managed account", rank: "full-minus" });
  const assistantInvite = await issueToken({ label: "AI control account", rank: "full-minus" });
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
      rank: "basic-plus",
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
