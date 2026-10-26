const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const iconPaths = {
  back: '<path d="m15 18-6-6 6-6"/><path d="M20 12H9"/>',
  forward: '<path d="m9 18 6-6-6-6"/><path d="M4 12h11"/>',
  reload: '<path d="M20 7v5h-5"/><path d="M20 12a8 8 0 1 1-2.3-5.7L20 9"/>',
  home: '<path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/>',
  bookmark: '<path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4Z"/>',
  bookmarkFill: '<path d="M7.5 3A1.5 1.5 0 0 0 6 4.5V21l6-4 6 4V4.5A1.5 1.5 0 0 0 16.5 3Z" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  close: '<path d="m18 6-12 12"/><path d="m6 6 12 12"/>',
  eye: '<path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.4"/>',
  eyeOff: '<path d="m3 3 18 18"/><path d="M10.6 6.2A9 9 0 0 1 12 6c6.1 0 9.5 6 9.5 6a15 15 0 0 1-3.1 3.7"/><path d="M6.2 6.8C3.8 8.4 2.5 12 2.5 12s3.4 6 9.5 6a9 9 0 0 0 3.3-.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  bookmarkList: '<path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4Z"/>',
  history: '<path d="M3 12a9 9 0 1 0 2.64-6.36L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
  settings: '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="m19.4 15 .1.1a1.8 1.8 0 0 1-2.5 2.5l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.8 1.8 0 0 1-3.6 0v-.2A1.7 1.7 0 0 0 7.5 17l-.1.1a1.8 1.8 0 0 1-2.5-2.5l.1-.1A1.7 1.7 0 0 0 3.8 12.6h-.2a1.8 1.8 0 0 1 0-3.6h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.8 1.8 0 0 1 2.5-2.5l.1.1a1.7 1.7 0 0 0 2.9-1.2v-.2a1.8 1.8 0 0 1 3.6 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.8 1.8 0 0 1 2.5 2.5l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.8 1.8 0 0 1 0 3.6h-.2a1.7 1.7 0 0 0-1.2 2.9Z" transform="translate(1.3 1.3) scale(.89)"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/><path d="M12 14v3"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>',
  trash: '<path d="M4 7h16"/><path d="m7 7 .7 13h8.6L17 7"/><path d="M9 7V4h6v3"/><path d="M10 10v7M14 10v7"/>',
  more: '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
  shield: '<path d="M12 22s8-3.8 8-10V5l-8-3-8 3v7c0 6.2 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 1 1 4.1 1.9c-1 .8-1.7 1.2-1.7 2.6"/><path d="M12 17h.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>',
  moon: '<path d="M20.4 15.4A8.5 8.5 0 0 1 8.6 3.6 8.5 8.5 0 1 0 20.4 15.4Z"/>',
  games: '<path d="M6 8h12a4 4 0 0 1 3.8 5.3l-1.3 4a2.5 2.5 0 0 1-4.3 1l-1.1-1.3h-5l-1.1 1.3a2.5 2.5 0 0 1-4.3-1l-1.3-4A4 4 0 0 1 6 8Z"/><path d="M8 11v4m-2-2h4m5-1h.01M18 14h.01"/>',
};
const svg = (name, size = 16) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${iconPaths[name] ?? ""}</svg>`;
const icons = {
  "#back": "back", "#forward": "forward", "#reload": "reload", "#home": "home", "#bookmark-current": "bookmark",
  "#new-tab": "plus", "#signout": "external", "#bookmarks-open": "bookmarkList", "#history-open": "history",
  "#downloads-open": "download", "#assistant-open": "search", "#games-open": "games", "#open-regular": "external", "#settings-open": "settings", "#help-open": "help", ".admin-link": "settings", "#toggle-token": "eye",
  ".shield-icon": "shield", "#address-security": "lock", ".search-glyph": "search",
};
for (const [selector, name] of Object.entries(icons)) {
  const element = $(selector);
  if (element) element.innerHTML = svg(name, 16);
}

const defaults = {
  theme: "dark",
  accent: "#ff7048",
  density: "comfortable",
  homepage: "home",
  searchProvider: "duckduckgo",
  customCursor: true,
  customTitle: "",
  customIcon: "",
  toolbarOrder: ["bookmarks-open", "history-open", "downloads-open", "assistant-open", "games-open", "open-regular", "theme-toggle", "settings-open", "help-open", "admin-link"],
  privacy: { suppressReferrer: true, clearOnExit: false },
};
const state = {
  account: null,
  csrf: "",
  tabs: [],
  activeId: null,
  closed: [],
  settings: { ...defaults, privacy: { ...defaults.privacy } },
  bookmarks: [],
  projectAreas: [],
  capabilities: null,
  assistantConversation: [],
  assistantBusy: false,
  assistantAbort: null,
  heartbeatTimer: null,
  pageTimer: null,
  toastTimer: null,
  cursor: { x: -20, y: -20, active: false },
  pageLoading: false,
  pageFrameRequestedUrl: "",
  proxyOrigin: "",
  proxySessionId: "",
  proxyReady: false,
  gameTimer: 0,
  game: null,
};
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const coarsePointer = matchMedia("(pointer: coarse)");

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function originOf(address) {
  try {
    return new URL(address).hostname.replace(/^www\./, "");
  } catch {
    return address;
  }
}

function activeTab() {
  return state.tabs.find((tab) => tab.id === state.activeId) ?? null;
}

function getStorageKey(name) {
  return `nightjar.v1.${state.account?.id ?? "guest"}.${name}`;
}

function saveLocalState() {
  if (!state.account) return;
  try {
    localStorage.setItem(getStorageKey("tabs"), JSON.stringify({
      tabs: state.tabs.map(({ id, title, url, stack, index }) => ({ id, title, url, stack, index })),
      activeId: state.activeId,
      closed: state.closed.slice(0, 12),
    }));
  } catch {
    toast("This browser could not save your local tab session.");
  }
}

function loadLocalState() {
  try {
    const saved = JSON.parse(localStorage.getItem(getStorageKey("tabs")) ?? "{}");
    if (Array.isArray(saved.tabs) && saved.tabs.length) {
      state.tabs = saved.tabs.slice(0, 12).map((tab) => ({
        id: typeof tab.id === "string" ? tab.id : crypto.randomUUID(),
        title: typeof tab.title === "string" ? tab.title.slice(0, 90) : "New tab",
        url: typeof tab.url === "string" && /^https?:\/\//.test(tab.url) ? tab.url : "",
        stack: Array.isArray(tab.stack) ? tab.stack.filter((url) => typeof url === "string" && /^https?:\/\//.test(url)).slice(0, 50) : [],
        index: Number.isInteger(tab.index) ? Math.min(Math.max(tab.index, -1), 49) : -1,
      }));
      state.activeId = state.tabs.some((tab) => tab.id === saved.activeId) ? saved.activeId : state.tabs[0].id;
      state.closed = Array.isArray(saved.closed) ? saved.closed.slice(0, 12) : [];
    }
  } catch {
    localStorage.removeItem(getStorageKey("tabs"));
  }
  if (!state.tabs.length) createTab(false);
}

function applySettings() {
  const systemLight = matchMedia("(prefers-color-scheme: light)").matches;
  const theme = state.settings.theme === "system" ? (systemLight ? "light" : "dark") : state.settings.theme;
  const canCustomize = Boolean(state.account?.permissions.includes("settings") && state.account?.features.includes("settings"));
  document.body.dataset.theme = theme;
  document.body.dataset.density = state.settings.density;
  document.documentElement.style.setProperty("--accent", state.settings.accent);
  const custom = state.settings.customCursor && !reducedMotion.matches && !coarsePointer.matches;
  document.body.dataset.customCursor = custom ? "true" : "false";
  document.body.dataset.nativeCursor = custom ? "false" : "true";
  $("#page-frame").referrerPolicy = state.settings.privacy.suppressReferrer ? "no-referrer" : "strict-origin-when-cross-origin";
  const toolbar = $("#toolbar-tools");
  const toolbarOrder = canCustomize && Array.isArray(state.settings.toolbarOrder)
    ? state.settings.toolbarOrder
    : defaults.toolbarOrder;
  for (const id of toolbarOrder) {
    const item = document.getElementById(id);
    if (item?.parentElement === toolbar) toolbar.append(item);
  }
  for (const item of $$("[data-movable-toolbar-item]", toolbar)) {
    item.draggable = Boolean(state.account?.features.includes("settings") && state.account?.permissions.includes("settings"));
  }
  const iconLink = $('link[rel="icon"]');
  if (iconLink) {
    const customIcon = canCustomize ? state.settings.customIcon?.trim() : "";
    if (customIcon) {
      const safeText = customIcon.replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]);
      iconLink.href = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${state.settings.accent}"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-size="44">${safeText}</text></svg>`)}`;
    } else {
      iconLink.href = "/mark.svg";
    }
  }
  document.title = (canCustomize ? state.settings.customTitle?.trim() : "") || (state.account ? `Nightjar — ${state.account.label}` : "Nightjar");
  const toggle = $("#theme-toggle");
  if (toggle) {
    const nextTheme = { dark: "light", light: "system", system: "dark" }[state.settings.theme] ?? "light";
    toggle.innerHTML = svg(theme === "dark" ? "moon" : "sun");
    const nextLabel = nextTheme === "system" ? "follow system" : nextTheme;
    toggle.setAttribute("aria-label", `Set appearance to ${nextLabel}; current appearance is ${state.settings.theme}`);
    toggle.title = `Set appearance to ${nextLabel}`;
  }
}

function toast(message, duration = 2600) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => element.classList.remove("visible"), duration);
}

function setStatus(message) {
  $("#status-message").textContent = message;
}

function setLoading(loading) {
  state.pageLoading = loading;
  const indicator = $("#load-indicator");
  indicator.classList.toggle("loading", loading);
  $("#reload").innerHTML = loading ? svg("close") : svg("reload");
  $("#reload").setAttribute("aria-label", loading ? "Stop loading" : "Reload");
  $("#reload").title = loading ? "Stop loading" : "Reload (Ctrl+R)";
  $("#cursor-orb")?.classList.toggle("loading", loading);
}

function createTab(activate = true, initialUrl = "") {
  const tab = { id: crypto.randomUUID(), title: state.settings?.homepage === "blank" ? "Blank page" : "New tab", url: "", stack: [], index: -1 };
  const homepage = state.settings?.homepage;
  if (!initialUrl && homepage && !["home", "blank"].includes(homepage)) initialUrl = homepage;
  state.tabs.push(tab);
  if (initialUrl) {
    tab.url = initialUrl;
    tab.stack.push(initialUrl);
    tab.index = 0;
  }
  if (state.tabs.length > 12) {
    const removed = state.tabs.shift();
    if (removed.id === state.activeId) state.activeId = state.tabs[0]?.id;
  }
  if (activate) selectTab(tab.id);
  else if (!state.activeId) state.activeId = tab.id;
  saveLocalState();
  renderTabs();
  if (initialUrl && activate) void navigate(initialUrl, { replace: true, tab });
  return tab;
}

function renderTabs() {
  const strip = $("#tab-strip");
  strip.replaceChildren();
  for (const tab of state.tabs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tab${tab.id === state.activeId ? " active" : ""}`;
    button.role = "tab";
    button.setAttribute("aria-selected", tab.id === state.activeId ? "true" : "false");
    button.title = tab.url || "New tab";
    button.dataset.tabId = tab.id;
    button.innerHTML = `<span class="tab-favicon">${svg("shield", 14)}</span><span class="tab-title">${escapeHtml(tab.title)}</span><span class="tab-close icon-button" role="button" tabindex="0" aria-label="Close tab" data-close-tab="${tab.id}">${svg("close", 13)}</span>`;
    strip.append(button);
  }
  $("#back").disabled = !activeTab() || activeTab().index <= 0;
  $("#forward").disabled = !activeTab() || activeTab().index >= activeTab().stack.length - 1;
  updateBookmarkButton();
}

function updateBookmarkButton() {
  const tab = activeTab();
  const saved = Boolean(tab?.url && state.bookmarks.some((item) => item.url === tab.url));
  $("#bookmark-current").classList.toggle("saved", saved);
  $("#bookmark-current").innerHTML = svg(saved ? "bookmarkFill" : "bookmark");
  $("#bookmark-current").setAttribute("aria-label", saved ? "Remove bookmark" : "Bookmark this page");
}

function postProxy(message) {
  if (!state.proxyOrigin || !$("#page-frame").contentWindow) return;
  $("#page-frame").contentWindow.postMessage(message, state.proxyOrigin);
}

async function prepareProxyShell() {
  try {
    const result = await api("/api/browser/grant", { method: "POST", body: {} });
    if (!/^https?:\/\/[^/]+$/.test(result.proxyOrigin)) throw new Error("The private browsing engine returned an invalid origin.");
    state.proxyOrigin = result.proxyOrigin;
    if (!/^[a-f0-9]{32}$/i.test(result.sessionId)) throw new Error("The Rammerhead engine returned an invalid session.");
    state.proxySessionId = result.sessionId;
    state.proxyReady = false;
    const frame = $("#page-frame");
    const shellUrl = `${state.proxyOrigin}/proxy-shell.html`;
    if (frame.src !== shellUrl) frame.src = shellUrl;
  } catch (error) {
    toast(error.message);
    setStatus("Private browsing engine unavailable");
    $("#page-fallback").hidden = false;
  }
}

window.addEventListener("message", (event) => {
  const frame = $("#page-frame");
  if (event.source !== frame.contentWindow || event.origin !== state.proxyOrigin || event.data?.source !== "nightjar-proxy") return;
  if (event.data.type === "nightjar:ready") {
    if (!state.proxySessionId) {
      void api("/api/browser/grant", { method: "POST", body: {} }).then((result) => {
        if (!/^https?:\/\/[^/]+$/.test(result.proxyOrigin) || result.proxyOrigin !== state.proxyOrigin) {
          throw new Error("The private browsing engine returned an invalid origin.");
        }
        if (!/^[a-f0-9]{32}$/i.test(result.sessionId)) throw new Error("The Rammerhead engine returned an invalid session.");
        state.proxySessionId = result.sessionId;
        postProxy({ type: "nightjar:init", sessionId: state.proxySessionId, appOrigin: location.origin });
      }).catch((error) => {
        toast(error.message);
        setStatus("Private browsing engine unavailable");
      });
      return;
    }
    postProxy({ type: "nightjar:init", sessionId: state.proxySessionId, appOrigin: location.origin });
  } else if (event.data.type === "nightjar:initialized") {
    state.proxyReady = true;
    state.proxySessionId = "";
    const tab = activeTab();
    if (tab?.url) {
      postProxy({ type: "nightjar:select", tabId: tab.id, url: tab.url });
      setStatus(`Opening ${originOf(tab.url)} · private browsing engine`);
    } else {
      setStatus("Private browsing engine ready");
    }
  } else if (event.data.type === "nightjar:url") {
    const tab = state.tabs.find((item) => item.id === event.data.tabId);
    if (!tab || typeof event.data.url !== "string" || !/^https?:\/\//.test(event.data.url)) return;
    if (tab.url !== event.data.url) {
      tab.stack = tab.stack.slice(0, tab.index + 1);
      tab.stack.push(event.data.url);
      tab.index = tab.stack.length - 1;
      tab.url = event.data.url;
      tab.title = typeof event.data.title === "string" ? event.data.title.slice(0, 90) : originOf(tab.url);
      if (tab.id === state.activeId) {
        $("#address").value = tab.url;
        if (state.account.permissions.includes("history")) {
          api("/api/history", { method: "POST", body: { url: tab.url, title: tab.title } }).catch((error) => toast(error.message));
        }
      }
      renderTabs();
      saveLocalState();
    }
  } else if (event.data.type === "nightjar:loaded") {
    clearTimeout(state.pageTimer);
    setLoading(false);
    $("#page-fallback").hidden = true;
    const tab = state.tabs.find((item) => item.id === event.data.tabId);
    if (tab && typeof event.data.title === "string") {
      tab.title = event.data.title.slice(0, 90);
      renderTabs();
      saveLocalState();
      if (tab.id === state.activeId) setStatus(`Page loaded · ${originOf(tab.url)} · proxied web content`);
    }
  } else if (event.data.type === "nightjar:error") {
    setLoading(false);
    $("#page-fallback").hidden = false;
    setStatus("Private browsing engine error");
    toast(typeof event.data.message === "string" ? event.data.message : "The private browsing engine could not start.");
  }
});

async function syncBookmarkButton() {
  const tab = activeTab();
  if (!tab?.url || !state.account?.permissions.includes("bookmarks") || !state.account.features.includes("bookmarks")) return;
  try {
    const result = await api(`/api/bookmarks/contains?url=${encodeURIComponent(tab.url)}`);
    if (activeTab()?.id !== tab.id) return;
    state.bookmarks = state.bookmarks.filter((bookmark) => bookmark.url !== tab.url);
    if (result.bookmark) state.bookmarks.unshift(result.bookmark);
    updateBookmarkButton();
  } catch {
    // The current tab remains usable when the optional bookmark indicator cannot refresh.
  }
}

function selectTab(id) {
  const tab = state.tabs.find((item) => item.id === id);
  if (!tab) return;
  state.activeId = id;
  renderTabs();
  $("#address").value = tab.url;
  $("#page-fallback").hidden = true;
  if (tab.url) {
    $("#home-surface").hidden = true;
    $("#page-panel").hidden = false;
    state.pageFrameRequestedUrl = tab.url;
    if (state.proxyReady) postProxy({ type: "nightjar:select", tabId: tab.id, url: tab.url });
    $("#open-regular").hidden = false;
    setLoading(true);
    scheduleFallback(tab);
    setStatus(`Opening ${originOf(tab.url)} · private browsing engine`);
  } else {
    if (state.proxyReady) postProxy({ type: "nightjar:close", tabId: tab.id });
    $("#page-panel").hidden = true;
    $("#open-regular").hidden = true;
    const blank = tab.title === "Blank page" || state.settings.homepage === "blank";
    $("#home-surface").hidden = blank;
    setLoading(false);
    setStatus(blank ? "Blank page" : "Private workspace ready");
  }
  saveLocalState();
  renderTabs();
  if (tab.url) void syncBookmarkButton();
}

function scheduleFallback(tab) {
  clearTimeout(state.pageTimer);
  state.pageTimer = setTimeout(() => {
    if (activeTab()?.id !== tab.id || !tab.url) return;
    $("#page-fallback").hidden = false;
    setLoading(false);
    setStatus("The site may restrict embedded browsing");
  }, 9000);
}

async function navigate(address, { replace = false, tab = activeTab() } = {}) {
  if (!tab) return;
  const raw = address.trim();
  if (!raw) return;
  $("#address").blur();
  $("#home-query").blur();
  try {
    const result = await api(`/api/browser/resolve?q=${encodeURIComponent(raw)}`);
    const url = result.url;
    if (replace && tab.index >= 0) tab.stack[tab.index] = url;
    else {
      tab.stack = tab.stack.slice(0, tab.index + 1);
      tab.stack.push(url);
      tab.index = tab.stack.length - 1;
    }
    tab.url = url;
    tab.title = originOf(url);
    if (tab.id === state.activeId) {
      $("#address").value = url;
      $("#home-surface").hidden = true;
      $("#page-panel").hidden = false;
      $("#open-regular").hidden = false;
      $("#page-fallback").hidden = true;
      state.pageFrameRequestedUrl = url;
      if (state.proxyReady) postProxy({ type: "nightjar:navigate", tabId: tab.id, url });
      setLoading(true);
      setStatus(`Opening ${originOf(url)} · private browsing engine`);
      scheduleFallback(tab);
    }
    renderTabs();
    saveLocalState();
    if (state.account.permissions.includes("history")) {
      api("/api/history", { method: "POST", body: { url, title: tab.title } }).catch((error) => toast(error.message));
    }
    await refreshBookmarks(false);
  } catch (error) {
    toast(error.message);
    setStatus("Address could not be opened");
  }
}

function moveHistory(direction) {
  const tab = activeTab();
  if (!tab) return;
  const next = tab.index + direction;
  if (next < 0 || next >= tab.stack.length) return;
  tab.index = next;
  tab.url = tab.stack[next];
  tab.title = originOf(tab.url);
  saveLocalState();
  selectTab(tab.id);
}

function reloadPage() {
  const tab = activeTab();
  if (!tab?.url) return;
  $("#page-fallback").hidden = true;
  state.pageFrameRequestedUrl = tab.url;
  if (state.proxyReady) postProxy({ type: "nightjar:reload", tabId: tab.id });
  setLoading(true);
  setStatus(`Reloading ${originOf(tab.url)}`);
  scheduleFallback(tab);
}

function stopPageLoad() {
  if (!activeTab()?.url) return;
  clearTimeout(state.pageTimer);
  if (state.proxyReady) postProxy({ type: "nightjar:stop", tabId: activeTab().id });
  state.pageFrameRequestedUrl = "";
  $("#page-fallback").hidden = true;
  setLoading(false);
  setStatus("Page load stopped");
}

function closeTab(id) {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return;
  const [tab] = state.tabs.splice(index, 1);
  if (state.proxyReady) postProxy({ type: "nightjar:close", tabId: id });
  if (tab.url) state.closed.unshift({ title: tab.title, url: tab.url });
  state.closed = state.closed.slice(0, 12);
  if (!state.tabs.length) {
    state.activeId = null;
    createTab(true);
    return;
  }
  if (state.activeId === id) {
    const next = state.tabs[Math.min(index, state.tabs.length - 1)];
    state.activeId = next.id;
    selectTab(next.id);
  } else {
    renderTabs();
    saveLocalState();
  }
}

function showHome() {
  const homepage = state.settings.homepage;
  if (homepage === "home") {
    const tab = activeTab();
    if (tab) {
      tab.url = "";
      tab.title = "New tab";
      tab.stack = [];
      tab.index = -1;
      selectTab(tab.id);
    }
  } else if (homepage === "blank") {
    const tab = activeTab();
    if (tab) {
      tab.url = "";
      tab.title = "Blank page";
      tab.stack = [];
      tab.index = -1;
      selectTab(tab.id);
    }
  } else {
    void navigate(homepage, { replace: true });
  }
}

function applyDisplay(result) {
  state.account = result.account;
  state.csrf = result.csrf;
  state.settings = { ...defaults, ...result.account.settings, privacy: { ...defaults.privacy, ...(result.account.settings?.privacy ?? {}) } };
  $("#signin").hidden = true;
  $("#browser").hidden = false;
  $("#account-label").textContent = state.account.label;
  $(".avatar").textContent = state.account.label.slice(0, 1).toUpperCase();
  applySettings();
  applyAccountFeatures();
  $("#home-date").textContent = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date());
  loadLocalState();
  void loadProjectAreas();
  void refreshBookmarks();
  void refreshCapabilities();
  if (!state.heartbeatTimer) state.heartbeatTimer = setInterval(() => heartbeat(), 25_000);
  renderTabs();
  if (activeTab()) selectTab(activeTab().id);
  void prepareProxyShell();
  document.title = `Nightjar — ${state.account.label}`;
}

function applyAccountFeatures() {
  const permits = (feature) => state.account?.permissions.includes(feature)
    && (feature === "browse" || state.account.features.includes(feature));
  $("#bookmarks-open").hidden = !permits("bookmarks");
  $("#history-open").hidden = !permits("history");
  $("#settings-open").hidden = !permits("settings");
  $("#theme-toggle").hidden = !permits("settings");
  $("#bookmark-current").hidden = !permits("bookmarks");
  $("#games-open").hidden = !permits("games");
  $("#admin-link").hidden = state.account?.rank !== "owner";
}

async function saveToolbarOrder(order) {
  const previous = state.settings.toolbarOrder;
  state.settings.toolbarOrder = order;
  applySettings();
  try {
    const result = await api("/api/settings", { method: "PUT", body: { settings: state.settings } });
    state.settings = result.settings;
    state.account.settings = result.settings;
    applySettings();
  } catch (error) {
    state.settings.toolbarOrder = previous;
    applySettings();
    toast(error.message);
  }
}

const toolbarTools = $("#toolbar-tools");
let draggedToolbarItem = "";
toolbarTools.addEventListener("dragstart", (event) => {
  if (!state.account?.permissions.includes("settings") || !state.account.features.includes("settings")) return;
  const item = event.target.closest("[data-movable-toolbar-item]");
  if (!item) return;
  draggedToolbarItem = item.id;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", item.id);
});
toolbarTools.addEventListener("dragover", (event) => {
  if (draggedToolbarItem && event.target.closest("[data-movable-toolbar-item]")) event.preventDefault();
});
toolbarTools.addEventListener("drop", (event) => {
  const target = event.target.closest("[data-movable-toolbar-item]");
  const dragged = document.getElementById(draggedToolbarItem);
  if (!dragged || !target || dragged === target) return;
  event.preventDefault();
  const insertBefore = event.clientX < target.getBoundingClientRect().left + target.getBoundingClientRect().width / 2;
  toolbarTools.insertBefore(dragged, insertBefore ? target : target.nextSibling);
  const order = $$("[data-movable-toolbar-item]", toolbarTools).map((item) => item.id);
  draggedToolbarItem = "";
  void saveToolbarOrder(order);
});
toolbarTools.addEventListener("dragend", () => { draggedToolbarItem = ""; });

async function heartbeat() {
  try {
    const result = await api("/api/session");
    const hadAssistant = state.account?.permissions.includes("assistant") && state.account?.features.includes("assistant");
    state.account = result.account;
    state.settings = { ...defaults, ...result.account.settings, privacy: { ...defaults.privacy, ...(result.account.settings?.privacy ?? {}) } };
    state.csrf = result.csrf;
    applySettings();
    applyAccountFeatures();
    const hasAssistant = state.account.permissions.includes("assistant") && state.account.features.includes("assistant");
    if (hadAssistant !== hasAssistant) void refreshCapabilities();
    $("#connection-state").textContent = "Connected";
  } catch {
    $("#connection-state").textContent = "Reconnecting";
  }
}

async function api(path, options = {}) {
  const method = options.method ?? "GET";
  const headers = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (!["GET", "HEAD"].includes(method) && state.csrf) headers["X-NJ-CSRF"] = state.csrf;
  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new Error("Nightjar could not reach the local service. Check the connection and try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && state.account) signOut(false);
    throw new Error(data.error ?? "The request could not be completed.");
  }
  return data;
}

async function refreshBookmarks(showErrors = true) {
  if (!state.account?.permissions.includes("bookmarks") || !state.account.features.includes("bookmarks")) {
    state.bookmarks = [];
    $("#bookmark-bar").replaceChildren();
    renderQuickLinks();
    return;
  }
  try {
    const result = await api("/api/bookmarks?limit=100");
    state.bookmarks = result.items;
    renderBookmarkBar();
    updateBookmarkButton();
    void syncBookmarkButton();
  } catch (error) {
    if (showErrors) toast(error.message);
  }
}

function renderBookmarkBar() {
  const bar = $("#bookmark-bar");
  bar.replaceChildren();
  for (const item of state.bookmarks.slice(0, 8)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bookmark-shortcut";
    button.title = item.url;
    button.innerHTML = `<span style="color:var(--accent)">${svg("bookmark", 12)}</span><span>${escapeHtml(item.title)}</span>`;
    button.addEventListener("click", () => void navigate(item.url));
    bar.append(button);
  }
  renderQuickLinks();
}

function renderQuickLinks() {
  const root = $("#quick-links");
  if (!root) return;
  root.replaceChildren();
  for (const item of state.bookmarks.slice(0, 5)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "quick-link";
    button.title = item.url;
    button.innerHTML = `<span class="quick-link-icon">${escapeHtml(originOf(item.url).slice(0, 1).toUpperCase())}</span><span>${escapeHtml(item.title)}</span>`;
    button.addEventListener("click", () => void navigate(item.url));
    root.append(button);
  }

  function renderProjectAreas() {
    const root = $("#project-area-list");
    if (!state.projectAreas.length) {
      root.innerHTML = '<p class="project-area-empty">No project areas yet. Add one for your Proxy, games, or another project.</p>';
      return;
    }
    root.innerHTML = state.projectAreas.map((area) => `<article class="project-area-item"><div class="project-area-icon">${area.kind === "games" ? svg("games", 16) : svg("external", 16)}</div><div class="project-area-copy"><strong>${escapeHtml(area.label)}</strong><span>${escapeHtml(area.kind)} · private to your account</span></div><div class="project-area-actions"><button class="text-button" type="button" data-edit-project-area="${area.id}">Rename</button><button class="text-button danger-text" type="button" data-delete-project-area="${area.id}">Remove</button></div></article>`).join("");
    $$("[data-edit-project-area]", root).forEach((button) => button.addEventListener("click", () => {
      const area = state.projectAreas.find((item) => item.id === button.dataset.editProjectArea);
      if (area) openProjectAreaDialog(area);
    }));
    $$("[data-delete-project-area]", root).forEach((button) => button.addEventListener("click", () => void deleteProjectArea(button.dataset.deleteProjectArea)));
  }

  async function loadProjectAreas() {
    try {
      const result = await api("/api/project-areas");
      state.projectAreas = result.items;
      renderProjectAreas();
    } catch (error) {
      $("#project-area-list").innerHTML = `<p class="project-area-empty">${escapeHtml(error.message)}</p>`;
    }
  }

  function openProjectAreaDialog(area = null) {
    const name = area?.name ?? "Proxy";
    openDialog({
      title: area ? "Edit project area" : "Add project area",
      subtitle: "Only you can view and manage areas belonging to your account.",
      content: `<form id="project-area-form" class="settings-grid"><label class="form-field"><span class="field-label">Area type</span><select class="field-select" name="kind"><option value="proxy">Proxy</option><option value="games">Games</option><option value="custom">Custom project</option></select></label><label class="form-field"><span class="field-label">Project name</span><input class="field-input" name="name" maxlength="50" required value="${escapeHtml(name)}"></label></form>`,
      footer: `<span class="muted" style="font-size:9px">Displayed as ${escapeHtml(state.account.label)}'s [project name].</span><div class="dialog-footer-right"><button class="secondary-button" data-close-dialog type="button">Cancel</button><button id="save-project-area" class="primary-button" type="button">Save area</button></div>`,
    });
    const form = $("#project-area-form");
    form.elements.kind.value = area?.kind ?? "proxy";
    form.elements.kind.addEventListener("change", () => {
      if (!area || ["Proxy", "games"].includes(form.elements.name.value)) {
        form.elements.name.value = form.elements.kind.value === "proxy" ? "Proxy" : form.elements.kind.value === "games" ? "games" : "";
      }
    });
    $("[data-close-dialog]").addEventListener("click", closeDialog);
    $("#save-project-area").addEventListener("click", async () => {
      if (!form.reportValidity()) return;
      const body = { kind: form.elements.kind.value, name: form.elements.name.value.trim() };
      try {
        await api(area ? `/api/project-areas/${area.id}` : "/api/project-areas", {
          method: area ? "PATCH" : "POST",
          body,
        });
        closeDialog();
        await loadProjectAreas();
        toast(area ? "Project area updated." : "Project area created.");
      } catch (error) { toast(error.message); }
    });
  }

  async function deleteProjectArea(id) {
    if (!confirm("Remove this private project area?")) return;
    try {
      await api(`/api/project-areas/${id}`, { method: "DELETE" });
      await loadProjectAreas();
      toast("Project area removed.");
    } catch (error) { toast(error.message); }
  }
}

async function refreshCapabilities() {
  try {
    state.capabilities = await api("/api/capabilities");
    const hasPermission = state.account?.permissions.includes("assistant") && state.account?.features.includes("assistant");
    $("#assistant-open").hidden = !hasPermission;
    $("#assistant-open").title = state.capabilities.ai.allowed && state.capabilities.ai.modelInstalled
      ? `Local AI · ${state.capabilities.ai.model}`
      : `Local AI · ${state.capabilities.ai.reason}`;
  } catch (error) {
    toast(error.message);
  }
}

function openDialog({ title, subtitle = "", content = "", footer = "", wide = false, onClose = null }) {
  closeDialog();
  const root = $("#overlay-root");
  root.innerHTML = `<div class="overlay-root" data-overlay><section class="dialog${wide ? " wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header class="dialog-header"><div class="dialog-heading"><h2 id="dialog-title">${escapeHtml(title)}</h2>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}</div><button class="icon-button dialog-close" type="button" aria-label="Close dialog">${svg("close", 15)}</button></header><div class="dialog-body">${content}</div>${footer ? `<footer class="dialog-footer">${footer}</footer>` : ""}</section></div>`;
  const overlay = $("[data-overlay]", root);
  $(".dialog-close", root).addEventListener("click", closeDialog);
  overlay.addEventListener("mousedown", (event) => { if (event.target === overlay) closeDialog(); });
  root._onClose = onClose;
  document.addEventListener("keydown", dialogEscape);
  $(".dialog-close", root).focus();
}

function closeDialog() {
  const root = $("#overlay-root");
  state.assistantAbort?.abort();
  state.assistantAbort = null;
  clearInterval(state.gameTimer);
  state.gameTimer = 0;
  if (root._onClose) root._onClose();
  root._onClose = null;
  root.replaceChildren();
  document.removeEventListener("keydown", dialogEscape);
}

function dialogEscape(event) {
  if (event.key === "Escape") closeDialog();
}

function fmtDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function emptyState(icon, title, description) {
  return `<div class="empty-state"><span class="empty-icon">${svg(icon, 16)}</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(description)}</p></div>`;
}

function skeletonList() {
  return `<div class="skeleton-list" aria-label="Loading"><span></span><span></span><span></span><span></span></div>`;
}

async function openBookmarks() {
  if (!state.account.permissions.includes("bookmarks") || !state.account.features.includes("bookmarks")) return toast("Bookmarks are not enabled for this account.");
  openDialog({ title: "Bookmarks", subtitle: "Your saved pages, stored privately with this account.", content: `<div id="bookmark-list">${skeletonList()}</div>` });
  try {
    const first = await api("/api/bookmarks?limit=50");
    state.bookmarks = first.items;
    renderBookmarkBar();
    const list = $("#bookmark-list");
    if (!first.items.length) {
      list.innerHTML = emptyState("bookmark", "Nothing saved yet", "Save a page with the bookmark icon in the address bar.");
      return;
    }
    list.innerHTML = `<table class="list-table"><thead><tr><th>PAGE</th><th>SAVED</th><th></th></tr></thead><tbody>${first.items.map(renderBookmarkRow).join("")}</tbody></table>${first.nextCursor ? '<button id="bookmark-more" class="secondary-button" type="button" style="margin-top:12px">Load older</button>' : ""}`;
    list.addEventListener("click", async (event) => {
      const open = event.target.closest("[data-open-url]");
      if (open) {
        closeDialog();
        void navigate(open.dataset.openUrl);
        return;
      }
      const remove = event.target.closest("[data-delete-bookmark]");
      if (remove) {
        try {
          await api(`/api/bookmarks/${remove.dataset.deleteBookmark}`, { method: "DELETE" });
          await openBookmarks();
          await refreshBookmarks(false);
        } catch (error) { toast(error.message); }
        return;
      }
      const more = event.target.closest("#bookmark-more");
      if (more && first.nextCursor) {
        more.disabled = true;
        try {
          const next = await api(`/api/bookmarks?limit=50&before=${encodeURIComponent(first.nextCursor)}`);
          list.querySelector("tbody").insertAdjacentHTML("beforeend", next.items.map(renderBookmarkRow).join(""));
          first.nextCursor = next.nextCursor;
          if (!next.nextCursor) more.remove();
          else more.disabled = false;
        } catch (error) { more.disabled = false; toast(error.message); }
      }
    });
  } catch (error) {
    const list = $("#bookmark-list");
    if (list) list.innerHTML = emptyState("bookmark", "Could not load bookmarks", error.message);
  }
}

function renderBookmarkRow(item) {
  return `<tr><td><button class="list-row-title list-link" data-open-url="${escapeHtml(item.url)}" type="button">${escapeHtml(item.title)}</button><div class="list-row-url">${escapeHtml(item.url)}</div></td><td class="list-row-time">${escapeHtml(fmtDate(item.createdAt))}</td><td><button class="icon-button list-action" data-delete-bookmark="${item.id}" aria-label="Remove bookmark" title="Remove bookmark">${svg("trash", 14)}</button></td></tr>`;
}

async function openHistory() {
  if (!state.account.permissions.includes("history") || !state.account.features.includes("history")) return toast("History is not enabled for this account.");
  const footer = `<span class="muted" style="font-size:9px">History is saved to this account.</span><div class="dialog-footer-right"><button id="clear-history" class="secondary-button" type="button">Clear history</button></div>`;
  openDialog({ title: "Browsing history", subtitle: "Pages opened in this workspace.", wide: true, content: `<div id="history-list">${skeletonList()}</div>`, footer });
  const populate = async (before = "") => {
    try {
      const url = `/api/history?limit=50${before ? `&before=${encodeURIComponent(before)}` : ""}`;
      const result = await api(url);
      const list = $("#history-list");
      if (!list) return;
      if (!result.items.length && !before) {
        list.innerHTML = emptyState("history", "No history yet", "Pages you visit in the workspace will appear here.");
        return;
      }
      const table = list.querySelector("tbody");
      const html = result.items.map((item) => `<tr><td><button class="list-row-title list-link" data-open-url="${escapeHtml(item.url)}" type="button">${escapeHtml(item.title)}</button><div class="list-row-url">${escapeHtml(item.url)}</div></td><td class="list-row-time">${escapeHtml(fmtDate(item.visitedAt))}</td><td><button class="icon-button list-action" data-delete-history="${item.id}" aria-label="Delete history entry" title="Delete history entry">${svg("trash", 14)}</button></td></tr>`).join("");
      if (table) table.insertAdjacentHTML("beforeend", html);
      else list.innerHTML = `<table class="list-table"><thead><tr><th>PAGE</th><th>VISITED</th><th></th></tr></thead><tbody>${html}</tbody></table>`;
      $$(".list-link", list).forEach((button) => button.addEventListener("click", () => { closeDialog(); void navigate(button.dataset.openUrl); }));
      $$("[data-delete-history]", list).forEach((button) => button.addEventListener("click", async () => {
        try {
          await api(`/api/history/${button.dataset.deleteHistory}`, { method: "DELETE" });
          button.closest("tr")?.remove();
        } catch (error) { toast(error.message); }
      }));
      if (result.nextCursor && !$("#history-more", list)) {
        const more = document.createElement("button");
        more.id = "history-more";
        more.className = "secondary-button";
        more.textContent = "Load older";
        more.style.marginTop = "12px";
        more.addEventListener("click", () => {
          more.remove();
          void populate(result.nextCursor);
        });
        list.append(more);
      }
    } catch (error) {
      const list = $("#history-list");
      if (list) list.innerHTML = emptyState("history", "Could not load history", error.message);
    }
  };
  void populate();
  $("#clear-history").addEventListener("click", async () => {
    if (!confirm("Permanently clear all browsing history for this account?")) return;
    try {
      await api("/api/history", { method: "DELETE" });
      $("#history-list").innerHTML = emptyState("history", "No history yet", "Browsing history was cleared.");
    } catch (error) { toast(error.message); }
  });
}

function openDownloads() {
  const info = state.capabilities?.downloads?.reason ?? "Integrated download tracking is not available in a web app.";
  openDialog({
    title: "Downloads",
    subtitle: "Host-browser downloads are outside this workspace.",
    content: `<div class="permission-note"><span class="note-icon">${svg("download", 15)}</span><span>${escapeHtml(info)} Download links that a site permits may still be handled by the browser you are using.</span></div>${emptyState("download", "No integrated downloads", "Nightjar does not monitor your device or pretend to manage files it cannot access.")}`,
  });
}

function renderAssistantMessages() {
  const container = $("#assistant-messages");
  if (!container) return;
  if (!state.assistantConversation.length) {
    container.innerHTML = `<div class="assistant-welcome"><div><span class="empty-icon">${svg("search", 16)}</span><strong>Think aloud, locally.</strong><p>This assistant runs through Ollama on this machine. It cannot read your tabs, files, credentials or control your desktop.</p></div></div>`;
    return;
  }
  container.innerHTML = state.assistantConversation.map((message) =>
    `<div class="chat-message ${message.role}">${escapeHtml(message.content)}</div>`).join("");
  container.scrollTop = container.scrollHeight;
}

function openAssistant() {
  if (!state.account.permissions.includes("assistant") || !state.account.features.includes("assistant")) {
    return toast("The local assistant is not enabled for this account.");
  }
  const ai = state.capabilities?.ai;
  const ready = Boolean(ai?.reachable && ai?.modelInstalled);
  const status = ready
    ? `Local model ready · ${ai.model}${ai.startedByApp ? " · service started by Nightjar" : " · existing local service"}`
    : `Waiting for local model · ${ai?.model ?? "qwen3:4b"}`;
  openDialog({
    title: "Local assistant",
    subtitle: "Your conversation stays on this machine.",
    wide: true,
    content: `<div class="assistant-dialog"><div class="assistant-status"><span class="status-dot" style="background:${ready ? "var(--green)" : "var(--accent)"}"></span><span>${escapeHtml(status)}</span>${ready ? "" : '<button id="ai-check" class="text-button" type="button">Check again</button>'}</div><div id="assistant-messages" class="assistant-messages"></div><p id="assistant-error" class="assistant-error" hidden></p><form id="assistant-form" class="assistant-composer"><textarea name="prompt" rows="1" maxlength="8000" aria-label="Message local assistant" placeholder="${ready ? "Ask a question…" : "Ollama is starting or the model is not installed…"}" ${ready ? "" : "disabled"}></textarea><button class="assistant-send" type="submit" aria-label="Send message" title="Send message" ${ready ? "" : "disabled"}>↑</button></form><div class="assistant-model-note">${escapeHtml(ai?.reason || "Requests go only to Ollama at 127.0.0.1:11434. No web search or tool access.")}</div></div>`,
    footer: `<span class="muted" style="font-size:9px">Conversation is not saved.</span><div class="dialog-footer-right"><button id="clear-assistant" class="secondary-button" type="button">Clear conversation</button><button class="secondary-button" data-close-dialog type="button">Close</button></div>`,
  });
  renderAssistantMessages();
  $("#ai-check")?.addEventListener("click", async () => {
    await refreshCapabilities();
    openAssistant();
  });
  $("[data-close-dialog]").addEventListener("click", closeDialog);
  $("#clear-assistant").addEventListener("click", () => {
    state.assistantConversation = [];
    renderAssistantMessages();
  });
  $("#assistant-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (state.assistantBusy) return;
    const prompt = event.currentTarget.elements.prompt.value.trim();
    if (!prompt) return;
    event.currentTarget.elements.prompt.value = "";
    void sendAssistantMessage(prompt);
  });
  $(".assistant-send", $("#assistant-form")).addEventListener("click", (event) => {
    if (!state.assistantBusy) return;
    event.preventDefault();
    state.assistantAbort?.abort();
  });
  $("textarea", $("#assistant-form")).focus();
}

async function sendAssistantMessage(prompt) {
  const errorNode = $("#assistant-error");
  const form = $("#assistant-form");
  if (!form) return;
  errorNode.hidden = true;
  state.assistantBusy = true;
  form.elements.prompt.disabled = true;
  const sendButton = $(".assistant-send", form);
  sendButton.textContent = "■";
  sendButton.setAttribute("aria-label", "Stop response");
  sendButton.title = "Stop response";
  const abort = new AbortController();
  state.assistantAbort = abort;
  const context = state.assistantConversation.slice(-18);
  state.assistantConversation.push({ role: "user", content: prompt });
  const answer = { role: "assistant", content: "" };
  state.assistantConversation.push(answer);
  renderAssistantMessages();
  try {
    const response = await fetch("/api/ai/chat", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal: abort.signal,
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", "X-NJ-CSRF": state.csrf },
      body: JSON.stringify({ messages: [...context, { role: "user", content: prompt }] }),
    });
    if (!response.ok || !response.body) {
      const failure = await response.json().catch(() => ({}));
      throw new Error(failure.error ?? "Local assistant request failed.");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let complete = false;
    while (!complete) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const eventText of events) {
        const data = eventText.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
        if (!data) continue;
        const eventData = JSON.parse(data);
        if (eventData.error) throw new Error(eventData.error);
        if (eventData.text) {
          answer.content += eventData.text;
          renderAssistantMessages();
        }
        if (eventData.done) complete = true;
      }
      if (done) complete = true;
    }
    if (!answer.content) answer.content = "The local model returned an empty response.";
  } catch (failure) {
    state.assistantConversation.pop();
    state.assistantConversation.pop();
    if (!abort.signal.aborted && errorNode.isConnected) {
      errorNode.textContent = failure.message;
      errorNode.hidden = false;
    } else if (!abort.signal.aborted) {
      toast(failure.message);
    }
  } finally {
    state.assistantBusy = false;
    if (state.assistantAbort === abort) state.assistantAbort = null;
    if (form.isConnected) {
      form.elements.prompt.disabled = false;
      sendButton.textContent = "↑";
      sendButton.setAttribute("aria-label", "Send message");
      sendButton.title = "Send message";
      form.elements.prompt.focus();
    }
    renderAssistantMessages();
  }
}

function settingsMarkup(settings) {
  const homepageValue = settings.homepage === "home" || settings.homepage === "blank" ? settings.homepage : "custom";
  const customHomepage = homepageValue === "custom" ? settings.homepage : "";
  return `<form id="settings-form" class="settings-grid">
    <fieldset class="form-field wide-field theme-picker"><legend class="field-label">Appearance</legend><div class="theme-options">
      <label class="theme-option"><input type="radio" name="theme" value="dark"><span class="theme-preview dark-preview" aria-hidden="true"><i></i><i></i><i></i></span><span class="theme-option-copy"><strong>Dark</strong><small>Low-glare workspace</small></span></label>
      <label class="theme-option"><input type="radio" name="theme" value="light"><span class="theme-preview light-preview" aria-hidden="true"><i></i><i></i><i></i></span><span class="theme-option-copy"><strong>Light</strong><small>Bright and clear</small></span></label>
      <label class="theme-option"><input type="radio" name="theme" value="system"><span class="theme-preview system-preview" aria-hidden="true"><i></i><i></i><i></i></span><span class="theme-option-copy"><strong>System</strong><small>Match your device</small></span></label>
    </div></fieldset>
    <label class="form-field"><span class="field-label">Interface density</span><select class="field-select" name="density"><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="spacious">Spacious</option></select></label>
    <label class="form-field"><span class="field-label">Default search provider</span><select class="field-select" name="searchProvider"><option value="duckduckgo">DuckDuckGo</option><option value="brave">Brave Search</option><option value="bing">Bing</option><option value="google">Google</option><option value="yandex">Yandex</option></select></label>
    <div class="form-field wide-field customization-card"><span class="field-label">Workspace customization</span><label class="customization-input"><span>Browser tab title</span><input class="field-input" name="customTitle" maxlength="60" placeholder="Nightjar — your name"></label><label class="customization-input"><span>Tab icon (emoji or symbol)</span><input class="field-input" name="customIcon" maxlength="4" placeholder="🌙"></label><p class="table-secondary">Drag toolbar icons to rearrange them. Your order is saved to this account.</p></div>
    <label class="form-field"><span class="field-label">Homepage</span><select class="field-select" name="homepageType"><option value="home">Nightjar start page</option><option value="blank">Blank page</option><option value="custom">Custom address</option></select></label>
    <label class="form-field wide-field custom-home-field" ${homepageValue !== "custom" ? "hidden" : ""}><span class="field-label">Custom homepage address</span><input class="field-input" name="homepage" type="url" placeholder="https://example.com" value="${escapeHtml(customHomepage)}"></label>
    <div class="form-field wide-field"><span class="field-label">Accent color</span><div class="accent-presets" role="group" aria-label="Accent color presets">${[["#ff7048", "Coral"], ["#a78bfa", "Violet"], ["#52c7a5", "Jade"], ["#6ba8ff", "Blue"], ["#f08ab5", "Rose"]].map(([color, name]) => `<button type="button" class="accent-swatch${settings.accent.toLowerCase() === color ? " selected" : ""}" style="--swatch:${color}" data-accent="${color}" aria-label="${name} accent" aria-pressed="${settings.accent.toLowerCase() === color}"></button>`).join("")}<span class="accent-custom-label">Custom</span><div class="color-field"><input name="accentPicker" type="color" value="${escapeHtml(settings.accent)}" aria-label="Custom accent color"><input class="field-input" name="accent" value="${escapeHtml(settings.accent)}" maxlength="7" aria-label="Accent hex color"></div></div></div>
    <div class="form-field wide-field"><div class="toggle-field"><span class="toggle-copy">Custom cursor<small>Animated states for browsing, links, text and drag actions.</small></span><label class="switch"><input type="checkbox" name="customCursor"><span></span></label></div></div>
    <div class="form-field wide-field privacy-grid">
      <div class="toggle-field"><span class="toggle-copy">Suppress page referrers<small>Ask the embedded page not to send the previous address to sites.</small></span><label class="switch"><input type="checkbox" name="suppressReferrer"><span></span></label></div>
      <div class="toggle-field"><span class="toggle-copy">Clear local tabs and history on sign-out<small>History is removed from this account; local tab addresses are cleared.</small></span><label class="switch"><input type="checkbox" name="clearOnExit"><span></span></label></div>
    </div>
    <div class="form-field wide-field"><span class="field-label">Account features</span><div id="feature-pills" class="quick-links" style="justify-content:flex-start;min-height:auto;padding:3px 0 0"></div></div>
  </form>`;
}

function openSettings() {
  if (!state.account.permissions.includes("settings") || !state.account.features.includes("settings")) return toast("Settings are not enabled for this account.");
  const footer = `<span class="muted" style="font-size:9px">Changes apply to this account.</span><div class="dialog-footer-right"><button id="cancel-settings" class="secondary-button" type="button">Cancel</button><button id="save-settings" class="primary-button" type="button">Save changes</button></div>`;
  openDialog({ title: "Settings", subtitle: "Make Nightjar feel like yours. Changes are saved to this account.", content: settingsMarkup(state.settings), footer });
  const form = $("#settings-form");
  form.elements.theme.value = state.settings.theme;
  form.elements.density.value = state.settings.density;
  form.elements.searchProvider.value = state.settings.searchProvider;
  form.elements.customTitle.value = state.settings.customTitle ?? "";
  form.elements.customIcon.value = state.settings.customIcon ?? "";
  form.elements.homepageType.value = ["home", "blank"].includes(state.settings.homepage) ? state.settings.homepage : "custom";
  form.elements.homepage.value = ["home", "blank"].includes(state.settings.homepage) ? "" : state.settings.homepage;
  form.elements.accent.value = state.settings.accent;
  form.elements.accentPicker.value = state.settings.accent;
  form.elements.customCursor.checked = state.settings.customCursor;
  form.elements.suppressReferrer.checked = state.settings.privacy.suppressReferrer;
  form.elements.clearOnExit.checked = state.settings.privacy.clearOnExit;
  const features = state.account.features;
  const permissions = state.account.permissions;
  $("#feature-pills").innerHTML = ["browse", "bookmarks", "history", "settings", "assistant"].map((feature) => {
    const allowed = permissions.includes(feature) && (feature === "browse" || features.includes(feature));
    return `<span class="feature-pill${allowed ? "" : " disabled"}">${allowed ? "Enabled" : "Disabled"} · ${escapeHtml(feature)}</span>`;
  }).join("");
  form.elements.homepageType.addEventListener("change", () => {
    $(".custom-home-field").hidden = form.elements.homepageType.value !== "custom";
  });
  form.elements.accentPicker.addEventListener("input", () => { form.elements.accent.value = form.elements.accentPicker.value; });
  form.elements.accent.addEventListener("input", () => {
    const color = form.elements.accent.value.toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(color)) form.elements.accentPicker.value = color;
    $$(".accent-swatch", form).forEach((swatch) => {
      const selected = swatch.dataset.accent === color;
      swatch.classList.toggle("selected", selected);
      swatch.setAttribute("aria-pressed", String(selected));
    });
  });
  $$(".accent-swatch", form).forEach((button) => button.addEventListener("click", () => {
    form.elements.accent.value = button.dataset.accent;
    form.elements.accentPicker.value = button.dataset.accent;
    $$(".accent-swatch", form).forEach((swatch) => {
      const selected = swatch === button;
      swatch.classList.toggle("selected", selected);
      swatch.setAttribute("aria-pressed", String(selected));
    });
  }));
  $("#cancel-settings").addEventListener("click", closeDialog);
  $("#save-settings").addEventListener("click", async () => {
    const homepage = form.elements.homepageType.value === "custom" ? form.elements.homepage.value.trim() : form.elements.homepageType.value;
    const next = {
      theme: form.elements.theme.value,
      density: form.elements.density.value,
      homepage,
      searchProvider: form.elements.searchProvider.value,
      accent: form.elements.accent.value,
      customCursor: form.elements.customCursor.checked,
      customTitle: form.elements.customTitle.value.trim(),
      customIcon: form.elements.customIcon.value.trim(),
      toolbarOrder: state.settings.toolbarOrder,
      privacy: { suppressReferrer: form.elements.suppressReferrer.checked, clearOnExit: form.elements.clearOnExit.checked },
    };
    try {
      const result = await api("/api/settings", { method: "PUT", body: { settings: next } });
      state.settings = result.settings;
      state.account.settings = result.settings;
      applySettings();
      closeDialog();
      toast("Settings saved for this account.");
    } catch (error) {
      toast(error.message);
    }
  });
}

function openHelp() {
  const canSendFeedback = state.account.permissions.includes("support") && state.account.features.includes("support");
  const shortcuts = [
    ["Focus address bar", "Ctrl / ⌘ + L"],
    ["Open a new tab", "Ctrl / ⌘ + T"],
    ["Close current tab", "Ctrl / ⌘ + W"],
    ["Reopen recently closed tab", "Ctrl / ⌘ + Shift + T"],
    ["Reload the current page", "Ctrl / ⌘ + R or F5"],
    ["Bookmark the current page", "Ctrl / ⌘ + D"],
    ["Open browsing history", "Ctrl / ⌘ + Shift + H"],
    ["Switch to tab 1–8", "Ctrl / ⌘ + 1–8"],
    ["Back / forward", "Alt + ← / →"],
  ];
  const content = `<div class="help-layout">
    <section class="help-card"><span class="help-card-kicker">QUICK START</span><h3>Your workspace, at a glance</h3><p>Type a web address or search in the top bar. Use <strong>+</strong> to open a tab, the bookmark icon to save a page, and the toolbar to find your history, local assistant, and settings.</p><p>Right-click the workspace or a tab for handy actions. Your tabs are saved in this browser on this device; bookmarks, history, and preferences are linked to your account.</p></section>
    <section class="help-card"><span class="help-card-kicker">MAKE IT YOURS</span><h3>Appearance and comfort</h3><p>Choose <strong>dark</strong>, <strong>light</strong>, or <strong>system</strong> appearance from the moon/sun button or Settings. Set an accent color, interface density, homepage, and search provider in Settings.</p><p>The animated cursor automatically gives way to your native cursor for reduced-motion preferences, touch input, and text entry.</p></section>
    <section class="help-card help-shortcuts"><span class="help-card-kicker">KEYBOARD SHORTCUTS</span><h3>Move around faster</h3><div class="help-shortcut-list">${shortcuts.map(([label, keys]) => `<div class="help-shortcut"><span>${escapeHtml(label)}</span><kbd>${escapeHtml(keys)}</kbd></div>`).join("")}</div></section>
    <section class="help-card"><span class="help-card-kicker">PRIVACY & LIMITS</span><h3>What this browser can do</h3><p>Websites open through Nightjar's separate-origin Rammerhead browsing engine. Destinations are limited to public HTTP(S) sites on ports 80 and 443. Some sites may still be incompatible; use <strong>Open in a regular tab</strong> when needed.</p><p>Downloads belong to the host browser. This web app does not control your device or regular browser. Desktop sharing or input requires a separately installed companion and local approval; an owner password alone cannot activate it.</p></section>
    <section class="help-card"><span class="help-card-kicker">LOCAL AI</span><h3>Ask the on-device assistant</h3><p>The assistant uses your local Ollama model and can be opened from the toolbar. Its chat is not saved, and it cannot read your open pages, files, or credentials. If unavailable, check Ollama and the model status in Settings or ask the workspace owner.</p></section>
    <section class="help-card"><span class="help-card-kicker">GAME LOUNGE</span><h3>Pick a game and play</h3><p>Open the toolbar's Game lounge to explore GN Math in a fresh Nightjar tab or play the built-in Quick Math sprint. The sprint's best score stays in this browser profile.</p></section>
    <section class="help-card help-contact"><span class="help-card-kicker">SUPPORT & IDEAS</span><h3>Help us make Nightjar better</h3><p>Send a private support request or feature suggestion to the owner. It is stored in this workspace for owner review and is not sent to an external service.</p>${canSendFeedback ? '<div class="fallback-actions"><button id="help-support" class="secondary-button" type="button">Contact support</button><button id="help-suggest" class="primary-button" type="button">Share an idea</button></div>' : '<p class="muted">Support requests are not enabled for this account. Ask the owner for access.</p>'}</section>
    <section class="help-card"><span class="help-card-kicker">INVITATION PRIVACY</span><h3>One-time sign-in</h3><p>An invitation is redeemed once. After that, the browser uses a server-validated, HttpOnly cookie session, so refreshing does not need the invitation again. A token remains a bearer credential until first redemption—keep it private and share it only with its intended person.</p></section>
  </div>`;
  openDialog({ title: "Nightjar help", subtitle: "A friendly guide to your private browsing workspace.", content, wide: true, footer: `<span class="muted help-footer-note">Press Esc to close</span><div class="dialog-footer-right"><button id="help-done" class="primary-button" type="button">Got it</button></div>` });
  $("#help-done").addEventListener("click", closeDialog);
  $("#help-support")?.addEventListener("click", () => openFeedback("support"));
  $("#help-suggest")?.addEventListener("click", () => openFeedback("suggestion"));
}

function openFeedback(kind) {
  if (!state.account?.permissions.includes("support") || !state.account.features.includes("support")) {
    toast("Support messages are not enabled for this account.");
    return;
  }
  const suggestion = kind === "suggestion";
  openDialog({
    title: suggestion ? "Share a suggestion" : "Contact support",
    subtitle: "This message is saved privately for the Nightjar owner to review.",
    content: `<form id="feedback-form" class="stack-form"><label for="feedback-subject">Subject</label><input id="feedback-subject" name="subject" maxlength="120" minlength="4" required placeholder="${suggestion ? "What would make Nightjar better?" : "How can we help?"}"><label for="feedback-message">Details</label><textarea id="feedback-message" name="message" maxlength="4000" minlength="10" rows="6" required placeholder="Share enough detail for the owner to follow up."></textarea></form>`,
    footer: '<span class="muted" style="font-size:9px">Stored in this Nightjar instance only.</span><div class="dialog-footer-right"><button class="secondary-button" data-close-dialog type="button">Cancel</button><button id="send-feedback" class="primary-button" type="button">Send privately</button></div>',
  });
  $("[data-close-dialog]").addEventListener("click", closeDialog);
  $("#send-feedback").addEventListener("click", async () => {
    const form = $("#feedback-form");
    if (!form.reportValidity()) return;
    const button = $("#send-feedback");
    button.disabled = true;
    try {
      await api("/api/feedback", { method: "POST", body: {
        kind,
        subject: form.elements.subject.value.trim(),
        message: form.elements.message.value.trim(),
      } });
      closeDialog();
      toast(suggestion ? "Suggestion sent to the owner." : "Support request sent to the owner.");
    } catch (error) {
      toast(error.message);
      button.disabled = false;
    }
  });
}

function newMathQuestion() {
  const operations = ["+", "−", "×", "÷"];
  const operation = operations[Math.floor(Math.random() * operations.length)];
  let left = Math.floor(Math.random() * 18) + 3;
  let right = Math.floor(Math.random() * 12) + 2;
  let answer;
  if (operation === "+") answer = left + right;
  else if (operation === "−") {
    if (left < right) [left, right] = [right, left];
    answer = left - right;
  } else if (operation === "×") {
    left = Math.floor(Math.random() * 10) + 2;
    right = Math.floor(Math.random() * 10) + 2;
    answer = left * right;
  } else {
    answer = left;
    left *= right;
  }
  return { prompt: `${left} ${operation} ${right}`, answer };
}

function openMathGame() {
  if (!state.account?.permissions.includes("games") || !state.account.features.includes("games")) {
    toast("Math games are not enabled for this account.");
    return;
  }
  const content = `<section class="game-lounge" aria-label="Game lounge">
    <article class="game-launch-card game-launch-featured">
      <div class="game-art game-art-portal" aria-hidden="true"><span class="game-art-orbit"></span><span class="game-art-glyph">G</span><span class="game-art-spark">✦</span></div>
      <div class="game-launch-copy"><span class="game-launch-kicker">THE GAME LIBRARY</span><h3>Find your next favorite.</h3><p>Explore GN Math’s collection of quick browser games, opened in a fresh Nightjar tab through the private browsing surface.</p><button id="open-gn-math" class="primary-button" type="button">Explore GN Math <span aria-hidden="true">↗</span></button></div>
    </article>
    <article class="game-launch-card game-launch-quick">
      <div class="game-art game-art-quick" aria-hidden="true"><span>+</span><span>×</span><span>÷</span></div>
      <div class="game-launch-copy"><span class="game-launch-kicker">NIGHTJAR ORIGINAL</span><h3>Quick Math</h3><p>A focused 60-second arithmetic sprint. Your best score stays in this browser profile.</p><button id="open-quick-math" class="secondary-button" type="button">Start a round <span aria-hidden="true">→</span></button></div>
    </article>
    <p class="game-lounge-note"><span class="status-dot"></span> External games run as web content and may depend on the site being available.</p>
  </section>`;
  openDialog({
    title: "Game lounge",
    subtitle: "A little play, right from your workspace.",
    content,
    wide: true,
    footer: '<span class="muted help-footer-note">Games are available to this account</span><div class="dialog-footer-right"><button id="game-lounge-done" class="secondary-button" type="button">Close</button></div>',
  });
  $("#open-gn-math").addEventListener("click", () => {
    closeDialog();
    const tab = createTab(true);
    void navigate("https://gn-math.dev", { tab });
  });
  $("#open-quick-math").addEventListener("click", openQuickMathGame);
  $("#game-lounge-done").addEventListener("click", closeDialog);
}

function openQuickMathGame() {
  if (!state.account?.permissions.includes("games") || !state.account.features.includes("games")) {
    toast("Math games are not enabled for this account.");
    return;
  }
  const bestKey = getStorageKey("math-best");
  let best = 0;
  try { best = Number(localStorage.getItem(bestKey) ?? 0); } catch {}
  const renderGame = () => {
    const game = state.game;
    const card = $("#math-game");
    if (!card) return;
    if (game.finished) {
      card.innerHTML = `<div class="game-result"><span class="game-kicker">ROUND COMPLETE</span><strong>${game.score}</strong><span>correct answers</span><p>${game.score > best ? "A new personal best — nicely played." : `Personal best: ${best}`}</p><button id="math-replay" class="primary-button" type="button">Play again</button></div>`;
      $("#math-replay").addEventListener("click", openQuickMathGame);
      return;
    }
    card.innerHTML = `<div class="game-score-row"><span>Score <strong>${game.score}</strong></span><span>Streak <strong>${game.streak}</strong></span><span>Time <strong>${game.seconds}s</strong></span></div><div class="math-question">${escapeHtml(game.question.prompt)} <span>=</span> ?</div><form id="math-answer-form" class="math-answer-form"><input id="math-answer" type="number" inputmode="numeric" aria-label="Your answer" autocomplete="off" required autofocus><button class="primary-button" type="submit">Check <span>↵</span></button></form><p id="math-feedback" class="game-feedback" aria-live="polite">Keep your streak going.</p><div class="game-best">Personal best <strong>${best}</strong></div>`;
    $("#math-answer-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const answer = Number($("#math-answer").value);
      if (answer === game.question.answer) {
        game.score += 1;
        game.streak += 1;
        const feedback = $("#math-feedback");
        if (feedback) feedback.textContent = "Correct — next one!";
      } else {
        game.streak = 0;
        const feedback = $("#math-feedback");
        if (feedback) feedback.textContent = "Not quite — keep going!";
      }
      if (game.score > best) {
        best = game.score;
        try { localStorage.setItem(bestKey, String(best)); } catch {}
      }
      game.question = newMathQuestion();
      renderGame();
      $("#math-answer")?.focus();
    });
  };
  openDialog({
    title: "Quick Math",
    subtitle: "A private 60-second arithmetic sprint.",
    content: '<section id="math-game" class="math-game" aria-label="Math game"></section>',
    footer: '<span class="muted" style="font-size:9px">No account data is sent or stored.</span><div class="dialog-footer-right"><button id="end-math" class="secondary-button" type="button">End round</button></div>',
    onClose: () => { state.game = null; },
  });
  state.game = { score: 0, streak: 0, seconds: 60, question: newMathQuestion(), finished: false };
  $("#end-math").addEventListener("click", () => {
    if (state.game) state.game.finished = true;
    clearInterval(state.gameTimer);
    renderGame();
  });
  renderGame();
  state.gameTimer = setInterval(() => {
    if (!state.game || state.game.finished) return;
    state.game.seconds -= 1;
    if (state.game.seconds <= 0) {
      state.game.finished = true;
      clearInterval(state.gameTimer);
      state.gameTimer = 0;
    }
    renderGame();
  }, 1000);
  $("#math-answer")?.focus();
}

async function cycleTheme() {
  if (!state.account.permissions.includes("settings") || !state.account.features.includes("settings")) return;
  const nextTheme = { dark: "light", light: "system", system: "dark" }[state.settings.theme] ?? "light";
  const next = { ...state.settings, theme: nextTheme };
  const button = $("#theme-toggle");
  button.disabled = true;
  try {
    const result = await api("/api/settings", { method: "PUT", body: { settings: next } });
    state.settings = result.settings;
    state.account.settings = result.settings;
    applySettings();
    const label = nextTheme === "system" ? "System" : nextTheme[0].toUpperCase() + nextTheme.slice(1);
    toast(`${label} appearance saved.`);
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function toggleBookmark() {
  const tab = activeTab();
  if (!tab?.url) return toast("Open a web page before saving a bookmark.");
  if (!state.account.permissions.includes("bookmarks") || !state.account.features.includes("bookmarks")) return toast("Bookmarks are not enabled for this account.");
  try {
    const lookup = await api(`/api/bookmarks/contains?url=${encodeURIComponent(tab.url)}`);
    const existing = lookup.bookmark;
    if (existing) {
      await api(`/api/bookmarks/${existing.id}`, { method: "DELETE" });
      toast("Bookmark removed.");
    } else {
      await api("/api/bookmarks", { method: "POST", body: { url: tab.url, title: tab.title } });
      toast("Page saved to bookmarks.");
    }
    await refreshBookmarks(false);
  } catch (error) { toast(error.message); }
}

function openRecentlyClosed() {
  const items = state.closed;
  if (!items.length) {
    toast("There are no recently closed tabs.");
    return;
  }
  const content = `<div class="list-table"><table class="list-table"><thead><tr><th>CLOSED PAGE</th><th></th></tr></thead><tbody>${items.map((item, index) => `<tr><td><div class="list-row-title">${escapeHtml(item.title)}</div><div class="list-row-url">${escapeHtml(item.url)}</div></td><td><button class="secondary-button" type="button" data-restore="${index}">Restore</button></td></tr>`).join("")}</tbody></table></div>`;
  openDialog({ title: "Recently closed", subtitle: "Restore a tab from this browser profile.", content });
  $$("[data-restore]").forEach((button) => button.addEventListener("click", () => {
    const item = state.closed.splice(Number(button.dataset.restore), 1)[0];
    const tab = createTab(true, item.url);
    tab.title = item.title;
    renderTabs();
    saveLocalState();
    closeDialog();
    selectTab(tab.id);
  }));
}

function showContextMenu(x, y, items) {
  const menu = $("#context-menu");
  menu.innerHTML = items.map((item, index) => item.separator
    ? '<div class="context-separator" role="separator"></div>'
    : `<button type="button" role="menuitem" data-action-index="${index}"><span>${escapeHtml(item.label)}</span><span>${escapeHtml(item.shortcut ?? "")}</span></button>`).join("");
  menu.hidden = false;
  menu.style.left = `${Math.min(x, innerWidth - 200)}px`;
  menu.style.top = `${Math.min(y, innerHeight - menu.offsetHeight - 12)}px`;
  $$("[data-action-index]", menu).forEach((button) => button.addEventListener("click", () => {
    menu.hidden = true;
    items[Number(button.dataset.actionIndex)].run();
  }));
}

function signIn() {
  $("#signin").hidden = false;
  $("#browser").hidden = true;
  $("#signin-error").hidden = true;
  $("#invite-token").focus();
  document.title = "Nightjar — private browsing space";
}

async function signOut(callServer = true) {
  const clear = state.settings.privacy.clearOnExit;
  if (callServer && state.account) {
    try {
      if (clear && state.account.permissions.includes("history") && state.account.features.includes("history")) {
        await api("/api/history", { method: "DELETE" });
      }
      await api("/api/auth/logout", { method: "POST", body: {} });
    } catch (error) {
      toast(error.message);
    }
  }
  if (clear && state.account) localStorage.removeItem(getStorageKey("tabs"));
  if (state.proxyReady) postProxy({ type: "nightjar:shutdown" });
  state.proxyReady = false;
  state.proxySessionId = "";
  state.proxyOrigin = "";
  $("#page-frame").src = "about:blank";
  closeDialog();
  state.account = null;
  state.csrf = "";
  state.settings = { ...defaults, privacy: { ...defaults.privacy }, toolbarOrder: [...defaults.toolbarOrder] };
  state.tabs = [];
  state.activeId = null;
  state.bookmarks = [];
  state.projectAreas = [];
  $("#admin-link").hidden = true;
  applySettings();
  renderProjectAreas();
  state.assistantConversation = [];
  state.assistantBusy = false;
  sessionStorage.removeItem("nightjar.csrf");
  signIn();
}

function setupCursor() {
  let cursor = $(".cursor-orb");
  cursor.id = "cursor-orb";
  document.addEventListener("pointermove", (event) => {
    state.cursor.x = event.clientX;
    state.cursor.y = event.clientY;
    cursor.style.left = `${event.clientX}px`;
    cursor.style.top = `${event.clientY}px`;
    const target = event.target;
    document.body.dataset.nativeCursor = (target instanceof Element && target.closest("input,textarea,[contenteditable=true]")) ? "true" : "false";
    cursor.classList.toggle("pointer", target instanceof Element && Boolean(target.closest("button,a,[role=button],select")));
    cursor.classList.toggle("text", target instanceof Element && Boolean(target.closest("input,textarea,[contenteditable=true]")));
  });
  document.addEventListener("pointerdown", () => cursor.classList.add("dragging"));
  document.addEventListener("pointerup", () => cursor.classList.remove("dragging"));
  document.addEventListener("dragstart", () => cursor.classList.add("dragging"));
  document.addEventListener("dragend", () => cursor.classList.remove("dragging"));
  reducedMotion.addEventListener("change", applySettings);
  coarsePointer.addEventListener("change", applySettings);
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (state.settings.theme === "system") applySettings();
  });
}

$("#signin-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("button[type=submit]", event.currentTarget);
  const error = $("#signin-error");
  error.hidden = true;
  button.disabled = true;
  const token = $("#invite-token").value.trim();
  try {
    const result = await api("/api/auth/login", { method: "POST", body: { token } });
    state.csrf = result.csrf;
    applyDisplay(result);
  } catch (failure) {
    error.textContent = failure.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
});

$("#toggle-token").addEventListener("click", () => {
  const input = $("#invite-token");
  const reveal = input.type === "password";
  input.type = reveal ? "text" : "password";
  $("#toggle-token").innerHTML = svg(reveal ? "eyeOff" : "eye");
  $("#toggle-token").setAttribute("aria-label", reveal ? "Hide token" : "Show token");
});

$("#new-tab").addEventListener("click", () => createTab(true));
$("#back").addEventListener("click", () => moveHistory(-1));
$("#forward").addEventListener("click", () => moveHistory(1));
$("#reload").addEventListener("click", () => {
  if (state.pageLoading) stopPageLoad();
  else reloadPage();
});
$("#home").addEventListener("click", showHome);
$("#brand-home").addEventListener("click", (event) => { event.preventDefault(); showHome(); });
$("#bookmark-current").addEventListener("click", () => void toggleBookmark());
$("#bookmarks-open").addEventListener("click", () => void openBookmarks());
$("#history-open").addEventListener("click", () => void openHistory());
$("#downloads-open").addEventListener("click", openDownloads);
$("#assistant-open").addEventListener("click", openAssistant);
$("#settings-open").addEventListener("click", openSettings);
$("#theme-toggle").addEventListener("click", () => void cycleTheme());
$("#help-open").addEventListener("click", openHelp);
$("#games-open").addEventListener("click", openMathGame);
$("#project-area-create").addEventListener("click", () => openProjectAreaDialog());
$("#signout").addEventListener("click", () => {
  if (confirm("Sign out of this private workspace?")) void signOut(true);
});
$("#account-chip").addEventListener("click", () => {
  toast(`Signed in as ${state.account.label}. This account has one active browser session.`, 3800);
});
$("#address-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void navigate($("#address").value);
});
$("#home-search").addEventListener("submit", (event) => {
  event.preventDefault();
  void navigate($("#home-query").value);
});
function openRegularTab() {
  const url = activeTab()?.url;
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}
$("#open-external").addEventListener("click", openRegularTab);
$("#open-regular").addEventListener("click", openRegularTab);
$("#retry-page").addEventListener("click", reloadPage);

$("#tab-strip").addEventListener("click", (event) => {
  const close = event.target.closest("[data-close-tab]");
  if (close) {
    event.stopPropagation();
    closeTab(close.dataset.closeTab);
    return;
  }
  const tab = event.target.closest("[data-tab-id]");
  if (tab) selectTab(tab.dataset.tabId);
});
$("#tab-strip").addEventListener("auxclick", (event) => {
  const tab = event.target.closest("[data-tab-id]");
  if (event.button === 1 && tab) closeTab(tab.dataset.tabId);
});
$("#tab-strip").addEventListener("keydown", (event) => {
  const close = event.target.closest("[data-close-tab]");
  if (close && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    closeTab(close.dataset.closeTab);
  }
});
$("#tab-strip").addEventListener("contextmenu", (event) => {
  const tab = event.target.closest("[data-tab-id]");
  if (!tab) return;
  event.preventDefault();
  const tabId = tab.dataset.tabId;
  showContextMenu(event.clientX, event.clientY, [
    { label: "New tab", shortcut: "Ctrl+T", run: () => createTab(true) },
    { label: "Reload", shortcut: "Ctrl+R", run: () => reloadPage() },
    { separator: true },
    { label: "Close tab", shortcut: "Ctrl+W", run: () => closeTab(tabId) },
  ]);
});
$("#workspace").addEventListener("contextmenu", (event) => {
  if (event.target.closest("iframe")) return;
  event.preventDefault();
  showContextMenu(event.clientX, event.clientY, [
    { label: "New tab", shortcut: "Ctrl+T", run: () => createTab(true) },
    { label: "Reload", shortcut: "Ctrl+R", run: () => reloadPage() },
    { label: "Bookmark this page", shortcut: "Ctrl+D", run: () => void toggleBookmark() },
    { separator: true },
    { label: "Recently closed", shortcut: "Ctrl+Shift+T", run: openRecentlyClosed },
  ]);
});
document.addEventListener("click", (event) => {
  if (!event.target.closest("#context-menu")) $("#context-menu").hidden = true;
});

document.addEventListener("keydown", (event) => {
  if ($("#signin").hidden === false || !state.account) return;
  const mod = event.ctrlKey || event.metaKey;
  const focusedText = event.target instanceof Element && event.target.closest("input,textarea,[contenteditable=true]");
  if (mod && event.key.toLowerCase() === "l") {
    event.preventDefault();
    $("#address").focus();
    $("#address").select();
  } else if (mod && event.key.toLowerCase() === "t") {
    event.preventDefault();
    createTab(true);
  } else if (mod && event.key.toLowerCase() === "w") {
    event.preventDefault();
    closeTab(state.activeId);
  } else if (mod && event.key.toLowerCase() === "r" || event.key === "F5") {
    event.preventDefault();
    reloadPage();
  } else if (event.altKey && event.key === "ArrowLeft") {
    event.preventDefault();
    moveHistory(-1);
  } else if (event.altKey && event.key === "ArrowRight") {
    event.preventDefault();
    moveHistory(1);
  } else if (mod && event.shiftKey && event.key.toLowerCase() === "t") {
    event.preventDefault();
    openRecentlyClosed();
  } else if (mod && event.key.toLowerCase() === "d") {
    event.preventDefault();
    void toggleBookmark();
  } else if (mod && event.shiftKey && event.key === "?") {
    event.preventDefault();
    openHelp();
  } else if (mod && event.shiftKey && event.key.toLowerCase() === "h") {
    event.preventDefault();
    void openHistory();
  } else if (mod && /^[1-8]$/.test(event.key)) {
    event.preventDefault();
    const tab = state.tabs[Number(event.key) - 1];
    if (tab) selectTab(tab.id);
  } else if (event.key === "Escape" && document.activeElement === $("#address")) {
    $("#address").value = activeTab()?.url ?? "";
    $("#address").blur();
  } else if (focusedText && event.key === "Escape") {
    event.target.blur();
  }
});

$("#workspace").addEventListener("dragover", (event) => event.preventDefault());
$("#workspace").addEventListener("drop", (event) => {
  event.preventDefault();
  const text = event.dataTransfer?.getData("text/uri-list") || event.dataTransfer?.getData("text/plain");
  if (text) void navigate(text.split("\n").find((line) => !line.startsWith("#"))?.trim() ?? text.trim());
});

async function bootstrap() {
  setupCursor();
  try {
    const result = await api("/api/session");
    state.account = result.account;
    state.csrf = result.csrf;
    applyDisplay(result);
  } catch {
    signIn();
  }
}

void bootstrap();
