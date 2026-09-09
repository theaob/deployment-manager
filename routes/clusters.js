const express = require('express');
const db = require('../db/database');
const { sweepExpiredReservations } = require('../lib/notifications');

const router = express.Router();

/**
 * Strips a leftover rancher_api_token off a cluster row before it reaches
 * a client, in case one is still sitting in the database from the earlier
 * Rancher-API-status design (see db/database.js) — it's a credential, not
 * something to hand back over an unauthenticated-for-secrets endpoint just
 * because the column happens to still exist. rancher_url is a plain
 * shortcut link, not sensitive, and passes through as-is.
 */
function redactCluster(cluster) {
  if (!cluster) return cluster;
  const { rancher_api_token, ...rest } = cluster;
  return rest;
}

/**
 * GET /api/clusters
 * Returns all clusters with their deployments and current reservation status.
 */
router.get('/', (req, res) => {
  sweepExpiredReservations();

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
          expires_at: activeReservation.expires_at,
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

  res.json({ clusters: result.map(redactCluster) });
});

/**
 * GET /api/clusters/:clusterId
 * Returns a single cluster with its deployments.
 */
router.get('/:clusterId', (req, res) => {
  sweepExpiredReservations();

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
        expires_at: activeReservation.expires_at,
        notes: activeReservation.notes,
      } : null,
    };
  });

  const result = {
    ...cluster,
    deployments: deploymentsWithStatus,
    total: deployments.length,
    available: deploymentsWithStatus.filter(d => d.status === 'available').length,
    reserved: deploymentsWithStatus.filter(d => d.status === 'reserved').length,
  };

  res.json(redactCluster(result));
});

module.exports = router;
