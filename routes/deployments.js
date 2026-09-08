const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { sweepExpiredReservations, notifyReservationReleased } = require('../lib/notifications');

const router = express.Router();

// Sane upper bound on how long a single reservation can run for.
const MAX_DURATION_MINUTES = 30 * 24 * 60; // 30 days

/**
 * POST /api/deployments/:id/reserve
 * Reserve a deployment for the current user.
 * Body: { notes?: string, duration_minutes?: number }
 *   duration_minutes — how long the reservation should last before it's
 *   automatically released. Omit or pass null for no time limit.
 */
router.post('/:id/reserve', (req, res) => {
  const { id } = req.params;
  const { notes, duration_minutes: durationMinutesRaw } = req.body;
  const userId = req.user.id;

  sweepExpiredReservations();

  // Validate duration_minutes, if provided
  let expiresAt = null;
  if (durationMinutesRaw !== undefined && durationMinutesRaw !== null && durationMinutesRaw !== '') {
    const durationMinutes = Number(durationMinutesRaw);
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      return res.status(400).json({ error: 'duration_minutes must be a positive whole number' });
    }
    if (durationMinutes > MAX_DURATION_MINUTES) {
      return res.status(400).json({ error: `duration_minutes cannot exceed ${MAX_DURATION_MINUTES} (30 days)` });
    }
    expiresAt = db.prepare("SELECT datetime('now', ? || ' minutes') as t").get(`+${durationMinutes}`).t;
  }

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
    'INSERT INTO reservations (id, deployment_id, cluster_id, user_id, notes, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(reservationId, id, deployment.cluster_id, userId, notes || null, expiresAt);

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
      expires_at: reservation.expires_at,
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

  // Notify the reservation's owner — but only when someone *other* than
  // them released it (an admin force-release). A self-release doesn't
  // need a notification; the user already knows, they just did it.
  if (reservation.user_id !== userId) {
    const owner = db.prepare('SELECT display_name, email FROM users WHERE id = ?').get(reservation.user_id);
    const deployment = db.prepare('SELECT name FROM deployments WHERE id = ?').get(id);
    const cluster = db.prepare('SELECT name FROM clusters WHERE id = ?').get(reservation.cluster_id);
    const releasedBy = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId);

    notifyReservationReleased({
      owner,
      deploymentName: deployment?.name,
      clusterName: cluster?.name,
      reason: 'admin',
      releasedByLabel: releasedBy?.display_name,
    }).catch((err) => console.error('[notify] Release notification failed:', err.message));
  }

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

  sweepExpiredReservations();

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
