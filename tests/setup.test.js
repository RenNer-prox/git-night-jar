import test from "node:test";
import assert from "node:assert/strict";
import { createDeploymentEnv, readEnv, validateDomain } from "../scripts/setup.mjs";

test("validates a plain lowercase DNS domain", () => {
  assert.equal(validateDomain("example.com"), "example.com");
  assert.throws(() => validateDomain("https://example.com"), /valid public DNS name/);
  assert.throws(() => validateDomain("example.com/path"), /DNS name/);
  assert.throws(() => validateDomain("127.0.0.1"), /DNS name/);
  assert.throws(() => validateDomain("Example.com"), /lowercase/);
});

test("generates secure deployment settings and keeps existing credentials", () => {
  const generated = createDeploymentEnv(
    "NODE_ENV=development\nADMIN_INITIAL_PASSWORD=replace-with-a-long-random-password\nDESKTOP_COMPANION_SECRET=replace-with-64-hex-characters\nCUSTOM_SETTING=keep-me\n",
    "luma.example.com",
  );
  const values = readEnv(generated);

  assert.equal(values.NODE_ENV, "production");
  assert.equal(values.APP_DOMAIN, "luma.example.com");
  assert.equal(values.APP_ORIGIN, "https://luma.example.com");
  assert.equal(values.RAMMERHEAD_ORIGIN, "https://proxy.luma.example.com");
  assert.match(values.ADMIN_INITIAL_PASSWORD, /^[A-Za-z0-9_-]{40,}$/);
  assert.match(values.DESKTOP_COMPANION_SECRET, /^[a-f0-9]{64}$/);
  assert.equal(values.CUSTOM_SETTING, "keep-me");
});

test("preserves configured secrets and safely updates deployment origins on rerun", () => {
  const existing = [
    "NODE_ENV=production",
    'ADMIN_INITIAL_PASSWORD="original owner # password with punctuation"',
    `DESKTOP_COMPANION_SECRET=${"a".repeat(64)}`,
    "APP_DOMAIN=old.example.com",
    "APP_ORIGIN=https://old.example.com",
    "RAMMERHEAD_ORIGIN=https://proxy.old.example.com",
    "CUSTOM_SETTING=keep-me",
  ].join("\n");
  const rerun = createDeploymentEnv(existing, "new.example.org");
  const values = readEnv(rerun);

  assert.equal(values.ADMIN_INITIAL_PASSWORD, "original owner # password with punctuation");
  assert.ok(rerun.includes('ADMIN_INITIAL_PASSWORD="original owner # password with punctuation"'));
  assert.equal(values.DESKTOP_COMPANION_SECRET, "a".repeat(64));
  assert.equal(values.APP_DOMAIN, "new.example.org");
  assert.equal(values.APP_ORIGIN, "https://new.example.org");
  assert.equal(values.RAMMERHEAD_ORIGIN, "https://proxy.new.example.org");
  assert.equal(values.CUSTOM_SETTING, "keep-me");
  assert.equal(rerun.match(/^APP_ORIGIN=/gm)?.length, 1);
  assert.equal(createDeploymentEnv(rerun, "new.example.org"), rerun);
});
