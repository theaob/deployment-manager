const { Issuer, generators } = require('openid-client');

let oidcClient = null;

/**
 * Returns true if OIDC authentication is enabled.
 */
function isOidcEnabled() {
  return !!process.env.OIDC_ISSUER;
}

/**
 * Discovers and returns the cached OIDC client instance.
 */
async function getOidcClient() {
  if (!isOidcEnabled()) {
    throw new Error('OIDC_ISSUER is not configured');
  }

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
