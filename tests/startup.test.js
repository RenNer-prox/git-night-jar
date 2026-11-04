import test from "node:test";
import assert from "node:assert/strict";
import { formatAddressConflict } from "../server.js";

test("startup port conflicts identify the collision and offer safe port overrides", () => {
  const appMessage = formatAddressConflict("Luma", "127.0.0.1", 4173, 'LISTEN 0 511 127.0.0.1:4173 users:(("node",pid=1234,fd=9))');
  assert.match(appMessage, /Luma cannot bind 127\.0\.0\.1:4173 \(EADDRINUSE\)/);
  assert.match(appMessage, /pid=1234/);
  assert.match(appMessage, /PORT=4175 npm start/);
  assert.match(appMessage, /Leave the existing process untouched/);

  const proxyMessage = formatAddressConflict("Rammerhead", "127.0.0.1", 4174);
  assert.match(proxyMessage, /RAMMERHEAD_PORT=4175 npm start/);
  assert.match(proxyMessage, /update its Rammerhead upstream/);
  assert.match(proxyMessage, /lsof -nP -iTCP:4174/);
});
