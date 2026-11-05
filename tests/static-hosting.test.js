import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("builds a complete public static bundle with an explicit HTTPS API origin", async () => {
  const output = await mkdtemp(join(tmpdir(), "nightjar-static-test-"));
  try {
    execFileSync(process.execPath, [
      join(root, "scripts/build-static.mjs"),
      "--api-origin=https://api.example.test",
      `--output=${output}`,
    ], { cwd: root, stdio: "pipe" });

    const files = (await readdir(output)).sort();
    assert.deepEqual(files, [
      "admin.css", "admin.html", "admin.js", "api-config.js", "app.js",
      "bugs.html", "bugs.js", "index.html", "mark.svg", "styles.css",
    ]);
    const config = await readFile(join(output, "api-config.js"), "utf8");
    assert.match(config, /"apiBaseUrl":"https:\/\/api\.example\.test"/);
    assert.doesNotMatch(config, /localhost|127\.0\.0\.1|secret|password|token/i);

    for (const html of ["index.html", "admin.html", "bugs.html"]) {
      assert.match(await readFile(join(output, html), "utf8"), /api-config\.js/);
    }
    const app = await readFile(join(output, "app.js"), "utf8");
    const admin = await readFile(join(output, "admin.js"), "utf8");
    const bugs = await readFile(join(output, "bugs.js"), "utf8");
    assert.match(app, /fetch\(apiUrl\(path\)/);
    assert.match(admin, /fetch\(apiUrl\(path\)/);
    assert.match(bugs, /fetch\(apiUrl\("\/api\/session"\)/);
    for (const asset of files) {
      assert.doesNotMatch(await readFile(join(output, asset), "utf8"), /127\.0\.0\.1|localhost/);
    }
    for (const excluded of [".env", "server.js", "desktop-viewer.html", "desktop-viewer.js", "proxy-shell.html"]) {
      await assert.rejects(access(join(output, excluded)));
    }
    assert.throws(() => execFileSync(process.execPath, [
      join(root, "scripts/build-static.mjs"),
      "--api-origin=*",
      `--output=${join(output, "invalid")}`,
    ], { cwd: root, stdio: "pipe" }));
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
