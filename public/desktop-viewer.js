const $ = (selector) => document.querySelector(selector);
const message = $("#desktop-viewer-message");
const screen = $("#desktop-viewer-screen");
const image = $("#desktop-viewer-frame");
const launchId = location.hash.slice(1);
const ownerWindow = window.opener;
let sessionToken = "";
let csrfToken = "";
let frameTimer = 0;
let heartbeatTimer = 0;
let frameUrl = "";
let loadingFrame = false;
let stopped = false;

function setMessage(value) {
  message.textContent = value;
}

const desktopRelayPaths = {
  "/heartbeat": "/api/admin/desktop/relay/heartbeat",
  "/stop": "/api/admin/desktop/relay/stop",
  "/input": "/api/admin/desktop/relay/input",
  "/frame": "/api/admin/desktop/relay/frame",
};

async function companionRequest(path, body) {
  let response;
  try {
    response = await fetch(desktopRelayPaths[path], {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(body === undefined || !csrfToken ? {} : { "X-NJ-CSRF": csrfToken }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Cannot reach Nightjar. Check the server connection and Linux companion.");
  }
  if ((response.headers.get("content-type") ?? "").startsWith("image/")) {
    if (!response.ok) throw new Error("Nightjar could not get a screen frame from the companion.");
    return response.blob();
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "The desktop relay request was rejected.");
  return data;
}

async function renderDesktopFrame() {
  if (!sessionToken || loadingFrame || stopped) return;
  loadingFrame = true;
  try {
    const blob = await companionRequest("/frame");
    const nextUrl = URL.createObjectURL(blob);
    if (stopped) {
      URL.revokeObjectURL(nextUrl);
      return;
    }
    image.src = nextUrl;
    if (frameUrl) URL.revokeObjectURL(frameUrl);
    frameUrl = nextUrl;
  } catch (error) {
    if (error.message.includes("Waiting for the Linux desktop companion to send a screen frame")) {
      setMessage(error.message);
      return;
    }
    await endViewer(error.message, true);
  } finally {
    loadingFrame = false;
  }
}

async function verifyOwnerAndCompanion() {
  const owner = await fetch("/api/admin/me", { credentials: "same-origin", cache: "no-store" });
  if (!owner.ok) throw new Error("The owner session ended. Reopen the desktop from the owner panel.");
  const data = await owner.json();
  csrfToken = data.csrf;
  await companionRequest("/heartbeat", {});
}

async function startViewer() {
  if (sessionToken) return;
  sessionToken = "active";
  try {
    await verifyOwnerAndCompanion();
    screen.hidden = false;
    $("#desktop-viewer-send-key").disabled = false;
    $("#desktop-viewer-send-text").disabled = false;
    setMessage("Owner session verified. Screen sharing is active.");
    void renderDesktopFrame();
    frameTimer = setInterval(() => void renderDesktopFrame(), 750);
    heartbeatTimer = setInterval(() => {
      void verifyOwnerAndCompanion().catch((error) => void endViewer(error.message, true));
    }, 15_000);
  } catch (error) {
    await endViewer(error.message, true);
  }
}

async function sendInput(input) {
  if (!sessionToken || stopped) return;
  try {
    await companionRequest("/input", input);
  } catch (error) {
    setMessage(error.message);
  }
}

function clickScreen(event) {
  if (!sessionToken || stopped) return;
  const rect = image.getBoundingClientRect();
  if (!image.naturalWidth || !image.naturalHeight) return;
  const scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const x = Math.round((event.clientX - rect.left - (rect.width - width) / 2) / scale);
  const y = Math.round((event.clientY - rect.top - (rect.height - height) / 2) / scale);
  if (x < 0 || y < 0 || x >= image.naturalWidth || y >= image.naturalHeight) return;
  event.preventDefault();
  void sendInput({ action: "click", x, y, button: "left" });
}

async function endViewer(reason, stopCompanion) {
  if (stopped) return;
  stopped = true;
  clearInterval(frameTimer);
  clearInterval(heartbeatTimer);
  $("#desktop-viewer-send-key").disabled = true;
  $("#desktop-viewer-send-text").disabled = true;
  screen.hidden = true;
  image.removeAttribute("src");
  if (frameUrl) URL.revokeObjectURL(frameUrl);
  frameUrl = "";
  if (stopCompanion && sessionToken) {
    try {
      await companionRequest("/stop", {});
    } catch {
      // The companion's idle timeout also revokes an unreachable session.
    }
  }
  setMessage(reason);
  sessionToken = "";
}

window.addEventListener("message", (event) => {
  if (event.origin !== location.origin || event.source !== ownerWindow || event.data?.launchId !== launchId) return;
  if (event.data.type === "nightjar-desktop-session") void startViewer();
});

$("#desktop-viewer-close").addEventListener("click", () => window.close());
$("#desktop-viewer-frame").addEventListener("pointerdown", clickScreen);
$("#desktop-viewer-send-key").addEventListener("click", () => {
  void sendInput({ action: "key", key: $("#desktop-viewer-key").value });
});
$("#desktop-viewer-send-text").addEventListener("click", () => {
  const input = $("#desktop-viewer-text");
  if (!input.value) return;
  void sendInput({ action: "type", text: input.value }).then(() => { input.value = ""; });
});

if (ownerWindow && launchId) {
  ownerWindow.postMessage({ type: "nightjar-desktop-viewer-ready", launchId }, location.origin);
} else {
  setMessage("This one-time desktop tab must be opened from the authenticated owner panel.");
}
