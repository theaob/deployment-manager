const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { JWT_SECRET } = require('../middleware/auth');
const { isAdEnabled, authenticateWithLDAP } = require('../middleware/ldap-auth');

const router = express.Router();

/**
 * GET /api/auth/mode
 * Returns the current authentication mode so the frontend knows
 * whether to show a password field or auto-login.
 */
router.get('/mode', (req, res) => {
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

module.exports = router;
