const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { csrf: "", summary: null, siteControls: null, tokens: [], accounts: [], ranks: [], sessions: [], audits: [], feedback: [], twoFactor: false, toastTimer: 0 };

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function icon(name) {
  const paths = {
    close: '<path d="m18 6-12 12"/><path d="m6 6 12 12"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    trash: '<path d="M4 7h16"/><path d="m7 7 .7 13h8.6L17 7"/><path d="M9 7V4h6v3"/>',
    shield: '<path d="M12 22s8-3.8 8-10V5l-8-3-8 3v7c0 6.2 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>',
  };
  return `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? ""}</svg>`;
}

function toast(message) {
  const target = $("#toast");
  target.textContent = message;
  target.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => target.classList.remove("visible"), 3000);
}

async function api(path, options = {}) {
  const method = options.method ?? "GET";
  const headers = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (!["GET", "HEAD"].includes(method) && state.csrf) headers["X-NJ-CSRF"] = state.csrf;
  let response;
  try {
    response = await fetch(path, { method, headers, credentials: "same-origin", cache: "no-store", body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  } catch {
    throw new Error("Cannot reach Nightjar. Check the local service connection.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "The request could not be completed.");
  return data;
}

function showLogin(message = "") {
  $("#admin-signin").hidden = false;
  $("#admin-console").hidden = true;
  $("#admin-login-error").textContent = message;
  $("#admin-login-error").hidden = !message;
}

function showConsole() {
  $("#admin-signin").hidden = true;
  $("#admin-console").hidden = false;
  renderDesktopState();
}

function openDialog({ title, description = "", content, footer = "", wide = false }) {
  closeDialog();
  $("#overlay-root").innerHTML = `<div class="overlay-root" data-overlay><section class="dialog${wide ? " wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header class="dialog-header"><div class="dialog-heading"><h2 id="dialog-title">${esc(title)}</h2>${description ? `<p>${esc(description)}</p>` : ""}</div><button class="icon-button" data-close-dialog aria-label="Close dialog">${icon("close")}</button></header><div class="dialog-body">${content}</div>${footer ? `<footer class="dialog-footer">${footer}</footer>` : ""}</section></div>`;
  const overlay = $("[data-overlay]");
  overlay.addEventListener("mousedown", (event) => { if (event.target === overlay) closeDialog(); });
  $("[data-close-dialog]").addEventListener("click", closeDialog);
  document.addEventListener("keydown", closeDialogOnEscape);
}

function closeDialog() {
  $("#overlay-root").replaceChildren();
  document.removeEventListener("keydown", closeDialogOnEscape);
}

function closeDialogOnEscape(event) {
  if (event.key === "Escape") closeDialog();
}

function date(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? "—" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function statusBadge(status) {
  const label = status === "redeemed" ? "redeemed · session cookie" : status;
  return `<span class="status-badge ${esc(status)}">${esc(label)}</span>`;
}

function renderMetrics() {
  const metrics = [
    ["Live sessions", state.summary.activeSessions, "Heartbeat monitored", "◉"],
    ["Active invitations", state.summary.activeTokens, `${state.summary.tokens} issued total`, "⌁"],
    ["Active accounts", state.summary.accounts, "Owner provisioned", "◇"],
    ["Service uptime", `${Math.floor(state.summary.uptimeSeconds / 60)}m`, `${esc(state.summary.nodeVersion)} · ${esc(state.summary.database)}`, "↗"],
  ];
  $("#metrics").innerHTML = metrics.map(([label, value, foot, glyph]) => `<article class="metric-card"><div class="metric-label"><span>${esc(label)}</span><span class="metric-glyph">${glyph}</span></div><div class="metric-value">${esc(value)}</div><div class="metric-foot">${esc(foot)}</div></article>`).join("");
  $("#security-grid").innerHTML = [
    ["Owner authentication", state.twoFactor ? "Password + TOTP required" : "Password required · TOTP not enabled", state.twoFactor ? "Secure" : "Recommended", !state.twoFactor],
    ["Invitation storage", "Only SHA-256 token hashes are retained", "Secure", false],
    ["Session enforcement", "One live session per account · 12-hour idle and maximum age", "Active", false],
    ["Admin isolation", "Separate owner session cookie and protected endpoints", "Active", false],
    ["Browser boundary", "Rammerhead on a separate origin; public HTTP(S) destinations and ports 80/443 only", "Scoped", false],
    ["Local AI assistant", `${state.summary.localAi.model} · auto-start ${state.summary.localAi.autoStart ? "enabled" : "disabled"} · ${state.summary.localAi.serviceStatus}`, state.summary.localAi.startedByApp ? "Started by Nightjar" : "Loopback only", !state.summary.localAi.autoStart],
    ["Desktop companion", state.desktopSession ? "Locally paired · no shell-command API" : "Manual start · loopback only · local approval", state.desktopSharing ? "Active" : "Not sharing", !state.desktopSession],
  ].map(([title, desc, status, warn]) => `<div class="security-item"><span class="security-icon${warn ? " warning" : ""}">${warn ? "!" : "✓"}</span><div class="security-copy"><strong>${esc(title)} · ${esc(status)}</strong><span>${esc(desc)}</span></div></div>`).join("");
  $("#usage-stats").innerHTML = [
    ["Page visits", state.summary.usage.visits],
    ["Bookmarks", state.summary.usage.bookmarks],
    ["Local assistant requests", state.summary.usage.assistantRequests],
  ].map(([label, value]) => `<div class="usage-stat"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join("");
}

function renderRecent() {
  const items = state.audits.slice(0, 6);
  if (!items.length) {
    $("#recent-activity").innerHTML = '<div class="table-empty">No recorded activity yet.</div>';
    return;
  }
  $("#recent-activity").innerHTML = `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>EVENT</th><th>SUBJECT</th><th>TIME</th><th>ACTOR</th></tr></thead><tbody>${items.map((item) => `<tr><td><span class="table-primary">${esc(item.action.replaceAll(".", " "))}</span></td><td>${esc(item.subject)}</td><td>${esc(date(item.createdAt))}</td><td>${esc(item.actor)}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderTokens() {
  if (!state.tokens.length) {
    $("#token-table").innerHTML = '<div class="table-empty">No invitations yet. Create an invitation to add a private account.</div>';
    return;
  }
  $("#token-table").innerHTML = `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>TOKEN / ACCOUNT</th><th>RANK / PERMISSIONS</th><th>STATUS / USES</th><th>CREATED / EXPIRES</th><th></th></tr></thead><tbody>${state.tokens.map((item) => `<tr><td><div class="table-primary">${esc(item.label)}</div><div class="table-secondary">${esc(item.accountLabel)} · ${esc(item.accountId.slice(0, 8))}</div></td><td><div class="table-primary">${esc(item.rank)}</div><div class="token-permissions">${item.permissions.map((permission) => `<span>${esc(permission)}</span>`).join("")}</div></td><td>${statusBadge(item.status)}<div class="table-secondary">${item.usageCount} / 1 redemption</div><div class="table-secondary">${item.status === "redeemed" ? "The account stays signed in by its cookie." : `Last used ${esc(date(item.lastUsedAt))}`}</div></td><td>${esc(date(item.createdAt))}<div class="table-secondary">Expires ${esc(date(item.expiresAt))}</div></td><td><div class="table-actions">${item.status !== "revoked" ? `<button class="danger-button" data-revoke-token="${item.id}" type="button">Revoke</button>` : ""}</div></td></tr>`).join("")}</tbody></table></div>`;
  $$("[data-revoke-token]").forEach((button) => button.addEventListener("click", () => void revokeToken(button.dataset.revokeToken)));
}

function renderRanks() {
  const root = $("#rank-table");
  if (!state.ranks.length) {
    root.innerHTML = '<div class="table-empty">No access ranks are configured. Add a rank before creating an invitation.</div>';
    return;
  }
  root.innerHTML = `<div class="rank-grid">${state.ranks.map((rank) => `<article class="rank-card"><div class="rank-heading"><strong>${esc(rank.label)}</strong><button class="danger-button" type="button" data-delete-rank="${esc(rank.id)}" aria-label="Remove ${esc(rank.label)} rank">Remove</button></div><div class="rank-id mono">${esc(rank.id)}</div><div class="token-permissions">${rank.features.includes("assistant") ? "<span>AI enabled</span>" : "<span>AI disabled</span>"}${rank.permissions.map((item) => `<span>${esc(item)}</span>`).join("")}</div><div class="table-secondary">Features: ${esc(rank.features.join(", ") || "none")}</div></article>`).join("")}</div>`;
  $$("[data-delete-rank]").forEach((button) => button.addEventListener("click", () => void deleteRank(button.dataset.deleteRank)));
}

function renderAccounts() {
  const root = $("#account-table");
  if (!state.accounts.length) {
    root.innerHTML = '<div class="table-empty">No accounts have been created.</div>';
    return;
  }
  root.innerHTML = `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>ACCOUNT</th><th>RANK / FEATURES</th><th>STATUS</th><th>CREATED</th><th></th></tr></thead><tbody>${state.accounts.map((account) => `<tr><td><div class="table-primary">${esc(account.label)}</div><div class="table-secondary mono">${esc(account.id)}</div></td><td><div class="table-primary">${esc(account.rank)}</div><div class="token-permissions">${account.features.map((feature) => `<span>${esc(feature)}</span>`).join("")}</div></td><td>${statusBadge(account.revokedAt ? "revoked" : "active")}</td><td>${esc(date(account.createdAt))}</td><td><div class="table-actions">${!account.revokedAt ? `<button class="secondary-button" data-edit-account="${esc(account.id)}" type="button">Manage</button><button class="danger-button" data-revoke-account="${esc(account.id)}" type="button">Revoke</button>` : ""}</div></td></tr>`).join("")}</tbody></table></div>`;
  $$("[data-edit-account]").forEach((button) => button.addEventListener("click", () => editAccount(button.dataset.editAccount)));
  $$("[data-revoke-account]").forEach((button) => button.addEventListener("click", () => void revokeAccount(button.dataset.revokeAccount)));
}

function editAccount(id) {
  const account = state.accounts.find((item) => item.id === id);
  if (!account || account.revokedAt) return;
  const permissions = ["bookmarks", "history", "settings", "assistant", "games", "support"];
  const features = ["bookmarks", "history", "settings", "assistant", "games", "support"];
  const savedRank = state.ranks.some((rank) => rank.id === account.rank)
    ? ""
    : `<option value="${esc(account.rank)}" selected>Saved permissions (${esc(account.rank)})</option>`;
  openDialog({
    title: `Manage ${account.label}`,
    description: "Changes apply immediately and end this account’s current session.",
    wide: true,
    content: `<form id="account-form" class="admin-invite-form">
      <label class="form-field wide-field"><span class="field-label">Account label</span><input class="field-input" name="label" maxlength="80" required value="${esc(account.label)}"></label>
      <label class="form-field wide-field"><span class="field-label">Access rank</span><select class="field-select" name="rank">${savedRank}${state.ranks.map((rank) => `<option value="${esc(rank.id)}" ${rank.id === account.rank ? "selected" : ""}>${esc(rank.label)} · ${rank.features.includes("assistant") ? "AI enabled" : "No AI"}</option>`).join("")}</select></label>
      <div class="form-field wide-field"><span class="subsection-label">Permissions</span><div class="check-grid"><label class="check-option"><input type="checkbox" name="permission" value="browse" checked disabled> Browse (required)</label>${permissions.map((item) => `<label class="check-option"><input type="checkbox" name="permission" value="${item}" ${account.permissions.includes(item) ? "checked" : ""}>${item === "assistant" ? "Local AI assistant" : item === "games" ? "Math games" : item === "support" ? "Support & suggestions" : item[0].toUpperCase() + item.slice(1)}</label>`).join("")}</div></div>
      <div class="form-field wide-field"><span class="subsection-label">Enabled features</span><div class="check-grid">${features.map((item) => `<label class="check-option"><input type="checkbox" name="feature" value="${item}" ${account.features.includes(item) ? "checked" : ""}>${item === "assistant" ? "Local AI assistant" : item === "games" ? "Math games" : item === "support" ? "Support & suggestions" : item[0].toUpperCase() + item.slice(1)}</label>`).join("")}</div></div>
      <label class="form-field"><span class="field-label">Theme</span><select class="field-select" name="theme"><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select></label>
      <label class="form-field"><span class="field-label">Accent color</span><input class="field-input" name="accent" type="color"></label>
      <label class="form-field"><span class="field-label">Interface density</span><select class="field-select" name="density"><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="spacious">Spacious</option></select></label>
      <label class="form-field"><span class="field-label">Search provider</span><select class="field-select" name="searchProvider"><option value="duckduckgo">DuckDuckGo</option><option value="brave">Brave Search</option><option value="bing">Bing</option><option value="google">Google</option><option value="yandex">Yandex</option></select></label>
      <label class="form-field wide-field"><span class="field-label">Homepage (home, blank, or HTTP(S) address)</span><input class="field-input" name="homepage" maxlength="2048" required></label>
      <div class="form-field wide-field"><div class="check-grid"><label class="check-option"><input type="checkbox" name="customCursor"> Custom cursor</label><label class="check-option"><input type="checkbox" name="suppressReferrer"> Suppress referrers</label><label class="check-option"><input type="checkbox" name="clearOnExit"> Clear on sign-out</label></div></div>
    </form>`,
    footer: '<span class="muted" style="font-size:9px">The user must sign in again after changes.</span><div class="dialog-footer-right"><button class="secondary-button" data-close-dialog type="button">Cancel</button><button id="save-account" class="primary-button" type="button">Save account</button></div>',
  });
  const form = $("#account-form");
  const settings = account.settings;
  form.elements.theme.value = settings.theme;
  form.elements.accent.value = settings.accent;
  form.elements.density.value = settings.density;
  form.elements.searchProvider.value = settings.searchProvider;
  form.elements.homepage.value = settings.homepage;
  form.elements.customCursor.checked = settings.customCursor;
  form.elements.suppressReferrer.checked = settings.privacy?.suppressReferrer ?? true;
  form.elements.clearOnExit.checked = settings.privacy?.clearOnExit ?? false;
  $$('input[name="permission"]', form).forEach((permission) => permission.addEventListener("change", () => {
    $$('input[name="feature"]', form).forEach((feature) => {
      if (feature.value === permission.value && !permission.checked) feature.checked = false;
    });
  }));
  form.elements.rank.addEventListener("change", () => {
    const rank = state.ranks.find((item) => item.id === form.elements.rank.value);
    if (!rank) return;
    $$('input[name="permission"]', form).forEach((input) => { input.checked = input.value === "browse" || rank.permissions.includes(input.value); });
    $$('input[name="feature"]', form).forEach((input) => { input.checked = rank.features.includes(input.value); });
  });
  $("[data-close-dialog]").addEventListener("click", closeDialog);
  $("#save-account").addEventListener("click", async () => {
    if (!form.reportValidity()) return;
    const nextSettings = {
      theme: form.elements.theme.value,
      accent: form.elements.accent.value,
      density: form.elements.density.value,
      searchProvider: form.elements.searchProvider.value,
      homepage: form.elements.homepage.value.trim(),
      customCursor: form.elements.customCursor.checked,
      privacy: {
        suppressReferrer: form.elements.suppressReferrer.checked,
        clearOnExit: form.elements.clearOnExit.checked,
      },
    };
    try {
      const result = await api(`/api/admin/accounts/${account.id}`, {
        method: "PATCH",
        body: {
          label: form.elements.label.value.trim(),
          rank: form.elements.rank.value,
          permissions: $$('input[name="permission"]:checked', form).map((input) => input.value),
          features: $$('input[name="feature"]:checked', form).map((input) => input.value),
          settings: nextSettings,
        },
      });
      closeDialog();
      await Promise.all([loadTokens(), loadSessions()]);
      toast(`Account updated. ${result.sessionsTerminated} active session(s) ended.`);
    } catch (error) { toast(error.message); }
  });
}

async function revokeAccount(id) {
  const account = state.accounts.find((item) => item.id === id);
  if (!account || !confirm(`Revoke ${account.label}? This ends its session and revokes all its invitations.`)) return;
  try {
    await api(`/api/admin/accounts/${id}/revoke`, { method: "POST", body: {} });
    await Promise.all([loadTokens(), loadSessions(), loadOverview()]);
    toast("Account access revoked.");
  } catch (error) { toast(error.message); }
}

function renderSiteControls() {
  if (!state.siteControls) return;
  $("#control-maintenance").checked = state.siteControls.maintenanceMode;
  $("#control-invitations").checked = state.siteControls.invitationsEnabled;
  $("#control-assistant").checked = state.siteControls.assistantEnabled;
}

function renderFeedback() {
  const root = $("#feedback-table");
  if (!state.feedback.length) {
    root.innerHTML = '<div class="table-empty">No support requests or suggestions yet.</div>';
    return;
  }
  root.innerHTML = `<div class="feedback-list">${state.feedback.map((item) => `<article class="feedback-card"><header><div><span class="status-badge ${item.kind === "suggestion" ? "active" : "used"}">${item.kind === "suggestion" ? "Suggestion" : "Support"}</span><h3>${esc(item.subject)}</h3><p>${esc(item.accountLabel)} · ${esc(date(item.createdAt))}</p></div><label class="feedback-status">Status<select data-feedback-status="${esc(item.id)}" aria-label="Update status for ${esc(item.subject)}"><option value="open" ${item.status === "open" ? "selected" : ""}>Open</option><option value="in_progress" ${item.status === "in_progress" ? "selected" : ""}>In progress</option><option value="resolved" ${item.status === "resolved" ? "selected" : ""}>Resolved</option></select></label></header><p class="feedback-message">${esc(item.message)}</p></article>`).join("")}</div>`;
  $$("[data-feedback-status]").forEach((select) => select.addEventListener("change", async () => {
    try {
      await api(`/api/admin/feedback/${select.dataset.feedbackStatus}`, { method: "PATCH", body: { status: select.value } });
      toast("Feedback status updated.");
    } catch (error) { toast(error.message); }
  }));
}

function renderSessions() {
  if (!state.sessions.length) {
    $("#session-table").innerHTML = '<div class="table-empty">No user sessions are active. Stale sessions expire automatically.</div>';
    return;
  }
  $("#session-table").innerHTML = `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>ACCOUNT</th><th>STARTED</th><th>LAST HEARTBEAT</th><th>EXPIRES</th><th></th></tr></thead><tbody>${state.sessions.map((item) => `<tr><td><div class="table-primary">${esc(item.accountLabel)}</div><div class="table-secondary mono">${esc(item.id.slice(0, 8))}</div></td><td>${esc(date(item.createdAt))}</td><td>${esc(date(item.lastSeenAt))}</td><td>${esc(date(item.expiresAt))}</td><td><div class="table-actions"><button class="danger-button" data-terminate="${item.id}" type="button">Terminate</button></div></td></tr>`).join("")}</tbody></table></div>`;
  $$("[data-terminate]").forEach((button) => button.addEventListener("click", () => void terminateSession(button.dataset.terminate)));
}

function renderAudit() {
  if (!state.audits.length) {
    $("#audit-table").innerHTML = '<div class="table-empty">No events have been recorded.</div>';
    return;
  }
  $("#audit-table").innerHTML = `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>TIME</th><th>ACTOR / EVENT</th><th>SUBJECT</th><th>DETAILS</th><th>SOURCE IP</th></tr></thead><tbody>${state.audits.map((item) => `<tr><td>${esc(date(item.createdAt))}</td><td><div class="table-primary">${esc(item.actor)}</div><div class="table-secondary">${esc(item.action.replaceAll(".", " "))}</div></td><td>${esc(item.subject)}</td><td><div class="table-secondary mono">${esc(JSON.stringify(item.detail))}</div></td><td class="mono">${esc(item.ipAddress)}</td></tr>`).join("")}</tbody></table></div>`;
}

async function loadOverview() {
  const [summary, audit] = await Promise.all([api("/api/admin/summary"), api("/api/admin/audit?limit=50")]);
  state.summary = summary;
  state.audits = audit.items;
  renderMetrics();
  renderRecent();
  renderAudit();
}

async function loadTokens() {
  const [tokens, accounts, ranks] = await Promise.all([api("/api/admin/tokens"), api("/api/admin/accounts"), api("/api/admin/ranks")]);
  state.tokens = tokens.items;
  state.accounts = accounts.items;
  state.ranks = ranks.items;
  renderTokens();
  renderRanks();
  renderAccounts();
}

async function loadSiteControls() {
  const result = await api("/api/admin/site-controls");
  state.siteControls = result.settings;
  renderSiteControls();
}

async function saveSiteControls() {
  const settings = {
    maintenanceMode: $("#control-maintenance").checked,
    invitationsEnabled: $("#control-invitations").checked,
    assistantEnabled: $("#control-assistant").checked,
  };
  try {
    const result = await api("/api/admin/site-controls", { method: "PATCH", body: settings });
    state.siteControls = result.settings;
    renderSiteControls();
    await loadOverview();
    toast("Site controls saved.");
  } catch (error) { toast(error.message); }
}

function localCompanionUrl(path) {
  if (location.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(location.hostname)) {
    throw new Error("The companion works only from Nightjar opened on this same PC at localhost or 127.0.0.1.");
  }
  return `http://127.0.0.1:4175${path}`;
}

async function companionRequest(path, { body, token = state.desktopSession } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(localCompanionUrl(path), {
      method: body === undefined ? "GET" : "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Cannot reach the local companion. Start it in a separate terminal with `npm run companion`.");
  }
  if ((response.headers.get("content-type") ?? "").startsWith("image/")) {
    if (!response.ok) throw new Error("The local companion could not capture the screen.");
    return response.blob();
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "The local companion request was rejected.");
  return data;
}

function setDesktopMessage(message) {
  $("#desktop-message").textContent = message;
}

function renderDesktopState() {
  const paired = Boolean(state.desktopSession);
  const sharing = Boolean(state.desktopSharing);
  $("#desktop-status").textContent = sharing ? (state.desktopInputEnabled ? "Input enabled" : "Sharing") : paired ? "Paired · idle" : "Not paired";
  $("#desktop-status").className = `status-badge ${sharing ? "active" : paired ? "used" : "revoked"}`;
  $("#desktop-start").disabled = !paired || sharing;
  $("#desktop-enable-input").disabled = !sharing || state.desktopInputEnabled;
  $("#desktop-stop").disabled = !paired;
  $("#desktop-view").hidden = !sharing;
  $("#desktop-send-key").disabled = !state.desktopInputEnabled;
  $("#desktop-send-text").disabled = !state.desktopInputEnabled;
}

function watchDesktopOwnerSession() {
  clearInterval(state.desktopHeartbeatTimer);
  state.desktopHeartbeatTimer = setInterval(async () => {
    if (!state.desktopSession || state.desktopHeartbeatLoading) return;
    state.desktopHeartbeatLoading = true;
    try {
      await api("/api/admin/me");
      if (!state.desktopSession) return;
      await companionRequest("/heartbeat", { body: {} });
    } catch (error) {
      await stopDesktop(true);
      setDesktopMessage(`Owner session or companion authorization ended: ${error.message}`);
    } finally {
      state.desktopHeartbeatLoading = false;
    }
  }, 15_000);
}

async function pairDesktop() {
  try {
    setDesktopMessage("Authorizing this owner session and pairing with the local companion…");
    const { ticket } = await api("/api/admin/desktop/ticket", { method: "POST", body: {} });
    const result = await companionRequest("/pair", { token: "", body: { ticket } });
    state.desktopSession = result.sessionToken;
    state.desktopSharing = false;
    state.desktopInputEnabled = false;
    watchDesktopOwnerSession();
    setDesktopMessage("Paired to this authenticated owner session. Screen sharing and remote input remain off until separately approved in the companion terminal.");
    renderDesktopState();
  } catch (error) {
    setDesktopMessage(error.message);
    toast(error.message);
  }
}

async function startDesktopSharing() {
  try {
    setDesktopMessage("Waiting for local screen-sharing approval in the companion terminal…");
    await companionRequest("/start", { body: {} });
    state.desktopSharing = true;
    state.desktopInputEnabled = false;
    setDesktopMessage("Screen sharing is active. Remote input remains off until separately approved.");
    renderDesktopState();
    void refreshDesktopFrame();
    state.desktopFrameTimer = setInterval(() => void refreshDesktopFrame(), 750);
    watchDesktopOwnerSession();
  } catch (error) {
    setDesktopMessage(error.message);
    toast(error.message);
  }
}

async function enableDesktopInput() {
  try {
    setDesktopMessage("Waiting for separate local mouse-and-keyboard approval in the companion terminal…");
    await companionRequest("/enable-input", { body: {} });
    state.desktopInputEnabled = true;
    setDesktopMessage("Remote mouse and keyboard are active. Stop sharing to end the session.");
    renderDesktopState();
  } catch (error) {
    setDesktopMessage(error.message);
    toast(error.message);
  }
}

async function refreshDesktopFrame() {
  if (!state.desktopSharing || state.desktopFrameLoading) return;
  state.desktopFrameLoading = true;
  try {
    const blob = await companionRequest("/frame");
    const nextUrl = URL.createObjectURL(blob);
    const image = $("#desktop-frame");
    const oldUrl = state.desktopFrameUrl;
    image.src = nextUrl;
    state.desktopFrameUrl = nextUrl;
    if (oldUrl) URL.revokeObjectURL(oldUrl);
  } catch (error) {
    setDesktopMessage(error.message);
    await stopDesktop(true);
  } finally {
    state.desktopFrameLoading = false;
  }
}

async function sendDesktopInput(body) {
  if (!state.desktopInputEnabled) return;
  try {
    await companionRequest("/input", { body });
  } catch (error) {
    setDesktopMessage(error.message);
    toast(error.message);
  }
}

function clickDesktopFrame(event) {
  if (!state.desktopInputEnabled) return;
  const image = event.currentTarget;
  const rect = image.getBoundingClientRect();
  if (!image.naturalWidth || !image.naturalHeight) return;
  const scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
  const drawnWidth = image.naturalWidth * scale;
  const drawnHeight = image.naturalHeight * scale;
  const left = rect.left + (rect.width - drawnWidth) / 2;
  const top = rect.top + (rect.height - drawnHeight) / 2;
  const x = Math.round((event.clientX - left) / scale);
  const y = Math.round((event.clientY - top) / scale);
  if (x < 0 || y < 0 || x >= image.naturalWidth || y >= image.naturalHeight) return;
  event.preventDefault();
  void sendDesktopInput({ action: "click", x, y, button: "left" });
}

async function stopDesktop(silent = false) {
  clearInterval(state.desktopFrameTimer);
  clearInterval(state.desktopHeartbeatTimer);
  state.desktopFrameTimer = 0;
  state.desktopHeartbeatTimer = 0;
  if (state.desktopSession) {
    try { await companionRequest("/stop", { body: {} }); } catch (error) {
      if (!silent) toast(error.message);
    }
  }
  if (state.desktopFrameUrl) URL.revokeObjectURL(state.desktopFrameUrl);
  state.desktopFrameUrl = "";
  state.desktopSession = "";
  state.desktopSharing = false;
  state.desktopInputEnabled = false;
  $("#desktop-frame").removeAttribute("src");
  setDesktopMessage("Companion session stopped. Pair again before the next session.");
  renderDesktopState();
}

async function loadSessions() {
  const result = await api("/api/admin/sessions");
  state.sessions = result.items;
  renderSessions();
}

async function loadFeedback() {
  const result = await api("/api/admin/feedback?limit=200");
  state.feedback = result.items;
  renderFeedback();
}

function setPanel(name) {
  $$("[data-panel-content]").forEach((panel) => { panel.hidden = panel.dataset.panelContent !== name; });
  $$(".rail-item[data-panel]").forEach((button) => button.classList.toggle("selected", button.dataset.panel === name));
  if (name === "invitations") void loadTokens().catch((error) => toast(error.message));
  if (name === "accounts") void loadTokens().catch((error) => toast(error.message));
  if (name === "site-controls") void loadSiteControls().catch((error) => toast(error.message));
  if (name === "sessions") void loadSessions().catch((error) => toast(error.message));
  if (name === "support") void loadFeedback().catch((error) => toast(error.message));
  if (name === "audit") void api("/api/admin/audit?limit=100").then((result) => { state.audits = result.items; renderAudit(); }).catch((error) => toast(error.message));
}

function createRankDialog() {
  const permissions = ["bookmarks", "history", "settings", "assistant", "games", "support"];
  const features = ["bookmarks", "history", "settings", "assistant", "games", "support"];
  openDialog({
    title: "Create access rank",
    description: "Ranks are reusable permission presets for new invitations.",
    content: `<form id="rank-form" class="admin-invite-form"><label class="form-field wide-field"><span class="field-label">Rank name</span><input class="field-input" name="label" maxlength="40" required placeholder="e.g. Study group"></label><div class="form-field wide-field"><span class="subsection-label">Permissions</span><div class="check-grid"><label class="check-option"><input type="checkbox" name="permission" value="browse" checked disabled> Browse (required)</label>${permissions.map((item) => `<label class="check-option"><input type="checkbox" name="permission" value="${item}">${item === "assistant" ? "Local AI assistant" : item === "games" ? "Math games" : item === "support" ? "Support & suggestions" : item[0].toUpperCase() + item.slice(1)}</label>`).join("")}</div></div><div class="form-field wide-field"><span class="subsection-label">Enabled features</span><div class="check-grid">${features.map((item) => `<label class="check-option"><input type="checkbox" name="feature" value="${item}">${item === "assistant" ? "Local AI assistant" : item === "games" ? "Math games" : item === "support" ? "Support & suggestions" : item[0].toUpperCase() + item.slice(1)}</label>`).join("")}</div></div></form>`,
    footer: '<span class="muted" style="font-size:9px">Ranks cannot grant owner or desktop access.</span><div class="dialog-footer-right"><button class="secondary-button" data-close-dialog type="button">Cancel</button><button id="save-rank" class="primary-button" type="button">Save rank</button></div>',
  });
  $("[data-close-dialog]").addEventListener("click", closeDialog);
  const form = $("#rank-form");
  $$('input[name="permission"]', form).forEach((permission) => permission.addEventListener("change", () => {
    $$('input[name="feature"]', form).forEach((feature) => {
      if (feature.value === permission.value && !permission.checked) feature.checked = false;
    });
  }));
  $("#save-rank").addEventListener("click", async () => {
    if (!form.reportValidity()) return;
    const permissions = $$('input[name="permission"]:checked', form).map((item) => item.value);
    const features = $$('input[name="feature"]:checked', form).map((item) => item.value);
    try {
      await api("/api/admin/ranks", { method: "POST", body: { label: form.elements.label.value.trim(), permissions, features } });
      closeDialog();
      await loadTokens();
      toast("Access rank created.");
    } catch (error) { toast(error.message); }
  });
}

async function deleteRank(id) {
  if (!confirm("Remove this rank from future invitation choices? Existing accounts keep their current permissions.")) return;
  try {
    await api(`/api/admin/ranks/${id}`, { method: "DELETE" });
    await loadTokens();
    toast("Access rank removed.");
  } catch (error) { toast(error.message); }
}

function inviteForm() {
  const defaultRank = state.ranks.find((rank) => rank.id === "without-ai") ?? state.ranks.find((rank) => rank.id === "standard") ?? state.ranks[0];
  const accountOptions = state.accounts.filter((account) => !account.revokedAt).map((account) => `<option value="${esc(account.id)}">${esc(account.label)} · ${esc(account.id.slice(0, 8))}</option>`).join("");
  const rankOptions = `<option value="">Use saved account permissions</option>${state.ranks.map((rank) => `<option value="${esc(rank.id)}" ${rank.id === defaultRank?.id ? "selected" : ""}>${esc(rank.label)} · ${rank.features.includes("assistant") ? "AI enabled" : "No AI"}</option>`).join("")}`;
  return `<form id="invite-form" class="admin-invite-form">
    <label class="form-field"><span class="field-label">Token label</span><input class="field-input" name="label" maxlength="80" required placeholder="e.g. Guest · laptop"></label>
    <label class="form-field"><span class="field-label">Account</span><select class="field-select" name="accountId"><option value="">Create a new account</option>${accountOptions}</select></label>
    <label class="form-field"><span class="field-label">Access rank</span><select class="field-select" name="rank">${rankOptions}</select></label>
    <label class="form-field wide-field"><span class="field-label">Account label</span><input class="field-input" name="accountLabel" maxlength="80" placeholder="Defaults to token label"></label>
    <label class="form-field"><span class="field-label">Expiration (optional)</span><input class="field-input" name="expiresAt" type="datetime-local"></label>
    <div class="form-field"><span class="field-label">Redemption limit</span><div class="permission-note"><span class="note-icon">${icon("shield")}</span><span>One sign-in. A secure cookie keeps the intended person signed in.</span></div><input name="usageLimit" type="hidden" value="1"></div>
    <div class="form-field wide-field"><span class="subsection-label">Permissions</span><div class="check-grid">
      <label class="check-option"><input type="checkbox" name="permission" value="browse" checked disabled> Browse (required)</label>
      <label class="check-option"><input type="checkbox" name="permission" value="bookmarks" checked> Bookmarks</label>
      <label class="check-option"><input type="checkbox" name="permission" value="history" checked> History</label>
      <label class="check-option"><input type="checkbox" name="permission" value="settings" checked> Settings</label>
      <label class="check-option"><input type="checkbox" name="permission" value="assistant" checked> Local AI assistant</label>
      <label class="check-option"><input type="checkbox" name="permission" value="games" checked> Math games</label>
      <label class="check-option"><input type="checkbox" name="permission" value="support" checked> Support and suggestions</label>
    </div></div>
    <div class="form-field wide-field"><span class="subsection-label">Account features</span><div class="check-grid">
      <label class="check-option"><input type="checkbox" name="feature" value="bookmarks" checked> Bookmarks</label>
      <label class="check-option"><input type="checkbox" name="feature" value="history" checked> History</label>
      <label class="check-option"><input type="checkbox" name="feature" value="settings" checked> Settings</label>
      <label class="check-option"><input type="checkbox" name="feature" value="assistant" checked> Local AI assistant</label>
      <label class="check-option"><input type="checkbox" name="feature" value="games" checked> Math games</label>
      <label class="check-option"><input type="checkbox" name="feature" value="support" checked> Support and suggestions</label>
    </div></div>
    <div class="form-field"><span class="field-label">Theme</span><select class="field-select" name="theme"><option value="dark">Dark</option><option value="light">Light</option><option value="system">Follow system</option></select></div>
    <div class="form-field"><span class="field-label">Accent</span><input class="field-input" name="accent" type="color" value="#ff7048"></div>
    <div class="form-field"><span class="field-label">Homepage</span><select class="field-select" name="homepageType"><option value="home">Nightjar start page</option><option value="blank">Blank page</option><option value="custom">Custom address</option></select></div>
    <label class="form-field wide-field custom-home-field" hidden><span class="field-label">Custom homepage address</span><input class="field-input" name="homepage" type="url" placeholder="https://example.com"></label>
    <div class="form-field"><span class="field-label">Search provider</span><select class="field-select" name="searchProvider"><option value="duckduckgo">DuckDuckGo</option><option value="brave">Brave Search</option><option value="bing">Bing</option><option value="google">Google</option><option value="yandex">Yandex</option></select></div>
    <div class="form-field"><span class="field-label">Interface density</span><select class="field-select" name="density"><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="spacious">Spacious</option></select></div>
    <div class="form-field wide-field"><span class="subsection-label">Privacy and appearance defaults</span><div class="check-grid">
      <label class="check-option"><input type="checkbox" name="customCursor" checked> Custom cursor</label>
      <label class="check-option"><input type="checkbox" name="suppressReferrer" checked> Suppress referrers</label>
      <label class="check-option"><input type="checkbox" name="clearOnExit"> Clear on sign-out</label>
    </div></div>
  </form>`;
}

function createInviteDialog() {
  openDialog({
    title: "Create invitation",
    description: "The random token is displayed once. Copy it now and share it securely.",
    wide: true,
    content: inviteForm(),
    footer: '<span class="muted" style="font-size:9px">No raw invitation token is stored.</span><div class="dialog-footer-right"><button class="secondary-button" data-close-dialog type="button">Cancel</button><button id="issue-invite" class="primary-button" type="button">Create token</button></div>',
  });
  const form = $("#invite-form");
  const accountSelect = form.elements.accountId;
  form.elements.homepageType.addEventListener("change", () => {
    $(".custom-home-field", form).hidden = form.elements.homepageType.value !== "custom";
  });
  accountSelect.addEventListener("change", () => {
    const account = state.accounts.find((item) => item.id === accountSelect.value);
    const settings = account?.settings ?? {
      theme: "dark", accent: "#ff7048", density: "comfortable", homepage: "home",
      searchProvider: "duckduckgo", customCursor: true,
      privacy: { suppressReferrer: true, clearOnExit: false },
    };
    form.elements.accountLabel.value = account?.label ?? "";
    form.elements.rank.value = account && state.ranks.some((rank) => rank.id === account.rank)
      ? account.rank
      : account ? "" : defaultRank?.id ?? "";
    form.elements.theme.value = settings.theme;
    form.elements.accent.value = settings.accent;
    const homeType = ["home", "blank"].includes(settings.homepage) ? settings.homepage : "custom";
    form.elements.homepageType.value = homeType;
    form.elements.homepage.value = homeType === "custom" ? settings.homepage : "";
    $(".custom-home-field", form).hidden = homeType !== "custom";
    form.elements.searchProvider.value = settings.searchProvider;
    form.elements.density.value = settings.density;
    form.elements.customCursor.checked = settings.customCursor;
    form.elements.suppressReferrer.checked = settings.privacy?.suppressReferrer ?? true;
    form.elements.clearOnExit.checked = settings.privacy?.clearOnExit ?? false;
    $$('input[name="permission"]', form).forEach((input) => {
      input.checked = input.value === "browse" || (account?.permissions ?? ["browse", "bookmarks", "history", "settings", "games", "support"]).includes(input.value);
    });
    $$('input[name="feature"]', form).forEach((input) => {
      input.checked = (account?.features ?? ["bookmarks", "history", "settings", "games", "support"]).includes(input.value);
    });
  });
  form.elements.rank.addEventListener("change", () => {
    const rank = state.ranks.find((item) => item.id === form.elements.rank.value);
    if (!rank) return;
    $$('input[name="permission"]', form).forEach((input) => { input.checked = input.value === "browse" || rank.permissions.includes(input.value); });
    $$('input[name="feature"]', form).forEach((input) => { input.checked = rank.features.includes(input.value); });
  });
  form.elements.rank.dispatchEvent(new Event("change"));
  $("[data-close-dialog]").addEventListener("click", closeDialog);
  $("#issue-invite").addEventListener("click", async () => {
    if (!form.reportValidity()) return;
    const expiresAt = form.elements.expiresAt.value ? new Date(form.elements.expiresAt.value).toISOString() : "";
    const permissions = $$('input[name="permission"]:checked', form).map((input) => input.value);
    const features = $$('input[name="feature"]:checked', form).map((input) => input.value);
    const settings = {
      theme: form.elements.theme.value,
      accent: form.elements.accent.value,
      density: form.elements.density.value,
      homepage: form.elements.homepageType.value === "custom" ? form.elements.homepage.value.trim() : form.elements.homepageType.value,
      searchProvider: form.elements.searchProvider.value,
      customCursor: form.elements.customCursor.checked,
      privacy: { suppressReferrer: form.elements.suppressReferrer.checked, clearOnExit: form.elements.clearOnExit.checked },
    };
    const body = {
      label: form.elements.label.value.trim(),
      accountLabel: form.elements.accountLabel.value.trim(),
      accountId: accountSelect.value,
      expiresAt,
      usageLimit: form.elements.usageLimit.value,
      rank: form.elements.rank.value,
      permissions,
      features,
      settings,
    };
    try {
      const result = await api("/api/admin/tokens", { method: "POST", body });
      await loadTokens();
      showToken(result.token, result.item);
    } catch (error) {
      toast(error.message);
    }
  });
}

function showToken(token, item) {
  openDialog({
    title: "Invitation created",
    description: `For ${item.accountLabel}. This token will not be shown again.`,
    content: `<div class="permission-note"><span class="note-icon">${icon("shield")}</span><span>Keep this one-time invitation private and share it only with its intended person. After redemption, their browser is authenticated with a secure session cookie. A second valid invitation used while the account is active will revoke that account's access.</span></div><div class="token-reveal"><code id="issued-token" class="mono">${esc(token)}</code><button id="copy-token" class="icon-button" type="button" aria-label="Copy invitation token" title="Copy token">${icon("copy")}</button></div><p class="muted" style="font-size:9px;line-height:1.6">The database stores only the token hash. The owner console cannot retrieve this value later.</p>`,
    footer: '<span class="muted" style="font-size:9px">Copy before closing.</span><div class="dialog-footer-right"><button id="done-token" class="primary-button" type="button">Done</button></div>',
  });
  $("#copy-token").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(token);
      toast("Invitation copied.");
    } catch {
      const selection = new Range();
      selection.selectNodeContents($("#issued-token"));
      const rangeSelection = getSelection();
      rangeSelection?.removeAllRanges();
      rangeSelection?.addRange(selection);
      toast("Select and copy the highlighted invitation.");
    }
  });
  $("#done-token").addEventListener("click", closeDialog);
}

async function revokeToken(id) {
  if (!confirm("Revoke this invitation and terminate its active session?")) return;
  try {
    await api(`/api/admin/tokens/${id}/revoke`, { method: "POST", body: {} });
    await loadTokens();
    await loadOverview();
    toast("Invitation revoked.");
  } catch (error) { toast(error.message); }
}

async function terminateSession(id) {
  if (!confirm("Terminate this account session? The user will need a valid invitation to sign in again.")) return;
  try {
    await api(`/api/admin/sessions/${id}/terminate`, { method: "POST", body: {} });
    await loadSessions();
    await loadOverview();
    toast("Session terminated.");
  } catch (error) { toast(error.message); }
}

async function lockConsole() {
  if (state.desktopSession) await stopDesktop(true);
  try {
    await api("/api/admin/logout", { method: "POST", body: {} });
  } catch (error) {
    toast(error.message);
  }
  state.csrf = "";
  showLogin();
}

async function bootstrap() {
  try {
    const result = await api("/api/admin/me");
    state.csrf = result.csrf;
    state.twoFactor = result.twoFactorEnabled;
    showConsole();
    await Promise.all([loadOverview(), loadTokens(), loadSessions(), loadSiteControls()]);
    setInterval(async () => {
      try {
        const refreshed = await api("/api/admin/me");
        state.csrf = refreshed.csrf;
        state.twoFactor = refreshed.twoFactorEnabled;
        await loadOverview();
      } catch {
        state.csrf = "";
        showLogin("Your administrator session has ended. Sign in again.");
      }
    }, 25_000);
  } catch {
    showLogin();
  }
}

$("#admin-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("button[type=submit]", event.currentTarget);
  button.disabled = true;
  $("#admin-login-error").hidden = true;
  try {
    const result = await api("/api/admin/login", {
      method: "POST",
      body: { password: $("#admin-password").value, totp: $("#admin-totp").value },
    });
    state.csrf = result.csrf;
    await bootstrap();
  } catch (error) {
    $("#admin-login-error").textContent = error.message;
    $("#admin-login-error").hidden = false;
  } finally {
    button.disabled = false;
  }
});

$$(".rail-item[data-panel]").forEach((button) => button.addEventListener("click", () => setPanel(button.dataset.panel)));
$$("[data-go-panel]").forEach((button) => button.addEventListener("click", () => setPanel(button.dataset.goPanel)));
$("#create-invite").addEventListener("click", createInviteDialog);
$("#create-rank").addEventListener("click", createRankDialog);
$("#refresh-tokens").addEventListener("click", () => void loadTokens().catch((error) => toast(error.message)));
$("#refresh-accounts").addEventListener("click", () => void loadTokens().catch((error) => toast(error.message)));
$("#refresh-sessions").addEventListener("click", () => void loadSessions().catch((error) => toast(error.message)));
$("#refresh-feedback").addEventListener("click", () => void loadFeedback().catch((error) => toast(error.message)));
$("#refresh-audit").addEventListener("click", () => void api("/api/admin/audit?limit=100").then((result) => { state.audits = result.items; renderAudit(); }).catch((error) => toast(error.message)));
$("#save-site-controls").addEventListener("click", () => void saveSiteControls());
$("#desktop-pair").addEventListener("click", () => void pairDesktop());
$("#desktop-start").addEventListener("click", () => void startDesktopSharing());
$("#desktop-enable-input").addEventListener("click", () => void enableDesktopInput());
$("#desktop-stop").addEventListener("click", () => void stopDesktop());
$("#desktop-frame").addEventListener("pointerdown", clickDesktopFrame);
$("#desktop-send-key").addEventListener("click", () => void sendDesktopInput({ action: "key", key: $("#desktop-key").value }));
$("#desktop-send-text").addEventListener("click", () => {
  const input = $("#desktop-text");
  if (!input.value) return;
  void sendDesktopInput({ action: "type", text: input.value }).then(() => { input.value = ""; });
});
$("#admin-logout").addEventListener("click", () => void lockConsole());
void bootstrap();
