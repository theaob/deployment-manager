const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { JWT_SECRET } = require('../middleware/auth');
const { isAdEnabled, authenticateWithLDAP } = require('../middleware/ldap-auth');
const { isOidcEnabled, getOidcClient, generators } = require('../middleware/oidc-auth');

const router = express.Router();

/**
 * GET /api/auth/mode
 * Returns the current authentication mode so the frontend knows
 * whether to show a password field or auto-login.
 */
router.get('/mode', (req, res) => {
  if (isOidcEnabled()) {
    return res.json({ mode: 'oidc' });
  }
  if (process.env.SSO_HEADER) {
    return res.json({ mode: 'sso' });
  }
  res.json({ mode: isAdEnabled() ? 'ad' : 'local' });
});

/**
 * POST /api/auth/login
 * Logs in (or registers) a user.
 *
 * SSO mode:    Reads username from the proxy-injected HTTP header specified by SSO_HEADER.
 * Local mode:  Body: { username: string }
 * AD mode:     Body: { username: string, password: string }
 */
router.post('/login', async (req, res) => {
  let username = req.body.username;
  const password = req.body.password;
  const ssoHeaderName = process.env.SSO_HEADER;

  if (ssoHeaderName) {
    // Header keys are lowercased by Express/Node
    const ssoUser = req.headers[ssoHeaderName.toLowerCase()];
    if (!ssoUser || typeof ssoUser !== 'string' || ssoUser.trim().length === 0) {
      return res.status(401).json({
        error: `SSO authentication failed: Trusted header "${ssoHeaderName}" is missing or empty.`
      });
    }
    username = ssoUser;
  } else {
    // Standard login validation
    if (!username || typeof username !== 'string' || username.trim().length === 0) {
      return res.status(400).json({ error: 'Username is required' });
    }
  }

  const cleanUsername = username.trim().toLowerCase();
  const displayName = username.trim();

  // --- AD mode (non-SSO): validate credentials via LDAP bind ---
  if (!ssoHeaderName && isAdEnabled()) {
    if (!password) {
      return res.status(400).json({ error: 'Password is required for Active Directory login' });
    }

    const result = await authenticateWithLDAP(cleanUsername, password);
    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }
  }

  // --- Lookup or auto-register user ---
  let user = db.prepare('SELECT * FROM users WHERE username = ?').get(cleanUsername);

  if (!user) {
    // Create new user — first user becomes admin
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const role = userCount === 0 ? 'admin' : 'user';
    const id = uuidv4();

    db.prepare('INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)').run(
      id, cleanUsername, displayName, role
    );

    user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }

  // --- Generate JWT token ---
  const token = jwt.sign(
    { id: user.id, username: user.username, display_name: user.display_name, role: user.role },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
    },
  });
});

/**
 * GET /api/auth/me
 * Returns the current authenticated user's info.
 */
router.get('/me', (req, res) => {
  const user = db.prepare('SELECT id, username, display_name, role, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({ user });
});

/**
 * GET /api/auth/oidc/login
 * Starts the OIDC auth flow by redirecting the browser to Keycloak.
 */
router.get('/oidc/login', async (req, res) => {
  try {
    const client = await getOidcClient();
    const code_verifier = generators.codeVerifier();
    const state = generators.state();

    // Store verifiers temporarily in httpOnly cookies (valid for 5 minutes)
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('oidc_code_verifier', code_verifier, {
      httpOnly: true,
      secure: isProd,
      maxAge: 300000,
    });
    res.cookie('oidc_state', state, {
      httpOnly: true,
      secure: isProd,
      maxAge: 300000,
    });

    const authUrl = client.authorizationUrl({
      scope: 'openid email profile',
      state: state,
      code_challenge: generators.codeChallenge(code_verifier),
      code_challenge_method: 'S256',
    });

    res.redirect(authUrl);
  } catch (err) {
    console.error('[OIDC] Login redirect failed:', err);
    res.status(500).send(`OIDC Login redirect failed: ${err.message}`);
  }
});

/**
 * GET /api/auth/oidc/callback
 * Keycloak redirect target. Receives authorization code, exchanges it for tokens,
 * auto-registers the user, and redirects to SPA hash route.
 */
router.get('/oidc/callback', async (req, res) => {
  try {
    const client = await getOidcClient();
    
    // Retrieve cookies
    const stateCookie = req.cookies.oidc_state;
    const codeVerifierCookie = req.cookies.oidc_code_verifier;

    // Clear verification cookies immediately
    res.clearCookie('oidc_state');
    res.clearCookie('oidc_code_verifier');

    const params = client.callbackParams(req);

    // Validate state
    if (!stateCookie || params.state !== stateCookie) {
      return res.status(400).send('OIDC authentication failed: State parameter mismatch or verification session expired.');
    }

    if (!codeVerifierCookie) {
      return res.status(400).send('OIDC authentication failed: Missing code verifier.');
    }

    // Exchange auth code for token set
    const redirectUri = process.env.OIDC_REDIRECT_URI || 'http://localhost:3000/api/auth/oidc/callback';
    const tokenSet = await client.callback(redirectUri, params, {
      code_verifier: codeVerifierCookie,
      state: stateCookie,
    });

    const claims = tokenSet.claims();

    // Extract username (sub/preferred_username/email)
    const username = (claims.preferred_username || claims.email || claims.sub || '').trim();
    if (!username) {
      return res.status(400).send('OIDC authentication failed: No username claim found in ID token.');
    }

    // Extract display name
    const displayName = (claims.name || `${claims.given_name || ''} ${claims.family_name || ''}`.trim() || username).trim();

    const cleanUsername = username.toLowerCase();

    // Look up or auto-register user in SQLite
    let user = db.prepare('SELECT * FROM users WHERE username = ?').get(cleanUsername);

    if (!user) {
      const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
      const role = userCount === 0 ? 'admin' : 'user';
      const id = uuidv4();

      db.prepare('INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)').run(
        id, cleanUsername, displayName, role
      );

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    }

    // Generate app JWT
    const token = jwt.sign(
      { id: user.id, username: user.username, display_name: user.display_name, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    const userParam = encodeURIComponent(JSON.stringify({
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
    }));

    // Redirect browser back to frontend with hash-route parameters
    res.redirect(`/#sso-callback?token=${token}&user=${userParam}`);
  } catch (err) {
    console.error('[OIDC] Auth callback failed:', err);
    res.status(500).send(`OIDC Authentication callback failed: ${err.message}`);
  }
});

module.exports = router;
