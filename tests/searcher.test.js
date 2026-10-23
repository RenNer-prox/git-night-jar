import test from "node:test";
import assert from "node:assert/strict";
import { resolveAddress } from "../desktop-searcher/address.js";

test("searches bare text using the selected search engine", () => {
  const query = "nightjar browser search test";
  assert.equal(resolveAddress(query, "bing"), `https://www.bing.com/search?q=${encodeURIComponent(query)}`);
  assert.equal(resolveAddress(query, "google"), `https://www.google.com/search?q=${encodeURIComponent(query)}`);
  assert.equal(resolveAddress(query, "duckduckgo"), `https://duckduckgo.com/?q=${encodeURIComponent(query)}`);
  assert.equal(resolveAddress(query, "brave"), `https://search.brave.com/search?q=${encodeURIComponent(query)}`);
  assert.equal(resolveAddress(query, "yandex"), `https://yandex.com/search/?text=${encodeURIComponent(query)}`);
});

test("searches address-like input without a recognized domain suffix", () => {
  assert.equal(resolveAddress("nightjar", "google"), "https://www.google.com/search?q=nightjar");
  assert.equal(resolveAddress("nightjar.invalidtld/path", "bing"), "https://www.bing.com/search?q=nightjar.invalidtld%2Fpath");
  assert.equal(resolveAddress("localhost:4173", "google"), "https://localhost:4173/");
  assert.equal(resolveAddress("127.0.0.1:8080", "google"), "https://127.0.0.1:8080/");
});

test("opens recognized domains and explicit HTTP(S) URLs directly", () => {
  assert.equal(resolveAddress("example.com/path", "duckduckgo"), "https://example.com/path");
  assert.equal(resolveAddress("example.org:8443/page", "brave"), "https://example.org:8443/page");
  assert.equal(resolveAddress("http://example.net/", "google"), "http://example.net/");
});

test("rejects unsafe schemes, credentials, and unknown search providers", () => {
  assert.throws(() => resolveAddress("javascript:alert(1)", "google"), /Only HTTP\(S\)/);
  assert.throws(() => resolveAddress("https://user:pass@example.com", "google"), /valid HTTP\(S\)/);
  assert.throws(() => resolveAddress("nightjar", "unknown"), /supported search engine/);
});
