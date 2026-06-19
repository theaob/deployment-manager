const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { adminOnly } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// All admin routes require admin role
router.use(adminOnly);

/**
 * POST /api/admin/clusters
 * Create a new cluster.
 * Body: { name: string, environment: string }
 */
router.post('/clusters', (req, res) => {
  const { name, environment } = req.body;

  if (!name || !environment) {
    return res.status(400).json({ error: 'Name and environment are required' });
  }

  const id = 'cluster-' + uuidv4().slice(0, 8);

  db.prepare('INSERT INTO clusters (id, name, environment) VALUES (?, ?, ?)').run(id, name, environment);

  const cluster = db.prepare('SELECT * FROM clusters WHERE id = ?').get(id);
  res.status(201).json({ cluster });
});

/**
 * PUT /api/admin/clusters/:id
 * Update a cluster.
 * Body: { name?: string, environment?: string }
 */
router.put('/clusters/:id', (req, res) => {
  const { id } = req.params;
  const { name, environment } = req.body;

  const cluster = db.prepare('SELECT * FROM clusters WHERE id = ?').get(id);
  if (!cluster) {
    return res.status(404).json({ error: 'Cluster not found' });
  }

  db.prepare('UPDATE clusters SET name = ?, environment = ? WHERE id = ?').run(
    name || cluster.name,
    environment || cluster.environment,
    id
  );

  const updated = db.prepare('SELECT * FROM clusters WHERE id = ?').get(id);
  res.json({ cluster: updated });
});

/**
 * DELETE /api/admin/clusters/:id
 * Delete a cluster and all its deployments.
 */
router.delete('/clusters/:id', (req, res) => {
  const { id } = req.params;

  const cluster = db.prepare('SELECT * FROM clusters WHERE id = ?').get(id);
  if (!cluster) {
    return res.status(404).json({ error: 'Cluster not found' });
  }

  // Check for active reservations
  const activeReservations = db.prepare(`
    SELECT COUNT(*) as count FROM reservations r
    JOIN deployments d ON r.deployment_id = d.id
    WHERE d.cluster_id = ? AND r.released_at IS NULL
  `).get(id).count;

  if (activeReservations > 0) {
    return res.status(409).json({
      error: `Cannot delete cluster with ${activeReservations} active reservation(s). Release all deployments first.`,
    });
  }

  db.prepare('DELETE FROM clusters WHERE id = ?').run(id);
  res.json({ message: 'Cluster deleted successfully' });
});

/**
 * POST /api/admin/clusters/:id/deployments
 * Add a deployment to a cluster.
 * Body: { name: string }
 */
router.post('/clusters/:id/deployments', (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Deployment name is required' });
  }

  const cluster = db.prepare('SELECT * FROM clusters WHERE id = ?').get(id);
  if (!cluster) {
    return res.status(404).json({ error: 'Cluster not found' });
  }

  const deploymentId = id.replace('cluster-', '') + '-deploy-' + uuidv4().slice(0, 8);

  db.prepare('INSERT INTO deployments (id, cluster_id, name) VALUES (?, ?, ?)').run(deploymentId, id, name);

  const deployment = db.prepare('SELECT * FROM deployments WHERE id = ?').get(deploymentId);
  res.status(201).json({ deployment });
});

/**
 * DELETE /api/admin/deployments/:id
 * Remove a deployment.
 */
router.delete('/deployments/:id', (req, res) => {
  const { id } = req.params;

  const deployment = db.prepare('SELECT * FROM deployments WHERE id = ?').get(id);
  if (!deployment) {
    return res.status(404).json({ error: 'Deployment not found' });
  }

  // Check for active reservation
  const activeReservation = db.prepare(
    'SELECT COUNT(*) as count FROM reservations WHERE deployment_id = ? AND released_at IS NULL'
  ).get(id).count;

  if (activeReservation > 0) {
    return res.status(409).json({ error: 'Cannot delete a deployment with an active reservation. Release it first.' });
  }

  db.prepare('DELETE FROM deployments WHERE id = ?').run(id);
  res.json({ message: 'Deployment deleted successfully' });
});

/**
 * GET /api/admin/users
 * List all users.
 */
router.get('/users', (req, res) => {
  const users = db.prepare('SELECT id, username, display_name, role, created_at FROM users ORDER BY created_at').all();
  res.json({ users });
});

/**
 * PUT /api/admin/users/:id/role
 * Update a user's role.
 * Body: { role: 'admin' | 'user' }
 */
router.put('/users/:id/role', (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  if (!['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'Role must be "admin" or "user"' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  res.json({ message: `User role updated to ${role}` });
});

/**
 * GET /api/admin/history
 * Get full reservation history across all deployments.
 */
router.get('/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const offset = parseInt(req.query.offset) || 0;
  const clusterId = req.query.cluster_id;
  const userId = req.query.user_id;

  let query = `
    SELECT r.*, d.name as deployment_name, c.name as cluster_name, c.environment,
           u.username, u.display_name
    FROM reservations r
    JOIN deployments d ON r.deployment_id = d.id
    JOIN clusters c ON r.cluster_id = c.id
    JOIN users u ON r.user_id = u.id
  `;

  const conditions = [];
  const params = [];

  if (clusterId) {
    conditions.push('r.cluster_id = ?');
    params.push(clusterId);
  }
  if (userId) {
    conditions.push('r.user_id = ?');
    params.push(userId);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY r.reserved_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const history = db.prepare(query).all(...params);

  // Get total count
  let countQuery = 'SELECT COUNT(*) as count FROM reservations r';
  if (conditions.length > 0) {
    countQuery += ' WHERE ' + conditions.join(' AND ');
  }
  const total = db.prepare(countQuery).get(...params.slice(0, -2)).count;

  res.json({ history, total, limit, offset });
});

module.exports = router;
