const { Issuer, generators, custom } = require('openid-client');
const https = require('https');
const fs = require('fs');

let oidcClient = null;
let httpDefaultsConfigured = false;

/**
 * Returns true if OIDC authentication is enabled.
 */
function isOidcEnabled() {
  return !!process.env.OIDC_ISSUER;
}

/**
 * Configures the HTTPS agent used by openid-client for discovery, token,
 * and userinfo requests, so a Keycloak instance on an internal/intranet CA
 * (or a genuinely self-signed cert) can be trusted without disabling TLS
 * verification process-wide.
 *
 * Environment variables:
 *   OIDC_CA_CERT_PATH          — Path to a PEM CA certificate (or bundle) to trust,
 *                                 in addition to Node's default trust store.
 *   OIDC_TLS_REJECT_UNAUTHORIZED — Set to "false" to skip certificate verification
 *                                 entirely. Only for internal/test environments —
 *                                 prefer OIDC_CA_CERT_PATH whenever possible.
 */
function configureHttpDefaults() {
  if (httpDefaultsConfigured) {
    return;
  }
  httpDefaultsConfigured = true;

  const caCertPath = process.env.OIDC_CA_CERT_PATH;
  const rejectUnauthorized = process.env.OIDC_TLS_REJECT_UNAUTHORIZED !== 'false';

  // Nothing to customize — use Node's default HTTPS behavior.
  if (!caCertPath && rejectUnauthorized) {
    return;
  }

  const agentOptions = { rejectUnauthorized };
  if (caCertPath) {
    console.log(`[OIDC] Trusting CA certificate at: ${caCertPath}`);
    agentOptions.ca = fs.readFileSync(caCertPath);
  }
  if (!rejectUnauthorized) {
    console.warn('[OIDC] WARNING: OIDC_TLS_REJECT_UNAUTHORIZED=false — TLS certificate verification is DISABLED for the OIDC provider. Do not use this in production.');
  }

  custom.setHttpOptionsDefaults({
    agent: { https: new https.Agent(agentOptions) },
  });
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

  // Only supply client_secret if configured (for confidential clients)
  // Public clients do not require a secret.
  if (clientSecret) {
    clientOptions.client_secret = clientSecret;
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
