/**
 * LDAP/Active Directory authentication module using ldapts.
 *
 * Environment variables:
 *   AD_URL    — LDAP server URL, e.g. "ldap://10.0.1.50:389" or "ldaps://ad.corp.local:636"
 *   AD_DOMAIN — NetBIOS domain name, e.g. "CORP" (used as "CORP\username" for the bind)
 *   AD_BASE_DN — Base DN for user searches, e.g. "DC=corp,DC=local" (reserved for future use)
 *   AD_TLS_REJECT_UNAUTHORIZED — Set to "false" to accept self-signed certs (not recommended for production)
 */

const AD_URL = () => process.env.AD_URL || '';
const AD_DOMAIN = () => process.env.AD_DOMAIN || '';
const AD_BASE_DN = () => process.env.AD_BASE_DN || '';

/**
 * Returns true if AD authentication is configured.
 */
function isAdEnabled() {
  return !!AD_URL();
}

/**
 * Authenticate a user against Active Directory via LDAP bind.
 *
 * Uses ldapts (promise-based, maintained LDAP client).
 * The bind uses DOMAIN\username format by default.
 *
 * @param {string} username — The user's sAMAccountName (e.g. "jdoe")
 * @param {string} password — The user's password
 * @returns {Promise<{ success: boolean, username?: string, error?: string }>}
 */
async function authenticateWithLDAP(username, password) {
  if (!AD_URL()) {
    return { success: false, error: 'AD_URL is not configured' };
  }

  if (!username || !password) {
    return { success: false, error: 'Username and password are required' };
  }

  // Dynamic import — ldapts is an ESM-only package
  const { Client } = await import('ldapts');

  const tlsRejectUnauthorized = process.env.AD_TLS_REJECT_UNAUTHORIZED !== 'false';

  const clientOptions = {
    url: AD_URL(),
    connectTimeout: 10000,  // 10 seconds
    timeout: 15000,         // 15 seconds
  };

  // Support LDAPS with optional self-signed cert acceptance
  if (AD_URL().startsWith('ldaps://')) {
    clientOptions.tlsOptions = {
      rejectUnauthorized: tlsRejectUnauthorized,
    };
  }

  const client = new Client(clientOptions);

  // Construct the bind DN — use DOMAIN\username format
  const domain = AD_DOMAIN();
  const bindDN = domain ? `${domain}\\${username}` : username;

  try {
    await client.bind(bindDN, password);
    console.log(`[LDAP] Bind successful for "${username}"`);
    return { success: true, username: username.toLowerCase() };
  } catch (err) {
    const friendlyError =
      err.message && err.message.includes('data 52e')
        ? 'Invalid username or password'
        : err.message && (err.message.includes('InvalidCredentialsError') || err.message.includes('INVALID_CREDENTIALS'))
          ? 'Invalid username or password'
          : `Authentication failed: ${err.message}`;

    console.warn(`[LDAP] Bind failed for "${username}": ${err.message}`);
    return { success: false, error: friendlyError };
  } finally {
    try {
      await client.unbind();
    } catch {
      // Ignore unbind errors
    }
  }
}

module.exports = { isAdEnabled, authenticateWithLDAP };
