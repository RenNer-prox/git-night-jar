const surface = document.querySelector("#browsing-surface");
const status = document.querySelector("#engine-status");
const frames = new Map();
let appOrigin = "";
let sessionId = "";
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
        return frame.contentDocument?.title.trim().slice(0, 120) || fallback;
    }
    catch {
        return fallback;
    }
}
function frameAddress(frame, fallback) {
    try {
        const url = new URL(frame.contentWindow?.location.href ?? frame.src);
        const prefix = `/${sessionId}/`;
        if (!url.pathname.startsWith(prefix))
            return fallback;
        const destination = `${url.pathname.slice(prefix.length)}${url.search}${url.hash}`;
        return webAddress(destination) ?? fallback;
    }
    catch {
        return fallback;
    }
}
function reportUrl(tabId, frameState) {
    const url = frameAddress(frameState.frame, frameState.url);
    if (!url)
        return;
    frameState.url = url;
    send({ type: "nightjar:url", tabId, url, title: titleFor(frameState.frame, new URL(url).hostname) });
}
function handleSpecialNavigationClick(event, frame) {
    const element = event.target;
    const link = element?.closest("a");
    if (!link)
        return;
    const href = link.getAttribute("href-hammerhead-stored-value") ?? link.href;
    let destination;
    try {
        destination = new URL(href, frame.contentWindow?.location.href);
    }
    catch {
        return;
    }
    const hostname = destination.hostname.toLowerCase();
    const youtubeHost = hostname === "youtube.com" || hostname.endsWith(".youtube.com") || hostname === "youtu.be";
    const youtubePath = hostname === "youtu.be"
        ? /^\/[\w-]{11}(?:\/|$)/.test(destination.pathname)
        : /^\/(?:watch|shorts|live|embed|v)(?:\/|$)/i.test(destination.pathname);
    const youtubeVideo = destination.protocol === "https:" && youtubeHost && youtubePath;
    if (youtubeVideo) {
        event.preventDefault();
        event.stopPropagation();
        send({ type: "nightjar:youtube-navigate", url: destination.href });
        return;
    }
    if (destination.protocol !== "https:" || hostname !== "accounts.google.com")
        return;
    event.preventDefault();
    event.stopPropagation();
    // Google rejects its sign-in flow inside an embedded proxy frame.
    const popup = window.open(proxiedUrl(destination.href), "_blank");
    if (!popup) {
        send({ type: "nightjar:error", message: "Your browser blocked the Google sign-in window. Allow pop-ups and try again." });
        return;
    }
    popup.opener = null;
}
function createTabFrame(tabId) {
    if (!surface || !sessionId)
        throw new Error("The Rammerhead browsing engine is not ready.");
    const frame = document.createElement("iframe");
    frame.className = "rammerhead-frame";
    frame.title = "Web page";
    frame.hidden = true;
    frame.setAttribute("allow", "autoplay; encrypted-media; fullscreen; picture-in-picture; camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'; clipboard-read 'none'; clipboard-write 'none'");
    const frameState = { frame, url: "" };
    frame.addEventListener("load", () => {
        if (!frames.has(tabId))
            return;
        frame.contentDocument?.addEventListener("click", (event) => handleSpecialNavigationClick(event, frame), true);
        reportUrl(tabId, frameState);
        send({
            type: "nightjar:loaded",
            tabId,
            url: frameState.url,
            title: titleFor(frame, frameState.url ? new URL(frameState.url).hostname : "Web page"),
        });
    });
    frames.set(tabId, frameState);
    surface.append(frame);
    return frameState;
}
function proxiedUrl(url) {
    const address = webAddress(url);
    if (!address || !sessionId)
        throw new Error("Nightjar sent an invalid web address.");
    return `${location.origin}/${sessionId}/${address}`;
}
function initialize(command, origin) {
    if (!/^https?:\/\/[^/]+$/.test(command.appOrigin) || command.appOrigin !== origin) {
        throw new Error("Nightjar sent an invalid application origin.");
    }
    if (!/^[a-f0-9]{32}$/i.test(command.sessionId))
        throw new Error("Nightjar sent an invalid Rammerhead session.");
    appOrigin = command.appOrigin;
    sessionId = command.sessionId;
    initialized = true;
    if (status)
        status.textContent = "";
    send({ type: "nightjar:initialized" });
}
function handleCommand(command, origin) {
    if (command.type === "nightjar:init") {
        initialize(command, origin);
        return;
    }
    if (!initialized || origin !== appOrigin)
        return;
    if (command.type === "nightjar:shutdown") {
        for (const frame of frames.values())
            frame.frame.remove();
        frames.clear();
        initialized = false;
        sessionId = "";
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
        entry.frame.hidden = id !== command.tabId;
    switch (command.type) {
        case "nightjar:select": {
            const url = webAddress(command.url);
            if (!url)
                return;
            if (current.url !== url) {
                current.url = url;
                current.frame.src = proxiedUrl(url);
            }
            break;
        }
        case "nightjar:navigate": {
            const url = webAddress(command.url);
            if (!url)
                return;
            current.url = url;
            current.frame.src = proxiedUrl(url);
            break;
        }
        case "nightjar:back":
            current.frame.contentWindow?.history.back();
            break;
        case "nightjar:forward":
            current.frame.contentWindow?.history.forward();
            break;
        case "nightjar:reload":
            current.frame.contentWindow?.location.reload();
            break;
        case "nightjar:stop":
            current.frame.contentWindow?.stop();
            break;
        case "nightjar:close":
            current.frame.remove();
            frames.delete(command.tabId);
            break;
    }
}
window.addEventListener("message", (event) => {
    if (event.source !== window.parent || typeof event.data !== "object" || event.data === null)
        return;
    try {
        handleCommand(event.data, event.origin);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "The Rammerhead request could not be completed.";
        send({ type: "nightjar:error", message });
    }
});
if (window.top === window.self) {
    if (status) {
        status.replaceChildren();
        const message = document.createElement("strong");
        message.textContent = "This is Nightjar’s internal Rammerhead engine.";
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
export {};
