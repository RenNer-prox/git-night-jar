import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assets = [
  "index.html",
  "app.js",
  "styles.css",
  "mark.svg",
  "admin.html",
  "admin.js",
  "admin.css",
  "bugs.html",
  "bugs.js",
];

function option(name) {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument?.slice(prefix.length);
}

const apiOrigin = option("api-origin") ?? process.env.LUMA_API_ORIGIN ?? "";
const outputDirectory = resolve(root, option("output") ?? "api-html");
let parsedOrigin;
try {
  parsedOrigin = new URL(apiOrigin);
  if (parsedOrigin.protocol !== "https:" || parsedOrigin.origin !== apiOrigin) throw new Error();
} catch {
  throw new Error("Provide LUMA_API_ORIGIN or --api-origin as a bare HTTPS API origin.");
}

await mkdir(outputDirectory, { recursive: true });
for (const asset of assets) {
  const contents = await readFile(resolve(root, "public", asset));
  await writeFile(resolve(outputDirectory, asset), contents);
}
await writeFile(
  resolve(outputDirectory, "api-config.js"),
  `window.LUMA_CONFIG = Object.freeze(${JSON.stringify({ apiBaseUrl: parsedOrigin.origin })});\n`,
);
console.info(`Built ${assets.length + 1} static assets in ${outputDirectory}.`);
