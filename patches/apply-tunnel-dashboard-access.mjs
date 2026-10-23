import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2];
assert(root, "Pass the upstream source directory as the first argument");
const guardPath = path.join(root, "src/dashboardGuard.js");
let guard = fs.readFileSync(guardPath, "utf8");

const importAnchor = 'import { hasTrustedPeerHeaders } from "@/lib/auth/trustedPeer";';
const guardAnchor = `async function canAccessLocalOnlyRoute(request) {
  if (await hasValidCliToken(request)) return true;`;
for (const anchor of [importAnchor, guardAnchor]) {
  assert.equal(guard.split(anchor).length - 1, 1,
    "Upstream dashboardGuard.js changed; review the tunnel dashboard patch");
}

guard = guard.replace(importAnchor,
  `${importAnchor}\nimport { canControlTunnelFromDashboard } from "./lib/auth/tunnelDashboardAccess.mjs";`);
guard = guard.replace(guardAnchor,
  `${guardAnchor}\n  if (await canControlTunnelFromDashboard(request, hasValidToken)) return true;`);

fs.copyFileSync(new URL("./tunnel-dashboard-access.mjs", import.meta.url),
  path.join(root, "src/lib/auth/tunnelDashboardAccess.mjs"));
fs.writeFileSync(guardPath, guard);
console.log("Applied authenticated dashboard access for Cloudflare tunnel controls");
