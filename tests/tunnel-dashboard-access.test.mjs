import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { canControlTunnelFromDashboard } from "../patches/tunnel-dashboard-access.mjs";

const originalOrigin = process.env.TUNNEL_DASHBOARD_ORIGIN;
beforeEach(() => { process.env.TUNNEL_DASHBOARD_ORIGIN = "http://9router.localnetwork"; });
after(() => {
  if (originalOrigin === undefined) delete process.env.TUNNEL_DASHBOARD_ORIGIN;
  else process.env.TUNNEL_DASHBOARD_ORIGIN = originalOrigin;
});

function request({ pathname = "/api/tunnel/enable", method = "POST", headers = {}, session = "valid" } = {}) {
  return {
    method,
    nextUrl: { pathname },
    headers: new Headers({
      host: "9router.localnetwork",
      origin: "http://9router.localnetwork",
      "sec-fetch-site": "same-origin",
      ...headers,
    }),
    session,
  };
}

const verifySession = async (req) => req.session === "valid";

test("a logged-in dashboard can enable and disable its tunnel", async () => {
  for (const pathname of ["/api/tunnel/enable", "/api/tunnel/disable"]) {
    assert.equal(await canControlTunnelFromDashboard(request({ pathname }), verifySession), true);
  }
});

test("missing or invalid sessions remain denied", async () => {
  for (const session of [undefined, null, "expired", "invalid"]) {
    const req = request();
    req.session = session;
    assert.equal(await canControlTunnelFromDashboard(req, verifySession), false);
  }
});

test("cross-origin and tunnel requests remain denied, including with a valid session", async () => {
  for (const headers of [
    { origin: "https://remote.example", host: "remote.example" },
    { origin: "https://remote.example" },
    { origin: "null" },
    { origin: "" },
    { host: "remote.example" },
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site" },
  ]) {
    assert.equal(await canControlTunnelFromDashboard(request({ headers }), verifySession), false);
  }
});

test("only exact Cloudflare enable/disable paths with POST are allowed", async () => {
  for (const pathname of [
    "/api/tunnel/enable/extra", "/api/tunnel/disable/extra",
    "/api/tunnel/tailscale-enable", "/api/tunnel/tailscale-install",
    "/api/auth/reset-password", "/api/headroom/start",
  ]) {
    assert.equal(await canControlTunnelFromDashboard(request({ pathname }), verifySession), false);
  }
  for (const method of ["GET", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    assert.equal(await canControlTunnelFromDashboard(request({ method }), verifySession), false);
  }
});

test("an absent or malformed opt-in fails closed", async () => {
  for (const origin of [undefined, "", "invalid", "file:///tmp", "http://9router.localnetwork/path", "http://9router.localnetwork/"]) {
    if (origin === undefined) delete process.env.TUNNEL_DASHBOARD_ORIGIN;
    else process.env.TUNNEL_DASHBOARD_ORIGIN = origin;
    assert.equal(await canControlTunnelFromDashboard(request(), verifySession), false);
  }
});

test("a browser without Sec-Fetch-Site still needs the correct origin and session", async () => {
  const req = request();
  req.headers.delete("sec-fetch-site");
  assert.equal(await canControlTunnelFromDashboard(req, verifySession), true);
  req.session = null;
  assert.equal(await canControlTunnelFromDashboard(req, verifySession), false);
});
