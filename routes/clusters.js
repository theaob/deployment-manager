const express = require('express');
const db = require('../db/database');

const router = express.Router();

/**
 * GET /api/clusters
 * Returns all clusters with their deployments and current reservation status.
 */
router.get('/', (req, res) => {
  const clusters = db.prepare('SELECT * FROM clusters ORDER BY name').all();

  const result = clusters.map(cluster => {
    const deployments = db.prepare('SELECT * FROM deployments WHERE cluster_id = ? ORDER BY name').all(cluster.id);

    const deploymentsWithStatus = deployments.map(dep => {
      // Get active reservation (not released)
      const activeReservation = db.prepare(`
        SELECT r.*, u.username, u.display_name 
        FROM reservations r 
        JOIN users u ON r.user_id = u.id 
        WHERE r.deployment_id = ? AND r.released_at IS NULL
      `).get(dep.id);

      return {
        ...dep,
        status: activeReservation ? 'reserved' : 'available',
        reservation: activeReservation ? {
          id: activeReservation.id,
          user_id: activeReservation.user_id,
          username: activeReservation.username,
          display_name: activeReservation.display_name,
          reserved_at: activeReservation.reserved_at,
          notes: activeReservation.notes,
        } : null,
      };
    });

    return {
      ...cluster,
      deployments: deploymentsWithStatus,
      total: deployments.length,
      available: deploymentsWithStatus.filter(d => d.status === 'available').length,
      reserved: deploymentsWithStatus.filter(d => d.status === 'reserved').length,
    };
  });

  res.json({ clusters: result });
});

/**
 * GET /api/clusters/:clusterId
 * Returns a single cluster with its deployments.
 */
router.get('/:clusterId', (req, res) => {
  const cluster = db.prepare('SELECT * FROM clusters WHERE id = ?').get(req.params.clusterId);
  if (!cluster) {
    return res.status(404).json({ error: 'Cluster not found' });
  }

  const deployments = db.prepare('SELECT * FROM deployments WHERE cluster_id = ? ORDER BY name').all(cluster.id);
  const deploymentsWithStatus = deployments.map(dep => {
    const activeReservation = db.prepare(`
      SELECT r.*, u.username, u.display_name 
      FROM reservations r 
      JOIN users u ON r.user_id = u.id 
      WHERE r.deployment_id = ? AND r.released_at IS NULL
    `).get(dep.id);

    return {
      ...dep,
      status: activeReservation ? 'reserved' : 'available',
      reservation: activeReservation ? {
        id: activeReservation.id,
        user_id: activeReservation.user_id,
        username: activeReservation.username,
        display_name: activeReservation.display_name,
        reserved_at: activeReservation.reserved_at,
        notes: activeReservation.notes,
      } : null,
    };
  });

  res.json({
    ...cluster,
    deployments: deploymentsWithStatus,
    total: deployments.length,
    available: deploymentsWithStatus.filter(d => d.status === 'available').length,
    reserved: deploymentsWithStatus.filter(d => d.status === 'reserved').length,
  });
});

module.exports = router;
