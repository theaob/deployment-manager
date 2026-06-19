const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

const router = express.Router();

/**
 * POST /api/deployments/:id/reserve
 * Reserve a deployment for the current user.
 * Body: { notes?: string }
 */
router.post('/:id/reserve', (req, res) => {
  const { id } = req.params;
  const { notes } = req.body;
  const userId = req.user.id;

  // Check deployment exists
  const deployment = db.prepare('SELECT * FROM deployments WHERE id = ?').get(id);
  if (!deployment) {
    return res.status(404).json({ error: 'Deployment not found' });
  }

  // Check if already reserved
  const existing = db.prepare(
    'SELECT * FROM reservations WHERE deployment_id = ? AND released_at IS NULL'
  ).get(id);

  if (existing) {
    const reservedBy = db.prepare('SELECT username FROM users WHERE id = ?').get(existing.user_id);
    return res.status(409).json({
      error: `Deployment is already reserved by ${reservedBy?.username || 'unknown'}`,
    });
  }

  // Create reservation
  const reservationId = uuidv4();
  db.prepare(
    'INSERT INTO reservations (id, deployment_id, cluster_id, user_id, notes) VALUES (?, ?, ?, ?, ?)'
  ).run(reservationId, id, deployment.cluster_id, userId, notes || null);

  const reservation = db.prepare(`
    SELECT r.*, u.username, u.display_name 
    FROM reservations r 
    JOIN users u ON r.user_id = u.id 
    WHERE r.id = ?
  `).get(reservationId);

  res.json({
    message: 'Deployment reserved successfully',
    reservation: {
      id: reservation.id,
      deployment_id: reservation.deployment_id,
      cluster_id: reservation.cluster_id,
      user_id: reservation.user_id,
      username: reservation.username,
      display_name: reservation.display_name,
      reserved_at: reservation.reserved_at,
      notes: reservation.notes,
    },
  });
});

/**
 * POST /api/deployments/:id/release
 * Release a deployment reservation.
 */
router.post('/:id/release', (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  // Find active reservation
  const reservation = db.prepare(
    'SELECT * FROM reservations WHERE deployment_id = ? AND released_at IS NULL'
  ).get(id);

  if (!reservation) {
    return res.status(404).json({ error: 'No active reservation found for this deployment' });
  }

  // Only the user who reserved it (or an admin) can release
  if (reservation.user_id !== userId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only the user who reserved or an admin can release this deployment' });
  }

  // Release
  db.prepare(
    "UPDATE reservations SET released_at = datetime('now') WHERE id = ?"
  ).run(reservation.id);

  const updated = db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservation.id);

  res.json({
    message: 'Deployment released successfully',
    reservation: updated,
  });
});

/**
 * GET /api/deployments/:id/history
 * Get reservation history for a deployment.
 */
router.get('/:id/history', (req, res) => {
  const { id } = req.params;
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;

  const history = db.prepare(`
    SELECT r.*, u.username, u.display_name 
    FROM reservations r 
    JOIN users u ON r.user_id = u.id 
    WHERE r.deployment_id = ? 
    ORDER BY r.reserved_at DESC 
    LIMIT ? OFFSET ?
  `).all(id, limit, offset);

  const total = db.prepare('SELECT COUNT(*) as count FROM reservations WHERE deployment_id = ?').get(id).count;

  res.json({ history, total, limit, offset });
});

/**
 * GET /api/deployments/my-reservations
 * Get all active reservations for the current user.
 */
router.get('/my-reservations/active', (req, res) => {
  const userId = req.user.id;

  const reservations = db.prepare(`
    SELECT r.*, d.name as deployment_name, c.name as cluster_name, c.environment,
           u.username, u.display_name
    FROM reservations r
    JOIN deployments d ON r.deployment_id = d.id
    JOIN clusters c ON r.cluster_id = c.id
    JOIN users u ON r.user_id = u.id
    WHERE r.user_id = ? AND r.released_at IS NULL
    ORDER BY r.reserved_at DESC
  `).all(userId);

  res.json({ reservations });
});

module.exports = router;
