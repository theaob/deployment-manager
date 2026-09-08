const express = require('express');
const cors = require('cors');
const path = require('path');
const { authMiddleware } = require('./middleware/auth');

const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust one hop of X-Forwarded-* headers so req.protocol/req.secure reflect
// the client-facing scheme when a reverse proxy (e.g. the bundled Nginx
// service) terminates TLS in front of this container.
//
// Only enable this if clients truly cannot reach this container directly —
// with no proxy in front, any client could spoof X-Forwarded-Proto/-For
// headers itself and Express would believe them.
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(cookieParser());

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware for API routes
app.use('/api', (req, res, next) => {
  if (
    req.path === '/auth/login' ||
    req.path === '/auth/mode' ||
    req.path === '/auth/oidc/login' ||
    req.path === '/auth/oidc/callback'
  ) {
    return next();
  }
  authMiddleware(req, res, next);
});

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/clusters', require('./routes/clusters'));
app.use('/api/deployments', require('./routes/deployments'));
app.use('/api/admin', require('./routes/admin'));

// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Deployment Manager running at http://localhost:${PORT}\n`);
});
