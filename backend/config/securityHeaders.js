/**
 * HTTP security headers.
 *
 * The backend is a JSON API and renders no user-facing HTML, so a strict
 * Content-Security-Policy is safe to enforce. The single relaxation is
 * `style-src 'unsafe-inline'`, required by the React runtime of the Bull Board
 * queue dashboard mounted at /admin/queues (React injects inline <style> and
 * per-element style attributes). Scripts stay on 'self' -- no inline script,
 * no eval, no CDN.
 */
const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", "data:"],
  fontSrc: ["'self'", "data:"],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  frameAncestors: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  // Empty array = emit the directive with no upgrade list, which keeps the
  // policy identical across http (local) and https (production). Omitting it
  // would let helmet's defaults append an upgrade list.
  upgradeInsecureRequests: [],
};

/**
 * Build the helmet options used for the app.
 * @returns {import('helmet').HelmetOptions}
 */
function securityHeaders() {
  return {
    contentSecurityPolicy: { useDefaults: true, directives: CSP_DIRECTIVES },
    // The API is consumed cross-origin by the frontend origin, so CORP must
    // allow it. CSP is what actually restricts content.
    crossOriginResourcePolicy: { policy: "cross-origin" },
  };
}

module.exports = { CSP_DIRECTIVES, securityHeaders };