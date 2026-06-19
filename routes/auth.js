const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/auth/login
 * Logs in (or registers) a user by username.
 * Body: { username: string }
 */
router.post('/login', (req, res) => {
  const { username } = req.body;

  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    return res.status(400).json({ error: 'Username is required' });
  }

  const cleanUsername = username.trim().toLowerCase();
  const displayName = username.trim();

  // Check if user exists
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

  // Generate JWT token
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
