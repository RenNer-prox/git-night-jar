import { runAdminCommand } from "./server.js";

function help() {
  console.log(`Nightjar owner CLI

Run npm start in an interactive terminal and type commands at the
nightjar> prompt. You can also run these directly from another terminal.
Only the local owner can access the database.

  npm run manage -- accounts list
  npm run manage -- tokens list
  npm run manage -- ranks list
  npm run manage -- tokens create --label "Guest laptop" [options]
  npm run manage -- tokens revoke <token-id>

Create options:
  --account-label <name>          Account label (defaults to token label)
  --account-id <uuid>             Add an invitation to an existing account
  --uses <number|unlimited>       Successful sign-ins for this invitation
  --expires <date-or-timestamp>   Expiration, e.g. 2026-12-31
  --rank <rank-id>                basic,basic-plus,ai,full-minus,owner
  --permissions <list>            browse,bookmarks,history,settings,assistant,games,support
  --features <list|none>          bookmarks,history,settings,assistant,games,support

Basic and Basic+ receive 20 lifetime local AI requests per token; AI, Full- and
Owner receive unlimited local AI. Full- adds toolbar and title/icon customization.
Only the explicitly assigned Owner rank can access the owner console. Features
require matching permissions. Invitations
are single-use; the raw token is printed once and must be shared privately.`);
}

try {
  const args = process.argv.slice(2);
  const result = await runAdminCommand(args);
  if (result.type === "help") {
    help();
  } else if (result.type === "created") {
    console.log(`Invitation created for ${result.accountLabel}. Copy this token now; it cannot be retrieved later:\n\n${result.token}\n\nToken ID: ${result.id}\nAccount ID: ${result.accountId}\nPermissions: ${result.permissions.join(", ")}\nFeatures: ${result.features.length ? result.features.join(", ") : "none"}\nUse limit: ${result.usageLimit ?? "unlimited"}\nExpires: ${result.expiresAt ?? "never"}`);
  } else if (result.type === "revoked") {
    console.log(`Invitation ${result.id} revoked. Any session established with that invitation was terminated.`);
  } else if (result.type === "tokens") {
    if (!result.items.length) console.log("No invitations yet.");
    for (const item of result.items) {
      console.log(`${item.status.padEnd(8)} ${item.id}  ${item.account_label} / ${item.label}  ${item.usage_count}/${item.usage_limit ?? "∞"} uses  [${item.permissions.join(", ")}]`);
    }
  } else if (result.type === "ranks") {
    if (!result.items.length) console.log("No access ranks are configured.");
    for (const item of result.items) console.log(`${item.id.padEnd(16)} ${item.label} [${item.permissions.join(", ")}] features=[${item.features.join(", ") || "none"}]`);
  } else if (result.type === "accounts") {
    if (!result.items.length) console.log("No accounts yet.");
    for (const item of result.items) {
      console.log(`${item.revoked_at ? "revoked" : "active "} ${item.id}  ${item.label}  permissions=[${item.permissions.join(", ")}] features=[${item.features.join(", ") || "none"}]`);
    }
  }
} catch (error) {
  console.error(`Nightjar CLI: ${error.message}`);
  process.exitCode = 1;
}
