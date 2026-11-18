function setPreviewHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function adminLoginLocation(req) {
  const requested = String(req.originalUrl || req.url || "/admin/workoutplanner-preview");
  const nextPath = requested.startsWith("/") && !requested.startsWith("//")
    ? requested
    : "/admin/workoutplanner-preview";
  return `/admin?next=${encodeURIComponent(nextPath)}`;
}

function createWorkoutPlannerMockPreviewAccess({ nodeEnv, previewsEnabled, isAdmin }) {
  const isProduction = nodeEnv === "production";
  const isDevelopmentPreviewEnabled = !isProduction && previewsEnabled;

  function unavailable(res) {
    return res.sendStatus(404);
  }

  function page(req, res, next) {
    setPreviewHeaders(res);
    if (!isProduction && !isDevelopmentPreviewEnabled) return unavailable(res);
    if (!isProduction || isAdmin(req)) return next();
    return res.redirect(adminLoginLocation(req));
  }

  function asset(req, res, next) {
    setPreviewHeaders(res);
    if (!isProduction && !isDevelopmentPreviewEnabled) return unavailable(res);
    if (!isProduction || isAdmin(req)) return next();
    return res.status(401).type("text/plain").send("Admin sign-in required.");
  }

  function adminPage(req, res, next) {
    setPreviewHeaders(res);
    if (!isProduction && !isDevelopmentPreviewEnabled) return unavailable(res);
    if (!isAdmin(req)) return res.redirect(adminLoginLocation(req));
    return next();
  }

  return { page, asset, adminPage };
}

module.exports = { createWorkoutPlannerMockPreviewAccess };
