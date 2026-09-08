const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { adminOnly } = require('../middleware/auth');
const { getSettings, setSettings } = require('../lib/settings');
const { sendTestNotification } = require('../lib/notifications');
const { isOidcEnabled } = require('../middleware/oidc-auth');
const rancher = require('../lib/rancher');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
 * Body: { name?: string, environment?: string, rancher_cluster_id?: string | null }
 *   rancher_cluster_id — the Rancher-internal cluster id this cluster maps
 *   to (see lib/rancher.js), used to look up its deployments' app status.
 *   Pass an empty string/null to clear the mapping. Omit to leave it as-is.
 */
router.put('/clusters/:id', (req, res) => {
  const { id } = req.params;
  const { name, environment, rancher_cluster_id: rancherClusterIdRaw } = req.body;

  const cluster = db.prepare('SELECT * FROM clusters WHERE id = ?').get(id);
  if (!cluster) {
    return res.status(404).json({ error: 'Cluster not found' });
  }

  const rancherClusterId = rancherClusterIdRaw !== undefined
    ? (String(rancherClusterIdRaw).trim() || null)
    : cluster.rancher_cluster_id;

  db.prepare('UPDATE clusters SET name = ?, environment = ?, rancher_cluster_id = ? WHERE id = ?').run(
    name || cluster.name,
    environment || cluster.environment,
    rancherClusterId,
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
 * PUT /api/admin/deployments/:id/rancher
 * Maps (or clears) the Rancher Helm app this deployment corresponds to.
 * Body: { rancher_namespace?: string | null, rancher_app_name?: string | null }
 * Also requires the owning cluster to have a rancher_cluster_id set (see
 * PUT /clusters/:id) before a status lookup will actually happen.
 */
router.put('/deployments/:id/rancher', (req, res) => {
  const { id } = req.params;

  const deployment = db.prepare('SELECT * FROM deployments WHERE id = ?').get(id);
  if (!deployment) {
    return res.status(404).json({ error: 'Deployment not found' });
  }

  const namespace = typeof req.body.rancher_namespace === 'string' ? req.body.rancher_namespace.trim() : '';
  const appName = typeof req.body.rancher_app_name === 'string' ? req.body.rancher_app_name.trim() : '';

  db.prepare('UPDATE deployments SET rancher_namespace = ?, rancher_app_name = ? WHERE id = ?').run(
    namespace || null,
    appName || null,
    id
  );

  const updated = db.prepare('SELECT * FROM deployments WHERE id = ?').get(id);
  res.json({ deployment: updated });
});

/**
 * GET /api/admin/users
 * List all users.
 */
router.get('/users', (req, res) => {
  const users = db.prepare('SELECT id, username, display_name, email, role, created_at FROM users ORDER BY created_at').all();
  // Tells the Admin panel whether email is admin-editable (see PUT
  // /users/:id/email above — disabled once OIDC owns it).
  res.json({ users, emailManagedByOidc: isOidcEnabled() });
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
 * PUT /api/admin/users/:id/email
 * Set (or clear) a user's email address — used as the recipient for
 * release notifications (SMTP and Zulip both key off this same address).
 * Body: { email: string | null }
 *
 * Disabled while OIDC is configured: Keycloak is the source of truth for
 * email there (synced automatically on every login — see
 * routes/auth.js's oidc/callback), and it overwrites this column on the
 * user's next sign-in regardless of what's set here. Allowing a manual
 * edit that quietly reverts itself is worse than not offering one.
 */
router.put('/users/:id/email', (req, res) => {
  if (isOidcEnabled()) {
    return res.status(400).json({
      error: 'Email is managed by Keycloak (OIDC) and synced automatically on login — it cannot be set manually.',
    });
  }

  const { id } = req.params;
  const { email } = req.body;

  const cleanEmail = typeof email === 'string' ? email.trim() : '';

  if (cleanEmail && !EMAIL_RE.test(cleanEmail)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  db.prepare('UPDATE users SET email = ? WHERE id = ?').run(cleanEmail || null, id);
  res.json({ message: 'Email updated' });
});

/**
 * GET /api/admin/settings
 * Returns the current SMTP/Zulip notification settings. Secrets
 * (SMTP password, Zulip bot API key) are never echoed back — only whether
 * one is currently set, so the Admin panel can show "configured" without
 * exposing the value.
 */
router.get('/settings', (req, res) => {
  const raw = getSettings();

  res.json({
    settings: {
      smtp_enabled: raw.smtp_enabled === 'true',
      smtp_host: raw.smtp_host || '',
      smtp_port: raw.smtp_port || '',
      smtp_secure: raw.smtp_secure === 'true',
      smtp_user: raw.smtp_user || '',
      smtp_pass_set: !!raw.smtp_pass,
      smtp_from: raw.smtp_from || '',
      zulip_enabled: raw.zulip_enabled === 'true',
      zulip_site: raw.zulip_site || '',
      zulip_bot_email: raw.zulip_bot_email || '',
      zulip_bot_api_key_set: !!raw.zulip_bot_api_key,
      rancher_enabled: raw.rancher_enabled === 'true',
      rancher_url: raw.rancher_url || '',
      rancher_api_token_set: !!raw.rancher_api_token,
    },
  });
});

/**
 * PUT /api/admin/settings
 * Updates SMTP/Zulip notification settings. Secret fields
 * (smtp_pass, zulip_bot_api_key) are only overwritten when a non-empty
 * value is sent — leave them out (or send an empty string) to keep the
 * currently stored secret.
 */
router.put('/settings', (req, res) => {
  const body = req.body || {};
  const updates = {};

  const boolFields = ['smtp_enabled', 'smtp_secure', 'zulip_enabled', 'rancher_enabled'];
  const textFields = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_from', 'zulip_site', 'zulip_bot_email', 'rancher_url'];
  const secretFields = ['smtp_pass', 'zulip_bot_api_key', 'rancher_api_token'];

  for (const field of boolFields) {
    if (field in body) updates[field] = body[field] ? 'true' : 'false';
  }
  for (const field of textFields) {
    if (field in body) updates[field] = String(body[field] ?? '').trim();
  }
  for (const field of secretFields) {
    if (body[field]) updates[field] = String(body[field]);
  }

  setSettings(updates);
  res.json({ message: 'Settings updated' });
});

/**
 * POST /api/admin/settings/test
 * Sends a test message through whichever channels are enabled, to the
 * requesting admin's own email address (must have one on file), to verify
 * the notification settings actually work.
 */
router.post('/settings/test', async (req, res) => {
  const admin = db.prepare('SELECT email FROM users WHERE id = ?').get(req.user.id);

  if (!admin?.email) {
    return res.status(400).json({ error: 'Set an email address for your own user before sending a test notification.' });
  }

  const settings = getSettings();
  if (settings.smtp_enabled !== 'true' && settings.zulip_enabled !== 'true') {
    return res.status(400).json({ error: 'Enable and configure at least one notification channel first.' });
  }

  const results = await sendTestNotification(admin.email);
  res.json({ message: `Test notification attempted to ${admin.email}`, results });
});

/**
 * POST /api/admin/settings/test-rancher
 * Verifies the configured Rancher URL/API token actually work, independent
 * of any specific cluster/app mapping.
 */
router.post('/settings/test-rancher', async (req, res) => {
  try {
    const result = await rancher.testConnection();
    res.json({ message: `Connected to Rancher (server version: ${result.version})` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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
