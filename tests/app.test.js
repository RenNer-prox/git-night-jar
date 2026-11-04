import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, createHmac, randomBytes } from "node:crypto";
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

function desktopSignature(path, method, body = Buffer.alloc(0)) {
  const timestamp = String(Date.now());
  const nonce = randomBytes(24).toString("base64url");
  const digest = createHash("sha256").update(body).digest("hex");
  const message = `${method}\n${path}\n${timestamp}\n${nonce}\n${digest}`;
  const signature = createHmac("sha256", Buffer.from("a".repeat(64), "hex")).update(message).digest("hex");
  return {
    "X-NJ-Desktop-Timestamp": timestamp,
    "X-NJ-Desktop-Nonce": nonce,
    "X-NJ-Desktop-Signature": signature,
  };
}

async function signedDesktopRequest(path, { method = "GET", body = Buffer.alloc(0), headers = {} } = {}) {
  const signedHeaders = desktopSignature(path, method, body);
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...signedHeaders,
      ...headers,
      ...(body.length ? { "Content-Type": path.endsWith("/frame") ? "image/png" : "application/json" } : {}),
    },
    body: body.length ? body : undefined,
  });
  return response;
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
  assert.match(adminCsp, /connect-src 'self'/);
  const adminHtml = await adminPage.text();
  assert.match(adminHtml, /Administrator sign-in/);
  assert.match(adminHtml, /Pair this owner session/);
  assert.match(adminHtml, /Open one-time desktop tab/);
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

test("desktop viewer launches once and requires the issuing owner session", async () => {
  const anonymousTicket = await request("/api/admin/desktop/viewer-ticket", { method: "POST", body: {} });
  assert.equal(anonymousTicket.response.status, 401);

  const invited = await issueToken({ label: "Desktop viewer non-owner" });
  const userLogin = await request("/api/auth/login", { method: "POST", body: { token: invited.token } });
  const userCookie = cookieFrom(userLogin.response, "nj_session");
  const nonOwnerTicket = await request("/api/admin/desktop/viewer-ticket", {
    method: "POST", cookie: userCookie, csrf: userLogin.data.csrf, body: {},
  });
  assert.equal(nonOwnerTicket.response.status, 403);

  const missingCsrf = await request("/api/admin/desktop/viewer-ticket", {
    method: "POST", cookie: adminCookie, body: {},
  });
  assert.equal(missingCsrf.response.status, 403);

  const issued = await request("/api/admin/desktop/viewer-ticket", {
    method: "POST", cookie: adminCookie, csrf: adminCsrf, body: {},
  });
  assert.equal(issued.response.status, 200, JSON.stringify(issued.data));
  assert.equal(issued.data.expiresInSeconds, 60);
  assert.match(issued.data.url, /^\/admin\/desktop-viewer\?ticket=[A-Za-z0-9_-]{43}$/);

  const anonymousOpen = await request(issued.data.url);
  assert.equal(anonymousOpen.response.status, 401);
  const nonOwnerOpen = await request(issued.data.url, { cookie: userCookie });
  assert.equal(nonOwnerOpen.response.status, 403);
  const secondOwner = await request("/api/admin/login", { method: "POST", body: { password } });
  const otherOwnerOpen = await request(issued.data.url, { cookie: cookieFrom(secondOwner.response, "nj_admin") });
  assert.equal(otherOwnerOpen.response.status, 404);
  const viewer = await request(issued.data.url, { cookie: adminCookie });
  assert.equal(viewer.response.status, 200);
  assert.equal(viewer.response.headers.get("cache-control"), "no-store");
  assert.match(viewer.response.headers.get("content-security-policy"), /connect-src 'self'/);
  assert.match(viewer.data, /Waiting for authorization from the owner panel/);
  assert.doesNotMatch(viewer.data, /admin-password/);

  const replay = await request(issued.data.url, { cookie: adminCookie });
  assert.equal(replay.response.status, 404);
  const guessedPath = await request("/admin/desktop-viewer", { cookie: adminCookie });
  assert.equal(guessedPath.response.status, 404);
});

test("desktop relay requires signed companion traffic and owner-authorized controls", async () => {
  const anonymousStatus = await request("/api/admin/desktop/relay/status");
  assert.equal(anonymousStatus.response.status, 401);

  const unsignedPoll = await request("/api/desktop/companion/poll");
  assert.equal(unsignedPoll.response.status, 401);
  const idlePoll = await signedDesktopRequest("/api/desktop/companion/poll");
  assert.equal(idlePoll.status, 200);
  assert.equal((await idlePoll.json()).command, null);
  const replayHeaders = desktopSignature("/api/desktop/companion/poll", "GET");
  const replayFirst = await fetch(`${baseUrl}/api/desktop/companion/poll`, { headers: replayHeaders });
  assert.equal(replayFirst.status, 200);
  const replaySecond = await fetch(`${baseUrl}/api/desktop/companion/poll`, { headers: replayHeaders });
  assert.equal(replaySecond.status, 401);

  const missingCsrf = await request("/api/admin/desktop/relay/pair", {
    method: "POST", cookie: adminCookie, body: {},
  });
  assert.equal(missingCsrf.response.status, 403);
  const paired = await request("/api/admin/desktop/relay/pair", {
    method: "POST", cookie: adminCookie, csrf: adminCsrf, body: {},
  });
  assert.equal(paired.response.status, 200, JSON.stringify(paired.data));

  const noShare = await request("/api/admin/desktop/relay/start", {
    method: "POST", cookie: adminCookie, csrf: adminCsrf, body: {},
  });
  assert.equal(noShare.response.status, 202);
  const startCommandResponse = await signedDesktopRequest("/api/desktop/companion/poll");
  const startCommand = (await startCommandResponse.json()).command;
  assert.equal(startCommand.action, "start");
  const startResult = await signedDesktopRequest("/api/desktop/companion/result", {
    method: "POST",
    body: Buffer.from(JSON.stringify({
      commandId: startCommand.id, sessionId: startCommand.sessionId, action: "start", ok: true,
    })),
  });
  assert.equal(startResult.status, 200);

  const state = await request("/api/admin/desktop/relay/status", { cookie: adminCookie });
  assert.equal(state.data.sharing, true);
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const frameUpload = await signedDesktopRequest("/api/desktop/companion/frame", { method: "POST", body: png });
  assert.equal(frameUpload.status, 204);
  const nonOwnerInvite = await issueToken({ label: "Desktop relay non-owner" });
  const nonOwnerLogin = await request("/api/auth/login", {
    method: "POST", body: { token: nonOwnerInvite.token },
  });
  assert.equal(nonOwnerLogin.response.status, 200);
  const nonOwnerCookie = cookieFrom(nonOwnerLogin.response, "nj_session");
  assert.equal((await request("/api/admin/desktop/relay/status", { cookie: nonOwnerCookie })).response.status, 403);
  assert.equal((await fetch(`${baseUrl}/api/admin/desktop/relay/frame`, {
    headers: { Cookie: nonOwnerCookie },
  })).status, 403);
  for (const [path, body] of [
    ["/api/admin/desktop/relay/start", {}],
    ["/api/admin/desktop/relay/input", { action: "key", key: "enter" }],
    ["/api/admin/desktop/relay/stop", {}],
  ]) {
    const denied = await request(path, {
      method: "POST", cookie: nonOwnerCookie, csrf: nonOwnerLogin.data.csrf, body,
    });
    assert.equal(denied.response.status, 403, `${path} should require an owner session`);
  }
  const frame = await fetch(`${baseUrl}/api/admin/desktop/relay/frame`, { headers: { Cookie: adminCookie } });
  assert.equal(frame.status, 200);
  assert.deepEqual(Buffer.from(await frame.arrayBuffer()), png);

  const enabled = await request("/api/admin/desktop/relay/enable-input", {
    method: "POST", cookie: adminCookie, csrf: adminCsrf, body: {},
  });
  assert.equal(enabled.response.status, 202);
  const enableCommand = (await (await signedDesktopRequest("/api/desktop/companion/poll")).json()).command;
  assert.equal(enableCommand.action, "enable-input");
  const enableResult = await signedDesktopRequest("/api/desktop/companion/result", {
    method: "POST",
    body: Buffer.from(JSON.stringify({
      commandId: enableCommand.id, sessionId: enableCommand.sessionId, action: "enable-input", ok: true,
    })),
  });
  assert.equal(enableResult.status, 200);

  const invalidInput = await request("/api/admin/desktop/relay/input", {
    method: "POST", cookie: adminCookie, csrf: adminCsrf,
    body: { action: "shell", command: "id" },
  });
  assert.equal(invalidInput.response.status, 400);
  const acceptedInput = await request("/api/admin/desktop/relay/input", {
    method: "POST", cookie: adminCookie, csrf: adminCsrf, body: { action: "key", key: "enter" },
  });
  assert.equal(acceptedInput.response.status, 202);
  const inputCommand = (await (await signedDesktopRequest("/api/desktop/companion/poll")).json()).command;
  assert.equal(inputCommand.action, "input");
  assert.deepEqual(inputCommand.input, { action: "key", key: "enter" });
  const inputResult = await signedDesktopRequest("/api/desktop/companion/result", {
    method: "POST",
    body: Buffer.from(JSON.stringify({
      commandId: inputCommand.id, sessionId: inputCommand.sessionId, action: "input", ok: true,
    })),
  });
  assert.equal(inputResult.status, 200);

  const stop = await request("/api/admin/desktop/relay/stop", {
    method: "POST", cookie: adminCookie, csrf: adminCsrf, body: {},
  });
  assert.equal(stop.response.status, 200);
  const stopCommand = (await (await signedDesktopRequest("/api/desktop/companion/poll")).json()).command;
  assert.equal(stopCommand.action, "stop");
  const afterStop = await request("/api/admin/desktop/relay/status", { cookie: adminCookie });
  assert.equal(afterStop.data.paired, false);

  const relayOwnerInvite = await issueToken({ label: "Desktop relay owner", rank: "owner" });
  const relayOwnerLogin = await request("/api/auth/login", {
    method: "POST", body: { token: relayOwnerInvite.token },
  });
  assert.equal(relayOwnerLogin.response.status, 200);
  const relayOwnerCookie = cookieFrom(relayOwnerLogin.response, "nj_session");
  const pairedAgain = await request("/api/admin/desktop/relay/pair", {
    method: "POST", cookie: relayOwnerCookie, csrf: relayOwnerLogin.data.csrf, body: {},
  });
  assert.equal(pairedAgain.response.status, 200);
  const loggedOut = await request("/api/auth/logout", {
    method: "POST", cookie: relayOwnerCookie, csrf: relayOwnerLogin.data.csrf, body: {},
  });
  assert.equal(loggedOut.response.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const afterOwnerLogout = await signedDesktopRequest("/api/desktop/companion/poll");
  assert.equal(afterOwnerLogout.status, 200, await afterOwnerLogout.clone().text());
  const disconnected = await afterOwnerLogout.json();
  assert.equal(disconnected.paired, false);
  assert.equal(disconnected.command.action, "stop");
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

test("provides the five requested Luma ranks and preserves token-rank access", async () => {
  const ranks = await runAdminCommand(["ranks"], { databasePath: join(tempDirectory, "nightjar.sqlite") });
  const byId = new Map(ranks.items.map((rank) => [rank.id, rank]));
  const requestedRankIds = ["basic", "full", "standard", "with-ai", "without-ai"];
  assert.deepEqual(ranks.items.filter((rank) => requestedRankIds.includes(rank.id)).map((rank) => rank.id).sort(), [...requestedRankIds].sort());
  assert.deepEqual(requestedRankIds.map((id) => byId.get(id)?.label), ["Basic", "Full", "Standard", "With AI", "Without AI"]);
  assert.ok(!["basic-plus", "ai", "full-minus", "owner"].some((id) => byId.has(id)), "legacy built-ins should not appear in rank listings");
  assert.ok(byId.get("basic").features.includes("assistant"));
  assert.ok(byId.get("basic").features.includes("notes"));
  const basicToken = await runAdminCommand(["token", "make", "Basic invite", "basic"], {
    databasePath: join(tempDirectory, "nightjar.sqlite"),
  });
  assert.deepEqual(basicToken.features, byId.get("basic").features);
  const basicPlusToken = await runAdminCommand(["token", "make", "Basic plus invite", "basic-plus"], {
    databasePath: join(tempDirectory, "nightjar.sqlite"),
  });
  assert.ok(basicPlusToken.features.includes("bookmarks"));
  assert.ok(basicPlusToken.features.includes("assistant"));
  const aiToken = await runAdminCommand(["token", "make", "AI invite", "ai"], {
    databasePath: join(tempDirectory, "nightjar.sqlite"),
  });
  assert.equal(aiToken.rank, "ai");
  assert.ok(aiToken.features.includes("bookmarks"));
  assert.ok(!aiToken.features.includes("settings"));
  const fullTierToken = await runAdminCommand(["token", "make", "Full tier invite", "full"], {
    databasePath: join(tempDirectory, "nightjar.sqlite"),
  });
  assert.equal(fullTierToken.rank, "full");
  const fullTierLogin = await request("/api/auth/login", { method: "POST", body: { token: fullTierToken.token } });
  assert.equal(fullTierLogin.response.status, 200);
  const fullTierCookie = cookieFrom(fullTierLogin.response, "nj_session");
  assert.equal((await request("/api/session", { cookie: fullTierCookie })).data.account.rank, "full");
  assert.notEqual((await request("/api/admin/summary", { cookie: fullTierCookie })).response.status, 200);
  const fullToken = await runAdminCommand(["token", "make", "Full invite", "full-minus"], {
    databasePath: join(tempDirectory, "nightjar.sqlite"),
  });
  assert.ok(fullToken.features.includes("settings"));

  const renewal = await runAdminCommand(["token", "renew", fullToken.accountId, "Replacement", "owner"], {
    databasePath: join(tempDirectory, "nightjar.sqlite"),
  });
  assert.equal(renewal.rank, "owner");
  assert.ok(renewal.features.includes("settings"));
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

test("Basic signup is free and supports account email login", { timeout: 15_000 }, async () => {
  const store = await request("/api/rank-store");
  assert.equal(store.response.status, 200);
  assert.equal(store.data.checkoutConfigured, false);
  assert.deepEqual(store.data.items.map((rank) => [rank.id, rank.label]), [
    ["basic", "Basic"],
    ["standard", "Standard"],
    ["without-ai", "Without AI"],
    ["with-ai", "With AI"],
    ["full", "Full"],
  ]);
  assert.equal(store.data.items[0].price, 0);
  assert.equal(store.data.items[0].available, true);

  const email = `free-${Date.now()}@example.test`;
  const signup = await request("/api/auth/basic-signup", {
    method: "POST",
    body: { label: "Free account", email, password: "basic-account-password" },
  });
  assert.equal(signup.response.status, 201, JSON.stringify(signup.data));
  assert.equal(signup.data.account.rank, "basic");
  assert.ok(signup.data.account.features.includes("notes"));
  assert.ok(signup.data.account.features.includes("storage"));
  const cookie = cookieFrom(signup.response, "nj_session");
  assert.equal((await request("/api/notes", { cookie })).response.status, 200);
  assert.equal((await request("/api/auth/logout", { method: "POST", cookie, csrf: signup.data.csrf, body: {} })).response.status, 200);
  const login = await request("/api/auth/email-login", {
    method: "POST",
    body: { email, password: "basic-account-password" },
  });
  assert.equal(login.response.status, 200, JSON.stringify(login.data));
  assert.equal(login.data.account.rank, "basic");
});

test("notes, SQLite files, and bug reports are account-scoped", async () => {
  const permissions = ["browse", "notes", "storage", "bugs"];
  const features = ["notes", "storage", "bugs"];
  const ownerInvite = await issueToken({ label: "Luma owner-data test", rank: "basic", permissions, features });
  const otherInvite = await issueToken({ label: "Luma isolated-data test", rank: "basic", permissions, features });
  const ownerLogin = await request("/api/auth/login", { method: "POST", body: { token: ownerInvite.token } });
  const otherLogin = await request("/api/auth/login", { method: "POST", body: { token: otherInvite.token } });
  const ownerCookie = cookieFrom(ownerLogin.response, "nj_session");
  const otherCookie = cookieFrom(otherLogin.response, "nj_session");

  const note = await request("/api/notes", {
    method: "POST", cookie: ownerCookie, csrf: ownerLogin.data.csrf,
    body: { title: "Private note", content: "Account-owned text." },
  });
  assert.equal(note.response.status, 201);
  assert.deepEqual((await request("/api/notes", { cookie: otherCookie })).data.items, []);
  assert.equal((await request(`/api/notes/${note.data.item.id}`, { cookie: otherCookie })).response.status, 404);

  const file = await request("/api/storage", {
    method: "POST", cookie: ownerCookie, csrf: ownerLogin.data.csrf,
    body: { name: "private.txt", type: "text/plain", content: Buffer.from("private file").toString("base64") },
  });
  assert.equal(file.response.status, 201);
  assert.deepEqual((await request("/api/storage", { cookie: otherCookie })).data.items, []);
  assert.equal((await request(`/api/storage/${file.data.item.id}/download`, { cookie: otherCookie })).response.status, 404);

  const report = await request("/api/feedback", {
    method: "POST", cookie: ownerCookie, csrf: ownerLogin.data.csrf,
    body: { kind: "bug", subject: "A private bug report", message: "The settings dialog did not save." },
  });
  assert.equal(report.response.status, 201);
  assert.equal((await request("/api/admin/feedback")).response.status, 401);
  const feedback = await request("/api/admin/feedback?limit=200", { cookie: adminCookie });
  assert.ok(feedback.data.items.some((item) => item.id === report.data.id && item.kind === "bug"));
  const restrictedInvite = await issueToken({ label: "No bug permission", rank: "basic", permissions: ["browse"], features: [] });
  const restrictedLogin = await request("/api/auth/login", { method: "POST", body: { token: restrictedInvite.token } });
  const deniedReport = await request("/api/feedback", {
    method: "POST", cookie: cookieFrom(restrictedLogin.response, "nj_session"), csrf: restrictedLogin.data.csrf,
    body: { kind: "bug", subject: "Not permitted", message: "This account cannot submit bugs." },
  });
  assert.equal(deniedReport.response.status, 403);
});

test("friend chat supports blocking and private owner reports", async () => {
  const permissions = ["browse", "chat"];
  const features = ["chat"];
  const senderInvite = await issueToken({ label: "Chat sender", rank: "basic", friend: true, permissions, features });
  const recipientInvite = await issueToken({ label: "Chat recipient", rank: "basic", friend: true, permissions, features });
  const senderLogin = await request("/api/auth/login", { method: "POST", body: { token: senderInvite.token } });
  const recipientLogin = await request("/api/auth/login", { method: "POST", body: { token: recipientInvite.token } });
  const senderCookie = cookieFrom(senderLogin.response, "nj_session");
  const recipientCookie = cookieFrom(recipientLogin.response, "nj_session");
  const message = await request("/api/chat/messages", {
    method: "POST", cookie: senderCookie, csrf: senderLogin.data.csrf,
    body: { peer: recipientInvite.item.accountId, message: "Private hello." },
  });
  assert.equal(message.response.status, 201);
  const report = await request("/api/chat/report", {
    method: "POST", cookie: recipientCookie, csrf: recipientLogin.data.csrf,
    body: { messageId: message.data.item.id, reason: "Please review this message." },
  });
  assert.equal(report.response.status, 201);
  assert.equal((await request("/api/admin/moderation")).response.status, 401);
  const moderation = await request("/api/admin/moderation", { cookie: adminCookie });
  assert.ok(moderation.data.items.some((item) => item.id === report.data.id && item.kind === "chat_report"));
  const blocked = await request(`/api/chat/blocks/${senderInvite.item.accountId}`, {
    method: "POST", cookie: recipientCookie, csrf: recipientLogin.data.csrf, body: {},
  });
  assert.equal(blocked.response.status, 200);
  assert.equal((await request(`/api/chat/messages?peer=${recipientInvite.item.accountId}`, { cookie: senderCookie })).response.status, 403);
  for (const accountId of [senderInvite.item.accountId, recipientInvite.item.accountId]) {
    const removed = await request(`/api/admin/friends/${accountId}`, {
      method: "DELETE", cookie: adminCookie, csrf: adminCsrf,
    });
    assert.equal(removed.response.status, 200);
  }
});

test("owner can manage ranks and review private support requests", async () => {
  const ranks = await request("/api/admin/ranks", { cookie: adminCookie });
  assert.equal(ranks.response.status, 200);
  assert.ok(ranks.data.items.some((rank) => rank.id === "basic"));
  assert.deepEqual(ranks.data.items.filter((rank) => ["basic", "full", "standard", "with-ai", "without-ai"].includes(rank.id)).map((rank) => rank.id).sort(),
    ["basic", "full", "standard", "with-ai", "without-ai"]);
  assert.ok(!ranks.data.items.some((rank) => ["basic-plus", "ai", "full-minus", "owner"].includes(rank.id)));
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
