/**
 * Shared TLS-verification-disable resolver for every external service this
 * app calls over HTTPS — Keycloak (OIDC), Zulip, and SMTP. Each has its own
 * <SERVICE>_TLS_REJECT_UNAUTHORIZED env var (see middleware/oidc-auth.js,
 * lib/notifications.js), but on this app's typical intranet deployment
 * every one of them commonly sits on the same internal/self-signed CA — so
 * the single global TLS_REJECT_UNAUTHORIZED, set once, disables
 * verification for all of them at once instead of needing several
 * identical flags.
 *
 * Internal/test environments only — prefer trusting the actual CA via
 * NODE_EXTRA_CA_CERTS (a built-in Node.js mechanism that already covers
 * every one of these services with no code involved) or a service-specific
 * *_CA_CERT_PATH, rather than disabling verification.
 */

/**
 * @param {string} serviceEnvVar — that service's own override, e.g. 'OIDC_TLS_REJECT_UNAUTHORIZED'.
 * @returns {boolean} true (verify certificates, the safe default) unless
 *   the global TLS_REJECT_UNAUTHORIZED or this service's own env var is
 *   explicitly set to the string "false".
 */
function shouldRejectUnauthorized(serviceEnvVar) {
  if (process.env.TLS_REJECT_UNAUTHORIZED === 'false') {
    return false;
  }
  if (serviceEnvVar && process.env[serviceEnvVar] === 'false') {
    return false;
  }
  return true;
}

module.exports = { shouldRejectUnauthorized };
