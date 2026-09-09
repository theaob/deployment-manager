const { Issuer, generators, custom } = require('openid-client');
const https = require('https');
const fs = require('fs');
const { shouldRejectUnauthorized } = require('../lib/tls');

let oidcClient = null;
let httpDefaultsConfigured = false;

/**
 * Returns true if OIDC authentication is enabled.
 */
function isOidcEnabled() {
  return !!process.env.OIDC_ISSUER;
}

/**
 * Configures the HTTP options used by openid-client for discovery, token,
 * and userinfo requests, so a Keycloak instance on an internal/intranet CA
 * (or a genuinely self-signed cert) can be trusted without disabling TLS
 * verification process-wide.
 *
 * openid-client issues requests via Node's native https.request() and only
 * forwards a fixed allow-list of options (agent, ca, cert, ...) through
 * custom.setHttpOptionsDefaults(). Notably `rejectUnauthorized` is NOT in
 * that allow-list, so disabling verification has to go through a real
 * https.Agent instance rather than a plain options object.
 *
 * Environment variables:
 *   OIDC_CA_CERT_PATH          — Path to a PEM CA certificate (or bundle) to trust,
 *                                 in addition to Node's default trust store.
 *   OIDC_TLS_REJECT_UNAUTHORIZED — Set to "false" to skip certificate verification
 *                                 entirely for OIDC specifically (or set the global
 *                                 TLS_REJECT_UNAUTHORIZED to do this for OIDC, Rancher,
 *                                 Zulip, and SMTP all at once — see lib/tls.js). Only
 *                                 for internal/test environments — prefer
 *                                 OIDC_CA_CERT_PATH/NODE_EXTRA_CA_CERTS whenever possible.
 */
function configureHttpDefaults() {
  if (httpDefaultsConfigured) {
    return;
  }
  httpDefaultsConfigured = true;

  const caCertPath = process.env.OIDC_CA_CERT_PATH;
  const rejectUnauthorized = shouldRejectUnauthorized('OIDC_TLS_REJECT_UNAUTHORIZED');

  // Nothing to customize — use Node's default HTTPS behavior.
  if (!caCertPath && rejectUnauthorized) {
    return;
  }

  const httpOptions = {};

  if (caCertPath) {
    console.log(`[OIDC] Trusting CA certificate at: ${caCertPath}`);
    httpOptions.ca = fs.readFileSync(caCertPath);
  }

  if (!rejectUnauthorized) {
    console.warn('[OIDC] WARNING: TLS certificate verification is DISABLED for the OIDC provider (TLS_REJECT_UNAUTHORIZED or OIDC_TLS_REJECT_UNAUTHORIZED=false). Do not use this in production.');
    // Must be a real Agent instance — openid-client passes this straight to
    // https.request(), which rejects a plain { rejectUnauthorized: false } object.
    httpOptions.agent = new https.Agent({ rejectUnauthorized: false });
  }

  custom.setHttpOptionsDefaults(httpOptions);
}

/**
 * Discovers and returns the cached OIDC client instance.
 */
async function getOidcClient() {
  if (!isOidcEnabled()) {
    throw new Error('OIDC_ISSUER is not configured');
  }

  configureHttpDefaults();

  if (oidcClient) {
    return oidcClient;
  }

  const issuerUrl = process.env.OIDC_ISSUER;
  const clientId = process.env.OIDC_CLIENT_ID || 'deployment-manager';
  const redirectUri = process.env.OIDC_REDIRECT_URI || 'http://localhost:3000/api/auth/oidc/callback';
  const clientSecret = process.env.OIDC_CLIENT_SECRET;

  console.log(`[OIDC] Discovering endpoints for issuer: ${issuerUrl}`);
  const issuer = await Issuer.discover(issuerUrl);

  const clientOptions = {
    client_id: clientId,
    redirect_uris: [redirectUri],
    response_types: ['code'],
  };

  // openid-client defaults token_endpoint_auth_method to 'client_secret_basic'
  // regardless of whether a secret was supplied — for a public client
  // (Keycloak "Client authentication: Off") that must be overridden to
  // 'none', or the token exchange fails with
  // "client_secret_basic client authentication method requires a client_secret"
  // even though no secret was ever meant to be sent.
  if (clientSecret) {
    clientOptions.client_secret = clientSecret;
  } else {
    clientOptions.token_endpoint_auth_method = 'none';
  }

  oidcClient = new issuer.Client(clientOptions);
  console.log(`[OIDC] Client initialized successfully for client_id: "${clientId}"`);
  return oidcClient;
}

module.exports = {
  isOidcEnabled,
  getOidcClient,
  generators,
};
