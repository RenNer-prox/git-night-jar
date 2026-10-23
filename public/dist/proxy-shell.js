import { BareMuxConnection } from "@mercuryworkshop/bare-mux";
const surface = document.querySelector("#browsing-surface");
const status = document.querySelector("#engine-status");
const frames = new Map();
let appOrigin = "";
let controller = null;
let connection = null;
let initialized = false;
function send(message) {
    if (appOrigin)
        window.parent.postMessage({ source: "nightjar-proxy", ...message }, appOrigin);
}
function webAddress(value) {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    }
    catch {
        return null;
    }
}
function titleFor(frame, fallback) {
    try {
        return frame.frame.contentDocument?.title.trim().slice(0, 120) || fallback;
    }
    catch {
        return fallback;
    }
}
function reportUrl(tabId, value, frame) {
    const url = webAddress(value);
    if (!url)
        return;
    const state = frames.get(tabId);
    if (state)
        state.url = url;
    send({ type: "nightjar:url", tabId, url, title: titleFor(frame, new URL(url).hostname) });
}
function createTabFrame(tabId) {
    if (!controller || !surface)
        throw new Error("The Scramjet controller is not ready.");
    const frame = controller.createFrame();
    frame.frame.className = "scramjet-frame";
    frame.frame.title = "Web page";
    frame.frame.hidden = true;
    frame.frame.setAttribute("allow", "camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'; clipboard-read 'none'; clipboard-write 'none'");
    const frameState = { frame, url: "" };
    frame.addEventListener("navigate", (event) => reportUrl(tabId, event.url, frame));
    frame.addEventListener("urlchange", (event) => reportUrl(tabId, event.url, frame));
    frame.frame.addEventListener("load", () => {
        const current = frames.get(tabId);
        if (!current)
            return;
        send({ type: "nightjar:loaded", tabId, url: current.url, title: titleFor(frame, current.url ? new URL(current.url).hostname : "Web page") });
    });
    frames.set(tabId, frameState);
    surface.append(frame.frame);
    return frameState;
}
async function initialize(grant) {
    if (initialized) {
        await connection?.setTransport("/epoxy/index.mjs", [{ wisp: wispAddress(grant) }]);
        send({ type: "nightjar:initialized" });
        return;
    }
    if (!navigator.serviceWorker)
        throw new Error("This browser does not support the service worker required by Scramjet.");
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
        await Promise.race([
            new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true })),
            new Promise((_, reject) => setTimeout(() => reject(new Error("The Scramjet service worker did not take control. Reload the workspace and try again.")), 8000)),
        ]);
    }
    if (!registration.active || !navigator.serviceWorker.controller)
        throw new Error("The Scramjet service worker is not active.");
    const { ScramjetController: Controller } = $scramjetLoadController();
    controller = new Controller({
        prefix: "/scramjet/",
        files: {
            wasm: "/scram/scramjet.wasm.wasm",
            all: "/scram/scramjet.all.js",
            sync: "/scram/scramjet.sync.js",
        },
    });
    await controller.init();
    connection = new BareMuxConnection("/baremux/worker.js");
    await connection.setTransport("/epoxy/index.mjs", [{ wisp: wispAddress(grant) }]);
    initialized = true;
    if (status)
        status.textContent = "";
    send({ type: "nightjar:initialized" });
}
function wispAddress(grant) {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${location.host}/wisp/?grant=${encodeURIComponent(grant)}/`;
}
function handleCommand(command) {
    if (command.type === "nightjar:init") {
        if (!/^[a-f0-9-]{36}$/i.test(command.appOrigin) && !/^https?:\/\/[^/]+$/.test(command.appOrigin)) {
            throw new Error("Nightjar sent an invalid application origin.");
        }
        appOrigin = command.appOrigin;
        void initialize(command.grant).catch((error) => {
            const message = error instanceof Error ? error.message : "The local browsing engine could not start.";
            if (status)
                status.textContent = message;
            send({ type: "nightjar:error", message });
        });
        return;
    }
    if (!initialized)
        throw new Error("The Scramjet browsing engine is not ready yet.");
    if (command.type === "nightjar:renew") {
        void initialize(command.grant).catch((error) => {
            const message = error instanceof Error ? error.message : "The local browsing session could not renew.";
            send({ type: "nightjar:error", message });
        });
        return;
    }
    if (command.type === "nightjar:shutdown") {
        for (const frame of frames.values())
            frame.frame.frame.remove();
        frames.clear();
        initialized = false;
        controller = null;
        connection = null;
        return;
    }
    if (!("tabId" in command))
        return;
    let current = frames.get(command.tabId);
    if (!current && ["nightjar:select", "nightjar:navigate"].includes(command.type))
        current = createTabFrame(command.tabId);
    if (!current)
        return;
    for (const [id, entry] of frames)
        entry.frame.frame.hidden = id !== command.tabId;
    switch (command.type) {
        case "nightjar:select": {
            const url = webAddress(command.url);
            if (!url)
                return;
            if (current.url !== url) {
                current.url = url;
                current.frame.go(url);
            }
            break;
        }
        case "nightjar:navigate": {
            const url = webAddress(command.url);
            if (!url)
                return;
            current.url = url;
            current.frame.go(url);
            break;
        }
        case "nightjar:back":
            current.frame.back();
            break;
        case "nightjar:forward":
            current.frame.forward();
            break;
        case "nightjar:reload":
            current.frame.reload();
            break;
        case "nightjar:stop":
            current.frame.frame.contentWindow?.stop();
            break;
        case "nightjar:close":
            current.frame.frame.remove();
            frames.delete(command.tabId);
            break;
    }
}
window.addEventListener("message", (event) => {
    if (event.source !== window.parent || typeof event.data !== "object" || event.data === null)
        return;
    if (event.data.type !== "nightjar:init" && event.origin !== appOrigin)
        return;
    try {
        handleCommand(event.data);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "The browsing request could not be completed.";
        send({ type: "nightjar:error", message });
    }
});
if (window.top === window.self) {
    if (status) {
        status.replaceChildren();
        const message = document.createElement("strong");
        message.textContent = "This is Nightjar’s internal browsing engine.";
        const detail = document.createElement("span");
        detail.textContent = "It only runs inside the Nightjar browser workspace.";
        const link = document.createElement("a");
        link.href = `http://${location.hostname}:4173/`;
        link.textContent = "Open Nightjar";
        status.append(message, detail, link);
        document.body.classList.add("standalone-shell");
    }
}
else {
    window.parent.postMessage({ source: "nightjar-proxy", type: "nightjar:ready" }, "*");
}
