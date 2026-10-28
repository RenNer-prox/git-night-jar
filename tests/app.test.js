import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, createHmac } from "node:crypto";
import {
  createApp,
  isPublicAddress,
  restrictedLookup,
  runAdminCommand,
  withoutGeneratedMediaAttachment,
  withoutUnsupportedAcceptEncoding,
} from "../server.js";

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

async function request(path, { method = "GET", cookie, csrf, body, origin, host, authorization, extraHeaders = {} } = {}) {
  const headers = { ...extraHeaders };
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers["X-NJ-CSRF"] = csrf;
  if (authorization) headers.Authorization = authorization;
  if (origin) headers.Origin = origin;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(host ? `http://${host}${path}` : `${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = response.headers.get("content-type")?.includes("application/json")
    ? await response.json()
    : await response.text();
  return { response, data };
}

async function signIn(token, { origin, apiMode = false } = {}) {
  let result = await request("/api/auth/login", { method: "POST", origin, body: { token, apiMode } });
  if (result.data.code === "username_required") {
    result = await request("/api/auth/login", {
      method: "POST", origin,
      body: { token, apiMode, username: `test_${createHash("sha256").update(token).digest("hex").slice(0, 12)}` },
    });
  }
  return result;
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

before(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "nightjar-test-"));
  app = await createApp({
    databasePath: join(tempDirectory, "nightjar.sqlite"),
    proxyHost: "127.0.0.1",
    proxyPort: 0,
    gameHost: "127.0.0.1",
    gamePort: 0,
    appOrigin: "https://configured-ui.example",
    adminPassword: password,
    aiAutostart: false,
    desktopSecret: "a".repeat(64),
    userLoginLimit: 100,
    ollamaFetch,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
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
  app?.stop();
  app?.db.close();
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
});

test("serves the browser and keeps administrator routes isolated", async () => {
  const page = await fetch(`${baseUrl}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), new RegExp(`frame-src http://127\\.0\\.0\\.1:${app.proxyServer.address().port} http://127\\.0\\.0\\.1:${app.gameServer.address().port}`));
  assert.match(page.headers.get("content-security-policy"), /'self'/);
  assert.match(page.headers.get("content-security-policy"), /connect-src 'self' https:/);
  const pageHtml = await page.text();
  assert.match(pageHtml, /id="theme-toggle"/);
  assert.match(pageHtml, /allow="autoplay; encrypted-media; fullscreen; picture-in-picture;/);
  assert.equal((await fetch(`${baseUrl}/app.js`)).headers.get("access-control-allow-origin"), "*");
  assert.match(pageHtml, /id="help-open"/);
  assert.match(pageHtml, /id="home-games"/);
  assert.match(pageHtml, /id="home-social"/);
  assert.match(pageHtml, /id="invite-username"/);
  assert.match(pageHtml, /id="games-surface"/);
  assert.match(pageHtml, /id="game-frame"[^>]*sandbox="allow-scripts allow-forms allow-popups allow-pointer-lock allow-downloads"/);
  assert.match(pageHtml, /id="youtube-frame"[^>]*referrerpolicy="origin"/);
  assert.match(pageHtml, /Videos that block embedding can be opened on YouTube/);
  assert.match(pageHtml, /Open original YouTube page/);
  assert.match(page.headers.get("content-security-policy"), /https:\/\/www\.youtube\.com https:\/\/www\.youtube-nocookie\.com/);
  const client = await fetch(`${baseUrl}/app.js`);
  assert.equal(client.status, 200);
  assert.equal(client.headers.get("cache-control"), "no-store");
  const appScript = await client.text();
  assert.match(appScript, /function openHelp\(\)/);
  assert.match(appScript, /https:\/\/api\.bearstool\.com\/gamelinks/);
  assert.match(appScript, /fetch\(targetUrl, \{ signal: fetchAbortController\.signal \}\)/);
  assert.match(appScript, /let html = await response\.text\(\)/);
  assert.match(appScript, /function openGames\(\)/);
  assert.match(appScript, /function openSocial\(\)/);
  assert.match(appScript, /function refreshSocial\(\)/);
  assert.match(appScript, /function nightjarGameRoute\(address\)/);
  assert.match(appScript, /nightjar:\/\/games\/\$\{encodeURIComponent\(game.id\)\}/);
  assert.match(appScript, /postMessage\(\{ source: "nightjar-game-content", targetUrl, html \}, "\*"\)/);
  assert.match(appScript, /function youtubeVideoId\(address\)/);
  assert.match(appScript, /function showYoutubeVideo\(tab, address/);
  assert.match(appScript, /YouTube video · embedded player/);
  assert.match(appScript, /youtube-nocookie\.com\/embed/);
  const proxyShell = await fetch(`${baseUrl}/dist/proxy-shell.js`);
  assert.equal(proxyShell.status, 200);
  assert.match(await proxyShell.text(), /nightjar:youtube-navigate/);
  assert.match(appScript, /^function renderProjectAreas\(\)/m);
  assert.match(appScript, /^async function loadProjectAreas\(\)/m);
  assert.match(appScript, /function openQuickMathGame\(\)/);
  assert.match(appScript, /function openProjectAreaDialog/);
  assert.match(appScript, /toolbarOrder/);
  const styles = await fetch(`${baseUrl}/styles.css`);
  assert.equal(styles.status, 200);
  const stylesheet = await styles.text();
  assert.match(stylesheet, /\.game-catalog-card/);
  assert.match(stylesheet, /\.social-layout/);
  assert.equal(app.server, app.proxyServer);
  assert.equal(app.server, app.gameServer);
  const gameOrigin = baseUrl;
  const gamePlayer = await fetch(`${gameOrigin}/games-player.html?appOrigin=${encodeURIComponent(baseUrl)}`);
  assert.equal(gamePlayer.status, 200);
  assert.equal(gamePlayer.headers.get("x-frame-options"), null);
  assert.match(gamePlayer.headers.get("content-security-policy"), new RegExp(`frame-ancestors ${baseUrl.replaceAll(".", "\\.")}`));
  const rejectedGameParent = await fetch(`${gameOrigin}/games-player.html?appOrigin=${encodeURIComponent("https://attacker.example")}`);
  assert.equal(rejectedGameParent.status, 403);
  const gamePlayerHtml = await gamePlayer.text();
  assert.match(gamePlayerHtml, /if \(!\/<base/);
  assert.match(gamePlayerHtml, /targetUrl\.href\.slice\(0, targetUrl\.href\.lastIndexOf\("\/"\) \+ 1\)/);
  assert.match(gamePlayerHtml, /document\.open\(\)[\s\S]*document\.write\(html\)[\s\S]*document\.close\(\)/);
  const adminPage = await fetch(`${baseUrl}/admin`);
  assert.equal(adminPage.status, 200);
  const adminCsp = adminPage.headers.get("content-security-policy");
  assert.match(adminCsp, /img-src 'self' data: https: blob:/);
  assert.match(adminCsp, /connect-src 'self' https: http:\/\/127\.0\.0\.1:4175/);
  const adminHtml = await adminPage.text();
  assert.match(adminHtml, /Administrator sign-in/);
  assert.match(adminHtml, /Pair this owner session/);
  assert.match(adminHtml, /data-panel="friends"/);
  assert.match(adminHtml, /Add friend/);
  assert.match(adminHtml, /owner session and CSRF protection/);
  assert.doesNotMatch(adminHtml, /desktop-pair-code|one-time code shown in companion terminal/);
  const proxyOrigin = `http://127.0.0.1:${app.proxyServer.address().port}`;
  const proxyPage = await fetch(`${proxyOrigin}/proxy-shell.html`);
  assert.equal(proxyPage.status, 200);
  assert.match(await proxyPage.text(), /browsing engine/);
  const embeddedProxyPage = await fetch(`${proxyOrigin}/proxy-shell.html?appOrigin=${encodeURIComponent(baseUrl)}`);
  assert.equal(embeddedProxyPage.status, 200);
  assert.match(embeddedProxyPage.headers.get("content-security-policy"), new RegExp(`frame-ancestors ${baseUrl.replaceAll(".", "\\.")}`));
  const cloudflareOrigin = `https://127.0.0.1:${app.server.address().port}`;
  const cloudflareProxyPage = await fetch(`${baseUrl}/proxy-shell.html?appOrigin=${encodeURIComponent(cloudflareOrigin)}`, {
    headers: { "CF-Visitor": JSON.stringify({ scheme: "https" }) },
  });
  assert.equal(cloudflareProxyPage.status, 200, await cloudflareProxyPage.text());
  assert.match(cloudflareProxyPage.headers.get("content-security-policy"), new RegExp(`frame-ancestors ${cloudflareOrigin.replaceAll(".", "\\.")}`));
  const cloudflareGamePage = await fetch(`${baseUrl}/games-player.html?appOrigin=${encodeURIComponent(cloudflareOrigin)}`, {
    headers: { "CF-Visitor": JSON.stringify({ scheme: "https" }) },
  });
  assert.equal(cloudflareGamePage.status, 200);
  assert.match(cloudflareGamePage.headers.get("content-security-policy"), new RegExp(`frame-ancestors ${cloudflareOrigin.replaceAll(".", "\\.")}`));
  const rejectedProxyParent = await fetch(`${proxyOrigin}/proxy-shell.html?appOrigin=${encodeURIComponent("https://attacker.example")}`);
  assert.equal(rejectedProxyParent.status, 403);
  const directProxyShell = await fetch(`${proxyOrigin}/proxy-shell.html`);
  assert.equal(directProxyShell.status, 200);
  const directProxyHtml = await directProxyShell.text();
  assert.match(directProxyHtml, /browsing engine/);
  assert.match(directProxyHtml, /Rammerhead/);
  assert.doesNotMatch(directProxyHtml, /scramjet|baremux|epoxy/i);
  const proxyClient = await fetch(`${proxyOrigin}/dist/proxy-shell.js`);
  assert.equal(proxyClient.status, 200);
  assert.equal(proxyClient.headers.get("cache-control"), "no-store");
  const proxyClientScript = await proxyClient.text();
  assert.match(proxyClientScript, /standalone-shell/);
  assert.match(proxyClientScript, /Open Nightjar/);
  assert.match(proxyClientScript, /function handleSpecialNavigationClick/);
  assert.match(proxyClientScript, /window\.open\(proxiedUrl\(destination\.href\), "_blank"\)/);
  assert.match(proxyClientScript, /nightjar:youtube-navigate/);
  const unauthorizedEngineRequest = await fetch(`${proxyOrigin}/rammerhead.js`);
  assert.equal(unauthorizedEngineRequest.status, 403);
  const forbiddenProxyAsset = await fetch(`${proxyOrigin}/../server.js`);
  assert.equal(forbiddenProxyAsset.status, 404);
  const forbidden = await request("/api/admin/summary");
  assert.equal(forbidden.response.status, 401);
  const alternateHostPage = await fetch(`http://localhost:${app.server.address().port}/`);
  assert.match(
    alternateHostPage.headers.get("content-security-policy"),
    new RegExp(`frame-src http://localhost:${app.proxyServer.address().port}`),
  );
});

test("allows multiple independent owner sessions", async () => {
  const adminIndexes = app.db.prepare("PRAGMA index_list(sessions)").all();
  assert.ok(!adminIndexes.some((index) => index.name === "one_admin_session"));
  assert.ok(app.db.prepare("SELECT version FROM schema_migrations WHERE version = 6").get());
  assert.ok(app.db.prepare("SELECT version FROM schema_migrations WHERE version = 7").get());
  assert.ok(app.db.prepare("SELECT version FROM schema_migrations WHERE version = 8").get());
  assert.ok(app.db.prepare("SELECT version FROM schema_migrations WHERE version = 9").get());

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
  const login = await signIn(issued.token);
  assert.equal(login.response.status, 200, JSON.stringify(login.data));
  assert.match(login.response.headers.get("set-cookie"), /HttpOnly/);
  assert.match(login.response.headers.get("set-cookie"), /SameSite=Strict/);
  assert.match(login.response.headers.get("set-cookie"), /Max-Age=7776000/);
  const userCookie = cookieFrom(login.response, "nj_session");
  const userCsrf = login.data.csrf;
  assert.equal(login.data.account.label, "Research account");
  const stolenInvitation = await request("/api/auth/login", { method: "POST", body: { token: issued.token } });
  assert.equal(stolenInvitation.response.status, 401);
  assert.equal(stolenInvitation.data.code, "usage_limit_reached");
  const sessionRow = app.db.prepare("SELECT id FROM sessions WHERE account_id = ? AND principal = 'user'").get(issued.item.accountId);
  app.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 2 * 60_000).toISOString(), sessionRow.id);
  const refreshedSession = await request("/api/session", { cookie: userCookie });
  assert.equal(refreshedSession.response.status, 200, "an active cookie session should remain valid");
  assert.match(refreshedSession.response.headers.get("set-cookie"), /Max-Age=7776000/);
  const refreshedExpiry = app.db.prepare("SELECT expires_at FROM sessions WHERE id = ?").get(sessionRow.id).expires_at;
  assert.ok(Date.parse(refreshedExpiry) > Date.now() + 89 * 24 * 60 * 60 * 1000);
  const tokenList = await request("/api/admin/tokens", { cookie: adminCookie });
  assert.equal(tokenList.data.items.find((item) => item.id === issued.item.id).status, "redeemed");
  const grant = await request("/api/browser/grant", {
    method: "POST", cookie: userCookie, csrf: userCsrf, body: {}, origin: baseUrl,
  });
  assert.equal(grant.response.status, 200, JSON.stringify(grant.data));
  assert.equal(grant.data.proxyOrigin, `http://127.0.0.1:${app.proxyServer.address().port}`);
  assert.equal(grant.data.gameOrigin, `http://127.0.0.1:${app.gameServer.address().port}`);
  assert.match(grant.data.sessionId, /^[a-f0-9]{32}$/i);
  const cloudflareConfig = await request("/api/browser/config", {
    cookie: userCookie,
    extraHeaders: { "CF-Visitor": JSON.stringify({ scheme: "https" }) },
  });
  assert.equal(cloudflareConfig.response.status, 200);
  assert.equal(cloudflareConfig.data.proxyOrigin, `https://127.0.0.1:${app.server.address().port}`);
  assert.equal(cloudflareConfig.data.gameOrigin, cloudflareConfig.data.proxyOrigin);
  const alternateOrigin = `http://localhost:${app.server.address().port}`;
  const alternateHostGrant = await request("/api/browser/grant", {
    method: "POST",
    cookie: userCookie,
    csrf: userCsrf,
    body: {},
    origin: alternateOrigin,
    host: `localhost:${app.server.address().port}`,
  });
  assert.equal(alternateHostGrant.response.status, 200, JSON.stringify(alternateHostGrant.data));
  assert.equal(alternateHostGrant.data.proxyOrigin, `http://localhost:${app.proxyServer.address().port}`);
  assert.equal(alternateHostGrant.data.gameOrigin, `http://localhost:${app.gameServer.address().port}`);
  const proxyPort = app.proxyServer.address().port;
  const proxiedPage = `${grant.data.proxyOrigin}/${grant.data.sessionId}/https://example.org/`;
  const blockedLoopback = await fetch(`${grant.data.proxyOrigin}/${grant.data.sessionId}/http://127.0.0.1:${proxyPort}/`);
  assert.equal(blockedLoopback.status, 403);
  const blockedLoopbackWithCharset = await fetch(`${grant.data.proxyOrigin}/${grant.data.sessionId}!s!utf-8/https://127.0.0.1/`);
  assert.equal(blockedLoopbackWithCharset.status, 403);
  const blockedPrivatePort = await fetch(`${grant.data.proxyOrigin}/${grant.data.sessionId}/http://example.org:8080/`);
  assert.equal(blockedPrivatePort.status, 403);
  const rammerheadScript = await fetch(`${grant.data.proxyOrigin}/rammerhead.js`, {
    headers: { Referer: proxiedPage },
  });
  assert.equal(rammerheadScript.status, 200);
  assert.match(rammerheadScript.headers.get("content-type"), /javascript/);
  const shuffleDictionary = await fetch(`${grant.data.proxyOrigin}/api/shuffleDict?id=${grant.data.sessionId}`, {
    headers: { Referer: proxiedPage },
  });
  assert.equal(shuffleDictionary.status, 200);
  const shuffleDictionaryText = await shuffleDictionary.text();
  assert.doesNotThrow(() => JSON.parse(shuffleDictionaryText));
  const disabledLocalStorageSync = await fetch(`${grant.data.proxyOrigin}/syncLocalStorage?sessionId=${grant.data.sessionId}&origin=${encodeURIComponent("https://example.org")}`, {
    method: "POST",
    headers: { Referer: proxiedPage, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "sync", fetch: true }),
  });
  assert.equal(disabledLocalStorageSync.status, 404);
  assert.match(await disabledLocalStorageSync.text(), /disabled localStorage sync/);
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
  const reuse = await signIn(issued.token);
  assert.equal(reuse.response.status, 401);
});

test("claims unique immutable usernames and restricts direct messages to accepted friends", async () => {
  const firstInvite = await issueToken({ label: "Social one" });
  const missingUsername = await request("/api/auth/login", { method: "POST", body: { token: firstInvite.token } });
  assert.equal(missingUsername.response.status, 409);
  assert.equal(missingUsername.data.code, "username_required");
  assert.equal(app.db.prepare("SELECT usage_count FROM tokens WHERE id = ?").get(firstInvite.item.id).usage_count, 0);

  const firstLogin = await request("/api/auth/login", {
    method: "POST", body: { token: firstInvite.token, username: "NightOwl" },
  });
  assert.equal(firstLogin.response.status, 200, JSON.stringify(firstLogin.data));
  assert.equal(firstLogin.data.account.username, "NightOwl");
  const firstCookie = cookieFrom(firstLogin.response, "nj_session");

  const collisionInvite = await issueToken({ label: "Collision" });
  const collision = await request("/api/auth/login", {
    method: "POST", body: { token: collisionInvite.token, username: "nightowl" },
  });
  assert.equal(collision.response.status, 409);
  assert.equal(collision.data.code, "username_taken");
  assert.equal(app.db.prepare("SELECT usage_count FROM tokens WHERE id = ?").get(collisionInvite.item.id).usage_count, 0);

  const secondInvite = await issueToken({ label: "Social two" });
  const secondLogin = await request("/api/auth/login", {
    method: "POST", body: { token: secondInvite.token, username: "day_owl" },
  });
  assert.equal(secondLogin.response.status, 200, JSON.stringify(secondLogin.data));
  const secondCookie = cookieFrom(secondLogin.response, "nj_session");
  const thirdInvite = await issueToken({ label: "Social three" });
  const thirdLogin = await signIn(thirdInvite.token);
  const thirdCookie = cookieFrom(thirdLogin.response, "nj_session");

  const requestWithoutCsrf = await request("/api/social/requests", {
    method: "POST", cookie: firstCookie, body: { username: "day_owl" },
  });
  assert.equal(requestWithoutCsrf.response.status, 403);
  const sendRequest = await request("/api/social/requests", {
    method: "POST", cookie: firstCookie, csrf: firstLogin.data.csrf, body: { username: "DAY_OWL" },
  });
  assert.equal(sendRequest.response.status, 201, JSON.stringify(sendRequest.data));

  const incoming = await request("/api/social", { cookie: secondCookie });
  assert.deepEqual(incoming.data.incoming.map(({ username }) => username), ["NightOwl"]);
  const prematureMessage = await request(`/api/social/friends/${firstInvite.item.accountId}/messages`, {
    method: "POST", cookie: secondCookie, csrf: secondLogin.data.csrf, body: { message: "Not yet" },
  });
  assert.equal(prematureMessage.response.status, 403);

  const accept = await request(`/api/social/requests/${sendRequest.data.id}`, {
    method: "POST", cookie: secondCookie, csrf: secondLogin.data.csrf,
  });
  assert.equal(accept.response.status, 200);
  const sentMessage = await request(`/api/social/friends/${secondInvite.item.accountId}/messages`, {
    method: "POST", cookie: firstCookie, csrf: firstLogin.data.csrf, body: { message: "Hello, friend." },
  });
  assert.equal(sentMessage.response.status, 201);
  const received = await request(`/api/social/friends/${firstInvite.item.accountId}/messages`, { cookie: secondCookie });
  assert.equal(received.data.messages.length, 1);
  assert.equal(received.data.messages[0].body, "Hello, friend.");
  assert.equal(received.data.messages[0].senderId, firstInvite.item.accountId);
  const privateMessages = await request(`/api/social/friends/${firstInvite.item.accountId}/messages`, { cookie: thirdCookie });
  assert.equal(privateMessages.response.status, 403);

  const remove = await request(`/api/social/friends/${secondInvite.item.accountId}`, {
    method: "DELETE", cookie: firstCookie, csrf: firstLogin.data.csrf,
  });
  assert.equal(remove.response.status, 200);
  const removedChat = await request(`/api/social/friends/${secondInvite.item.accountId}/messages`, { cookie: firstCookie });
  assert.equal(removedChat.response.status, 403);
  app.db.prepare("UPDATE accounts SET username = NULL WHERE id = ?").run(thirdInvite.item.accountId);
  const legacyClaim = await request("/api/account/username", {
    method: "POST", cookie: thirdCookie, csrf: thirdLogin.data.csrf, body: { username: "legacy_owl" },
  });
  assert.equal(legacyClaim.response.status, 200);
  assert.equal(legacyClaim.data.username, "legacy_owl");
  const changedUsername = await request("/api/account/username", {
    method: "POST", cookie: thirdCookie, csrf: thirdLogin.data.csrf, body: { username: "new_owl" },
  });
  assert.equal(changedUsername.response.status, 409);
  assert.equal(changedUsername.data.code, "username_immutable");
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

test("removes unsupported zstd negotiation from proxied requests", () => {
  assert.equal(withoutUnsupportedAcceptEncoding("gzip, deflate, br, zstd"), "gzip, deflate, br");
  assert.equal(withoutUnsupportedAcceptEncoding("zstd, gzip;q=0.8"), "gzip;q=0.8");
  assert.equal(withoutUnsupportedAcceptEncoding("zstd"), "identity");
  assert.equal(withoutUnsupportedAcceptEncoding(undefined), undefined);
});

test("keeps top-level audio and video inline unless the origin explicitly requests attachment", () => {
  assert.deepEqual(withoutGeneratedMediaAttachment([
    "content-type", "video/mp4",
    "content-disposition", "attachment;",
    "content-length", "1024",
  ]), ["content-type", "video/mp4", "content-length", "1024"]);
  assert.deepEqual(withoutGeneratedMediaAttachment({
    "Content-Type": "audio/mpeg; charset=binary",
    "Content-Disposition": "attachment;",
  }), { "Content-Type": "audio/mpeg; charset=binary" });
  assert.deepEqual(withoutGeneratedMediaAttachment({
    "content-type": "audio/mpeg",
    "content-disposition": "attachment; filename=track.mp3",
  }), {
    "content-type": "audio/mpeg",
    "content-disposition": "attachment; filename=track.mp3",
  });
  assert.deepEqual(withoutGeneratedMediaAttachment({
    "content-type": "application/pdf",
    "content-disposition": "attachment;",
  }), {
    "content-type": "application/pdf",
    "content-disposition": "attachment;",
  });
});

test("account sessions persist across sign-ins and can be individually revoked", async () => {
  const issued = await issueToken({ label: "Single session" });
  const secondInvitation = await issueToken({ label: "Second invite", accountId: issued.item.accountId });
  const firstLogin = await signIn(issued.token);
  assert.equal(firstLogin.response.status, 200);
  const firstCookie = cookieFrom(firstLogin.response, "nj_session");
  const spentToken = await signIn(issued.token);
  assert.equal(spentToken.response.status, 401);
  assert.equal((await request("/api/session", { cookie: firstCookie })).response.status, 200);
  const secondLogin = await signIn(secondInvitation.token);
  assert.equal(secondLogin.response.status, 200, JSON.stringify(secondLogin.data));
  const secondCookie = cookieFrom(secondLogin.response, "nj_session");
  assert.equal((await request("/api/session", { cookie: firstCookie })).response.status, 200);
  assert.equal((await request("/api/session", { cookie: secondCookie })).response.status, 200);

  const firstHash = createHash("sha256").update(firstCookie.slice("nj_session=".length)).digest("hex");
  const sessionId = app.db.prepare("SELECT id FROM sessions WHERE session_hash = ?").get(firstHash).id;
  const terminate = await request(`/api/admin/sessions/${sessionId}/terminate`, {
    method: "POST", cookie: adminCookie, csrf: adminCsrf, body: {},
  });
  assert.equal(terminate.response.status, 200);
  assert.equal((await request("/api/session", { cookie: firstCookie })).response.status, 401);
  assert.equal((await request("/api/session", { cookie: secondCookie })).response.status, 200);
  const listed = await request("/api/admin/tokens", { cookie: adminCookie });
  assert.equal(listed.data.items.find((item) => item.id === issued.item.id).status, "redeemed");
});

test("owners can renew single-use tokens without ending existing cookie sessions", async () => {
  const issued = await issueToken({ label: "Renewable invitation" });
  const login = await signIn(issued.token);
  const userCookie = cookieFrom(login.response, "nj_session");
  const renewed = await request(`/api/admin/tokens/${issued.item.id}/renew`, {
    method: "POST", cookie: adminCookie, csrf: adminCsrf, body: {},
  });
  assert.equal(renewed.response.status, 200, JSON.stringify(renewed.data));
  assert.notEqual(renewed.data.token, issued.token);
  assert.equal(renewed.data.item.status, "active");
  assert.equal((await request("/api/session", { cookie: userCookie })).response.status, 200);
  assert.equal((await request("/api/auth/login", { method: "POST", body: { token: issued.token } })).response.status, 401);
  const nextLogin = await signIn(renewed.data.token);
  assert.equal(nextLogin.response.status, 200);
  const nextCookie = cookieFrom(nextLogin.response, "nj_session");
  app.db.prepare("UPDATE tokens SET expires_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 1000).toISOString(), issued.item.id);
  assert.equal((await request("/api/session", { cookie: nextCookie })).response.status, 200);
  const proxyGrant = await request("/api/browser/grant", {
    method: "POST", cookie: nextCookie, csrf: nextLogin.data.csrf, origin: baseUrl, body: {},
  });
  assert.equal(proxyGrant.response.status, 200, "an established session remains authorized after invitation expiry");
});

test("feature grants are enforced and the administrator can revoke and audit access", async () => {
  const issued = await issueToken({ label: "Browse only", features: [], permissions: ["browse"] });
  const login = await signIn(issued.token);
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
  assert.ok(audit.data.items.some((item) => item.action === "session.created" && item.subject === issued.item.accountId));
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
  const login = await signIn(created.token);
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
  assert.deepEqual(["basic", "basic-plus", "ai", "full-minus", "owner"].map((id) => byId.get(id)?.label), ["Basic", "Basic+", "AI", "Full-", "Owner"]);
  assert.deepEqual(byId.get("basic").features, ["assistant", "games"]);
  assert.deepEqual(byId.get("basic-plus").features, ["bookmarks", "history", "assistant", "games"]);
  assert.deepEqual(byId.get("ai").features, ["bookmarks", "history", "assistant", "games"]);
  assert.ok(!byId.get("ai").features.includes("settings"));
  assert.ok(byId.get("full-minus").features.includes("settings"));
  assert.deepEqual(byId.get("owner").features, byId.get("full-minus").features);
  const basicToken = await runAdminCommand(["token", "make", "Basic invite", "basic"], {
    databasePath: join(tempDirectory, "nightjar.sqlite"),
  });
  assert.deepEqual(basicToken.features, ["assistant", "games"]);
  const basicPlusToken = await runAdminCommand(["token", "make", "Basic plus invite", "basic-plus"], {
    databasePath: join(tempDirectory, "nightjar.sqlite"),
  });
  assert.deepEqual(basicPlusToken.features, ["bookmarks", "history", "assistant", "games"]);
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
  const login = await signIn(invitation.token);
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
  assert.equal(unauthorized.response.headers.get("access-control-allow-origin"), "*");
  assert.equal((await request("/api/owner/dashboard/tokens", { origin: "https://untrusted.example" })).response.status, 401);

  const invitation = await issueToken({ label: "Dashboard reader", rank: "basic-plus" });
  const regularLogin = await signIn(invitation.token);
  const regularCookie = cookieFrom(regularLogin.response, "nj_session");
  assert.equal((await request("/api/admin/me", { cookie: regularCookie })).response.status, 403);
  assert.equal((await request("/api/owner/dashboard/tokens", {
    cookie: regularCookie, origin: "https://dashboard.example",
  })).response.status, 403);

  const ownerInvite = await issueToken({ label: "Owner dashboard", rank: "owner" });
  const ownerLogin = await signIn(ownerInvite.token);
  const ownerCookie = cookieFrom(ownerLogin.response, "nj_session");
  assert.equal((await request("/api/admin/me", { cookie: ownerCookie })).response.status, 200);
  const dashboard = await request("/api/owner/dashboard/tokens", {
    cookie: ownerCookie, origin: "https://dashboard.example",
  });
  assert.equal(dashboard.response.status, 200, JSON.stringify(dashboard.data));
  assert.equal(dashboard.response.headers.get("access-control-allow-origin"), "*");
  assert.equal(dashboard.response.headers.get("access-control-allow-credentials"), null);
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
      "Access-Control-Request-Headers": "authorization, content-type, x-nj-csrf",
    },
  });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get("access-control-allow-methods"), /DELETE/);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
  assert.match(preflight.headers.get("access-control-allow-headers"), /Authorization/i);
  assert.equal(preflight.headers.get("access-control-allow-credentials"), null);
});

test("API-mode bearer sessions work cross-origin without cookies and can be revoked", async () => {
  const origin = "https://static-ui.example";
  const invitation = await issueToken({ label: "API-mode user", rank: "basic-plus" });
  const login = await signIn(invitation.token, { origin, apiMode: true });
  assert.equal(login.response.status, 200, JSON.stringify(login.data));
  assert.equal(login.response.headers.get("access-control-allow-origin"), "*");
  assert.equal(login.response.headers.get("set-cookie"), null);
  assert.match(login.data.sessionToken, /^[A-Za-z0-9_-]{43}$/);
  const authorization = `Bearer ${login.data.sessionToken}`;

  const session = await request("/api/session", { authorization, origin });
  assert.equal(session.response.status, 200, JSON.stringify(session.data));
  assert.equal(session.response.headers.get("access-control-allow-origin"), "*");
  assert.equal(session.data.account.label, "API-mode user");
  assert.equal(session.response.headers.get("set-cookie"), null);
  const grant = await request("/api/browser/grant", {
    method: "POST", origin, authorization, csrf: session.data.csrf, body: {},
  });
  assert.equal(grant.response.status, 200, JSON.stringify(grant.data));
  assert.equal(grant.response.headers.get("access-control-allow-origin"), "*");
  assert.equal(grant.data.proxyOrigin, grant.data.gameOrigin);

  const logout = await request("/api/auth/logout", {
    method: "POST", origin, authorization, csrf: session.data.csrf, body: {},
  });
  assert.equal(logout.response.status, 200);
  assert.equal(logout.response.headers.get("set-cookie"), null);
  assert.equal((await request("/api/session", { authorization, origin })).response.status, 401);
});

test("API-mode administrator bearer sessions support owner-console operations and logout", async () => {
  const origin = "https://static-ui.example";
  const login = await request("/api/admin/login", {
    method: "POST", origin, body: { password, apiMode: true },
  });
  assert.equal(login.response.status, 200, JSON.stringify(login.data));
  assert.equal(login.response.headers.get("set-cookie"), null);
  const authorization = `Bearer ${login.data.sessionToken}`;
  const me = await request("/api/admin/me", { authorization, origin });
  assert.equal(me.response.status, 200, JSON.stringify(me.data));
  const dashboard = await request("/api/owner/dashboard/tokens", { authorization, origin });
  assert.equal(dashboard.response.status, 200, JSON.stringify(dashboard.data));
  assert.equal(dashboard.response.headers.get("access-control-allow-origin"), "*");
  const logout = await request("/api/admin/logout", {
    method: "POST", authorization, origin, csrf: me.data.csrf, body: {},
  });
  assert.equal(logout.response.status, 200);
  assert.equal((await request("/api/admin/me", { authorization, origin })).response.status, 401);
});

test("friends can be added one at a time without receiving admin access", async () => {
  assert.deepEqual((await request("/api/admin/friends", { cookie: adminCookie })).data.items, []);
  const friendInvite = await issueToken({ label: "Private friend", rank: "basic-plus", friend: true });
  const friendList = await request("/api/admin/friends", { cookie: adminCookie });
  assert.equal(friendList.response.status, 200);
  assert.equal(friendList.data.items.length, 1);
  assert.equal(friendList.data.items[0].id, friendInvite.item.accountId);
  const friendLogin = await signIn(friendInvite.token);
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
  const firstLogin = await signIn(firstInvite.token);
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
  const secondLogin = await signIn(secondInvite.token);
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
  const basicLogin = await signIn(basic.token);
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
  const aiLogin = await signIn(ai.token);
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
  const fullLogin = await signIn(full.token);
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
  const userLogin = await signIn(userInvite.token);
  const userCookie = cookieFrom(userLogin.response, "nj_session");
  const assistantLogin = await signIn(assistantInvite.token);
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
