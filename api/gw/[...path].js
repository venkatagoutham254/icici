/**
 * Server-side proxy to Protean's gateway.
 *
 * Why this exists
 * ---------------
 * The console is a static page. Anything it needs to authenticate with is
 * downloaded by the browser, so a key in session.json is readable by anyone who
 * opens the site — and that key bills ICICI. Injecting it at build time changes
 * nothing: it still ships to every visitor. There is no arrangement in which a
 * browser holds a long-lived API key and that key stays private.
 *
 * So the key lives here instead, in a Vercel environment variable that is only
 * ever read server-side. The browser calls /api/gw/<path> on its own origin;
 * this function attaches the credential and forwards to the gateway. The key is
 * never in git, never in the bundle, and never in a response.
 *
 * Setting ICICI_API_KEY in Vercel is what makes this work. Without it the
 * function refuses rather than forwarding an unauthenticated call that would
 * come back as an unexplained 401.
 *
 * CommonJS, not ESM: the repo has no package.json, so Vercel's Node runtime
 * treats .js as CommonJS and an `export default` here fails at runtime with a
 * 500 that says nothing about the cause.
 */

// Only these reach the gateway. A catch-all proxy with a live credential
// attached is an open relay for anything the gateway will accept, so the set is
// closed rather than filtered.
const ALLOWED = new Set([
  'POST /ekyc/v1/otp',
  'POST /ekyc/v1/verify',
  'POST /ekyc/v1/demographic',
  'POST /pan/v1/verify',
  'POST /pan/v1/link-status',
  'POST /esign/v1/initiate',
  'POST /esign/v1/complete',
  'POST /digilocker/v1/fetch',
  'GET /digilocker/v1/documents',
]);

module.exports = async function handler(req, res) {
  const apiKey = process.env.ICICI_API_KEY;
  const gateway = process.env.PROTEAN_GATEWAY_URL;

  if (!apiKey || !gateway) {
    return res.status(500).json({
      message:
        'Console is misconfigured: set ICICI_API_KEY and PROTEAN_GATEWAY_URL ' +
        'in the Vercel project environment, then redeploy.',
    });
  }

  // Derive the path from the URL rather than req.query.path. The [...path]
  // segment is only populated by Vercel's filesystem routing; when vercel.json
  // sends the request here through an explicit `routes` dest, req.query.path is
  // empty and every call is rejected as "Not a proxied route: POST /". Parsing
  // the URL works under both, so routing config cannot silently break this.
  const full = req.url || '/';
  const qIndex = full.indexOf('?');
  const pathname = qIndex === -1 ? full : full.slice(0, qIndex);
  const qs = qIndex === -1 ? '' : full.slice(qIndex);

  const path = pathname.replace(/^\/api\/gw/, '') || '/';
  const route = `${req.method} ${path}`;

  if (!ALLOWED.has(route)) {
    return res.status(404).json({ message: `Not a proxied route: ${route}` });
  }

  let upstream;
  try {
    upstream = await fetch(gateway + path + qs, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        // Attached here and only here. Note this overwrites rather than merges:
        // a client sending its own X-API-Key cannot substitute one.
        'X-API-Key': apiKey,
      },
      body: req.method === 'GET' ? undefined : JSON.stringify(req.body ?? {}),
    });
  } catch (e) {
    return res.status(502).json({
      message: `Could not reach Protean's gateway at ${gateway}. ${e.message}`,
    });
  }

  const text = await upstream.text();
  res.status(upstream.status);
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
  return res.send(text);
};
