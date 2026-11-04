#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function validateDomain(domain) {
  if (typeof domain !== "string" || domain.length > 253 || domain !== domain.toLowerCase()) {
    throw new Error("Provide a lowercase DNS domain such as example.com.");
  }
  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((label) =>
    label.length < 1 || label.length > 63 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  )) {
    throw new Error("The domain must be a valid public DNS name (not an IP address or URL).");
  }
  if (/^\d+$/.test(labels.at(-1))) {
    throw new Error("The domain must end in a DNS name, not a numeric label.");
  }
  return domain;
}

export function readEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) return [];
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return [[match[1], value]];
  }));
}

function setEnvValue(lines, key, value) {
  const index = lines.findIndex((line) => new RegExp(`^\\s*${key}\\s*=`).test(line));
  if (index >= 0) lines[index] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
}

export function createDeploymentEnv(template, domain) {
  validateDomain(domain);
  const lines = template.split(/\r?\n/);
  const current = readEnv(template);

  const deploymentValues = {
    NODE_ENV: "production",
    APP_DOMAIN: domain,
    APP_ORIGIN: `https://${domain}`,
    RAMMERHEAD_ORIGIN: `https://proxy.${domain}`,
  };
  if (!current.ADMIN_INITIAL_PASSWORD || current.ADMIN_INITIAL_PASSWORD.startsWith("replace-with-")) {
    deploymentValues.ADMIN_INITIAL_PASSWORD = randomBytes(32).toString("base64url");
  }
  if (!current.DESKTOP_COMPANION_SECRET || current.DESKTOP_COMPANION_SECRET.startsWith("replace-with-")) {
    deploymentValues.DESKTOP_COMPANION_SECRET = randomBytes(32).toString("hex");
  }

  for (const [key, value] of Object.entries(deploymentValues)) {
    setEnvValue(lines, key, value);
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function fail(message) {
  console.error(`Setup error: ${message}`);
  process.exitCode = 1;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: ROOT, stdio: "inherit", ...options });
}

async function loadCurrentEnv() {
  try {
    return await readFile(resolve(ROOT, ".env"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function validateConfiguration(values, expectedDomain) {
  const domain = validateDomain(expectedDomain ?? values.APP_DOMAIN);
  if (values.NODE_ENV !== "production") throw new Error("NODE_ENV must be production for this deployment.");
  if (values.APP_ORIGIN !== `https://${domain}` || values.RAMMERHEAD_ORIGIN !== `https://proxy.${domain}`) {
    throw new Error(`APP_ORIGIN and RAMMERHEAD_ORIGIN must be https://${domain} and https://proxy.${domain}.`);
  }
  if (!values.ADMIN_INITIAL_PASSWORD || values.ADMIN_INITIAL_PASSWORD.length < 16 || values.ADMIN_INITIAL_PASSWORD.startsWith("replace-with-")) {
    throw new Error("ADMIN_INITIAL_PASSWORD must be a unique value of at least 16 characters.");
  }
  if (values.DESKTOP_COMPANION_SECRET && !/^[a-f0-9]{64}$/i.test(values.DESKTOP_COMPANION_SECRET)) {
    throw new Error("DESKTOP_COMPANION_SECRET must contain exactly 64 hexadecimal characters.");
  }
  return domain;
}

async function main(args) {
  let domain;
  let mode = "deploy";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--domain") domain = args[++index];
    else if (arg === "--dry-run") mode = "dry-run";
    else if (arg === "--check") mode = "check";
    else if (arg === "--help" || arg === "-h") mode = "help";
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (mode === "help") {
    console.log("Usage: npm run setup -- --domain example.com [--dry-run | --check]");
    console.log("Default: write a private production .env, validate Compose, and start Luma + Caddy.");
    console.log("--dry-run  Preview the generated configuration without writing files or starting services.");
    console.log("--check    Validate the existing .env and Docker Compose configuration without changing anything.");
    return;
  }

  const existing = await loadCurrentEnv();
  if (mode === "dry-run") {
    const chosenDomain = validateDomain(domain);
    const template = existing ?? await readFile(resolve(ROOT, ".env.example"), "utf8");
    const proposed = createDeploymentEnv(template, chosenDomain);
    console.log(`Would write .env (mode 0600) for https://${chosenDomain} and https://proxy.${chosenDomain}.`);
    console.log(`Would preserve existing credentials and settings${existing ? "" : ", generating initial secrets"}.`);
    console.log("Would run docker compose config --quiet, then docker compose up --build -d.");
    console.log("Would not configure remote S3 or Jellyfin accounts.");
    if (!existing) console.log(`Generated configuration contains a ${readEnv(proposed).ADMIN_INITIAL_PASSWORD.length}-character one-time owner bootstrap password; no values are printed.`);
    return;
  }

  if (mode === "check") {
    if (!existing) throw new Error("No .env file exists; run npm run setup -- --domain example.com first.");
    const values = readEnv(existing);
    const configuredDomain = validateConfiguration(values, domain);
    const compose = run("docker", ["compose", "config", "--quiet"]);
    if (compose.error || compose.status !== 0) throw new Error("Docker Compose configuration check failed; install Docker Compose and correct any reported errors.");
    console.log(`Configuration is valid for https://${configuredDomain} and https://proxy.${configuredDomain}.`);
    console.log("Docker Compose config parsed successfully. This check does not contact DNS, start containers, or modify S3/Jellyfin.");
    return;
  }

  const chosenDomain = validateDomain(domain);
  const template = existing ?? await readFile(resolve(ROOT, ".env.example"), "utf8");
  const deploymentEnv = createDeploymentEnv(template, chosenDomain);
  validateConfiguration(readEnv(deploymentEnv), chosenDomain);
  if (existing) console.log("Updating only deployment mode and origin values; preserving existing credentials and other settings.");
  else console.log("Creating .env with generated owner and companion secrets.");
  await writeFile(resolve(ROOT, ".env"), deploymentEnv, { mode: 0o600 });
  await chmod(resolve(ROOT, ".env"), 0o600);
  console.log("Wrote .env with owner-only permissions.");

  const config = run("docker", ["compose", "config", "--quiet"]);
  if (config.error || config.status !== 0) throw new Error("Docker Compose config failed. Correct the reported issue and rerun setup.");
  const up = run("docker", ["compose", "up", "--build", "-d"]);
  if (up.error || up.status !== 0) throw new Error("Docker Compose could not start the deployment. The generated .env was kept; correct the issue and rerun setup.");
  console.log(`Luma is starting at https://${chosenDomain}; proxy browsing uses https://proxy.${chosenDomain}.`);
  console.log("Point both DNS names to this host and allow inbound TCP 80/443 (UDP 443 is optional).");
  console.log("The generated ADMIN_INITIAL_PASSWORD is in .env; copy it to a secure password manager before the first owner login.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(fail);
}
