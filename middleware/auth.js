const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'deployment-manager-secret-key-change-in-production';

/**
 * Auth middleware — verifies JWT token from Authorization header.
 * Skips auth for the login endpoint.
 */
function authMiddleware(req, res, next) {
  // Skip auth for login route
  if (req.path === '/api/auth/login') {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Admin-only middleware — must be used after authMiddleware.
 */
function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { authMiddleware, adminOnly, JWT_SECRET };
