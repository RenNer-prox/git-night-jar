import { app, BrowserWindow, WebContentsView, ipcMain } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAddress, isWebUrl } from "./address.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const TOOLBAR_HEIGHT = 78;
const homepageHtml = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Nightjar Searcher</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#17181b;color:#e8e8e9;font:16px system-ui,sans-serif}.welcome{text-align:center;padding:32px}.mark{width:48px;height:48px;margin:auto auto 18px;border-radius:16px;display:grid;place-items:center;background:#ff7048;color:#17181b;font-size:25px;font-weight:800}.hint{color:#a7a8ae;margin-top:9px}</style><main class="welcome"><div class="mark">n.</div><h1>Find your way.</h1><div class="hint">Search above or enter a website address.</div></main></html>`;
const HOME_URL = `data:text/html,${encodeURIComponent(homepageHtml)}`;

let window;
let pageView;

function updateBounds() {
  if (!window || !pageView) return;
  const { width, height } = window.getContentBounds();
  pageView.setBounds({
    x: 0,
    y: TOOLBAR_HEIGHT,
    width,
    height: Math.max(0, height - TOOLBAR_HEIGHT),
  });
}

function publishState() {
  if (!window || !pageView) return;
  window.webContents.send("searcher:state", {
    url: pageView.webContents.getURL(),
    title: pageView.webContents.getTitle(),
    canGoBack: pageView.webContents.canGoBack(),
    canGoForward: pageView.webContents.canGoForward(),
  });
}

function navigate(rawAddress, provider) {
  const url = resolveAddress(rawAddress, provider);
  return pageView.webContents.loadURL(url);
}

function createWindow() {
  window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 680,
    minHeight: 440,
    backgroundColor: "#121316",
    title: "Nightjar Searcher",
    webPreferences: {
      preload: join(ROOT, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  pageView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  pageView.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  pageView.webContents.session.setPermissionCheckHandler(() => false);
  window.contentView.addChildView(pageView);
  updateBounds();
  window.on("resize", updateBounds);
  window.on("closed", () => {
    pageView.webContents.close();
    window = undefined;
    pageView = undefined;
  });

  const contents = pageView.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) void navigate(url, "duckduckgo").catch(reportNavigationError);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (!isWebUrl(url) && url !== HOME_URL) event.preventDefault();
  });
  contents.on("did-start-loading", () => window?.webContents.send("searcher:loading", true));
  contents.on("did-stop-loading", () => {
    window?.webContents.send("searcher:loading", false);
    publishState();
  });
  contents.on("did-navigate", publishState);
  contents.on("did-navigate-in-page", publishState);
  contents.on("page-title-updated", publishState);
  contents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3) {
      window?.webContents.send("searcher:error", `Could not load the page: ${description}`);
    }
  });

  window.webContents.on("did-finish-load", () => {
    window.webContents.send("searcher:state", {
      url: "",
      title: "Nightjar Searcher",
      canGoBack: false,
      canGoForward: false,
    });
  });
  void window.loadFile(join(ROOT, "index.html"));
  void contents.loadURL(HOME_URL);
}

function reportNavigationError(error) {
  window?.webContents.send(
    "searcher:error",
    error instanceof Error ? error.message : "The requested page could not be opened.",
  );
}

app.whenReady().then(() => {
  app.setName("Nightjar Searcher");
  const handleFromToolbar = (event, callback) => {
    if (event.sender !== window?.webContents) throw new Error("This action is only available from the Nightjar toolbar.");
    return callback();
  };
  ipcMain.handle("searcher:navigate", (event, address, provider) => handleFromToolbar(event, () => navigate(address, provider)));
  ipcMain.handle("searcher:back", (event) => handleFromToolbar(event, () => {
    if (pageView.webContents.canGoBack()) pageView.webContents.goBack();
    publishState();
  }));
  ipcMain.handle("searcher:forward", (event) => handleFromToolbar(event, () => {
    if (pageView.webContents.canGoForward()) pageView.webContents.goForward();
    publishState();
  }));
  ipcMain.handle("searcher:reload", (event) => handleFromToolbar(event, () => pageView.webContents.reload()));
  ipcMain.handle("searcher:home", (event) => handleFromToolbar(event, () => pageView.webContents.loadURL(HOME_URL)));
  createWindow();
});

app.on("window-all-closed", () => app.quit());
