import { isIP } from "node:net";

const MAX_ADDRESS_LENGTH = 2048;

export const SEARCH_PROVIDERS = {
  bing: "https://www.bing.com/search?q=",
  google: "https://www.google.com/search?q=",
  duckduckgo: "https://duckduckgo.com/?q=",
  brave: "https://search.brave.com/search?q=",
  yandex: "https://yandex.com/search/?text=",
};

const COMMON_TLDS = new Set([
  "aero", "app", "art", "asia", "biz", "blog", "cloud", "co", "com", "coop", "dev",
  "digital", "edu", "email", "gov", "info", "int", "io", "mil", "museum", "name",
  "net", "online", "org", "pro", "shop", "site", "store", "tech", "today", "travel",
  "tv", "xyz", "yandex",
]);

export function isWebUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username && !url.password && url.href.length <= MAX_ADDRESS_LENGTH;
  } catch {
    return false;
  }
}

function looksLikeDomain(value) {
  if (/\s/.test(value)) return false;
  try {
    const hostname = new URL(`https://${value}`).hostname.toLowerCase().replace(/\.$/, "");
    if (hostname === "localhost" || hostname.endsWith(".localhost") || isIP(hostname)) return true;
    const labels = hostname.split(".");
    const suffix = labels.at(-1);
    return labels.length > 1 && (suffix.length === 2 || COMMON_TLDS.has(suffix));
  } catch {
    return false;
  }
}

export function resolveAddress(value, provider) {
  const address = value.trim();
  if (!address || address.length > MAX_ADDRESS_LENGTH || /[\u0000-\u001f]/.test(address)) {
    throw new Error("Enter a search or web address.");
  }
  if (/^(javascript|data|file|vbscript):/i.test(address)) {
    throw new Error("Only HTTP(S) websites and search terms are supported.");
  }

  if (/^https?:\/\//i.test(address)) {
    if (!isWebUrl(address)) throw new Error("Enter a valid HTTP(S) address.");
    return new URL(address).href;
  }

  const hostWithPort = /^[^\s/]+:\d+(?:\/|$)/.test(address);
  if (/^[a-z][a-z0-9+.-]*:/i.test(address) && !hostWithPort && !/\s/.test(address)) {
    throw new Error("Only HTTP(S) websites and search terms are supported.");
  }

  const candidate = `https://${address}`;
  if (isWebUrl(candidate) && looksLikeDomain(address)) return new URL(candidate).href;
  if (!Object.hasOwn(SEARCH_PROVIDERS, provider)) throw new Error("Choose a supported search engine.");
  return SEARCH_PROVIDERS[provider] + encodeURIComponent(address);
}
