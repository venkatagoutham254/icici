#!/usr/bin/env node
/*
 * Mints the access token the console presents to Protean's gateway, and writes
 * the config the page reads at boot.
 *
 * In production ICICI would receive this token from Protean's auth service
 * using their client credentials. Minting it here keeps the console runnable on
 * its own, and the claims are identical either way -- the gateway verifies the
 * signature and forwards customer_id and key_id, which is what every metered
 * event is attributed to.
 *
 * The keypair is generated fresh on each run and never written to the repo, so
 * nothing here is a usable credential.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8').split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
  );
}
const dotenv = loadDotEnv();
const env = (k, d) => process.env[k] || dotenv[k] || d;

const CONFIG = {
  gatewayUrl: env('PROTEAN_GATEWAY_URL', 'http://localhost:8000'),
  // The credential the console actually authenticates with. The gateway's
  // key-auth plugin reads X-API-Key; the RS256 token minted below is a separate
  // path (the metering plugin's jwt_validation_enabled mode) and is not what
  // this deployment checks.
  apiKey: env('ICICI_API_KEY', 'REPLACE_WITH_API_KEY'),
  customerId: env('ICICI_CUSTOMER_ID', 'REPLACE_WITH_CUSTOMER_ID'),
  keyId: env('ICICI_KEY_ID', 'REPLACE_WITH_KEY_ID'),
  tenantId: env('PROTEAN_TENANT_ID', 'protean'),
  issuer: env('TOKEN_ISSUER', 'https://auth.aforo.ai'),
};

// Refuse to mint a token that would meter into nobody. A console that starts
// with placeholder identity produces events the ingestor rejects for a missing
// customer, which surfaces much later as an empty usage report rather than as
// the configuration mistake it is.
const missing = Object.entries(CONFIG)
  .filter(([, v]) => String(v).startsWith('REPLACE_WITH_'))
  .map(([k]) => k);
if (missing.length) {
  console.error('\nCannot mint a session -- these still hold placeholder values:\n');
  for (const k of missing) console.error(`  ${k}`);
  console.error(`
Copy .env.example to .env and fill in the identity Protean issued to ICICI:
  ICICI_API_KEY      the sk_live_... key the console sends as X-API-Key
  ICICI_CUSTOMER_ID  the customer id from Protean's Aforo workspace
  ICICI_KEY_ID       the keyId of the API key bound to ICICI's subscription

Also set PROTEAN_GATEWAY_URL to the public gateway. It defaults to
http://localhost:8000, which from a hosted page means the visitor's own
machine -- and an https page blocks the plain-http call outright.
`);
  process.exit(1);
}

const b64url = (b) => Buffer.from(b).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const now = Math.floor(Date.now() / 1000);
const claims = {
  iss: CONFIG.issuer,
  sub: CONFIG.customerId,
  tenant_id: CONFIG.tenantId,
  customer_id: CONFIG.customerId,
  key_id: CONFIG.keyId,
  scopes: 'usage:ingest',
  environment: 'live',
  iat: now,
  exp: now + 8 * 3600,
  jti: crypto.randomUUID(),
};
const header = { alg: 'RS256', typ: 'JWT' };
const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
const token = `${signingInput}.${b64url(crypto.sign('sha256', Buffer.from(signingInput), privateKey))}`;

fs.writeFileSync(path.join(ROOT, 'public', 'session.json'),
  JSON.stringify({
    apiKey: CONFIG.apiKey,
    token,
    gatewayUrl: CONFIG.gatewayUrl,
    customerId: CONFIG.customerId,
    expiresAt: claims.exp,
  }, null, 2));
fs.writeFileSync(path.join(ROOT, 'protean-gateway-public-key.pem'), publicKey);

console.log('Wrote public/session.json and protean-gateway-public-key.pem\n');
console.log(`  gateway     ${CONFIG.gatewayUrl}`);
console.log(`  customer    ${CONFIG.customerId}`);
console.log(`  key_id      ${CONFIG.keyId}`);
console.log(`  valid for   8 hours\n`);
console.log('Set the PEM above as jwt_public_key on Protean\'s gateway so it can');
console.log('verify this token, then reload the console.\n');
