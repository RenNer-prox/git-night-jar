import { runAdminCommand } from "./server.js";

function help() {
  console.log(`Nightjar owner CLI

Run npm start in an interactive terminal and type commands at the
nightjar> prompt. You can also run these directly from another terminal.
Only the local owner can access the database.

  npm run manage -- accounts list
  npm run manage -- tokens list
  npm run manage -- tokens create --label "Guest laptop" [options]
  npm run manage -- tokens revoke <token-id>

Create options:
  --account-label <name>          Account label (defaults to token label)
  --account-id <uuid>             Add an invitation to an existing account
  --uses <number|unlimited>       Successful sign-ins for this invitation
  --expires <date-or-timestamp>   Expiration, e.g. 2026-12-31
  --permissions <list>            browse,bookmarks,history,settings,assistant
  --features <list|none>          bookmarks,history,settings,assistant

Features require matching permissions. --uses limits this invitation token;
it is not an aggregate limit across every invitation for an account. The raw
token is printed only once when created. Copy it and share it privately.`);
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
