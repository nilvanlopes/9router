const TUNNEL_CONTROL_PATHS = new Set([
  "/api/tunnel/enable",
  "/api/tunnel/disable",
]);

// This exception requires a real dashboard session, even when requireLogin=false.
// Origin and Host limit it to the explicitly configured dashboard address.
export async function canControlTunnelFromDashboard(request, hasValidSession) {
  const configuredOrigin = process.env.TUNNEL_DASHBOARD_ORIGIN;
  if (!configuredOrigin || request.method !== "POST") return false;
  if (!TUNNEL_CONTROL_PATHS.has(request.nextUrl.pathname)) return false;

  let origin;
  try {
    origin = new URL(configuredOrigin);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(origin.protocol)) return false;
  if (origin.origin !== configuredOrigin) return false;
  if (request.headers.get("origin") !== configuredOrigin) return false;
  if (request.headers.get("host")?.toLowerCase() !== origin.host) return false;

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;

  return (await hasValidSession(request)) === true;
}
