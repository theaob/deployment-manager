const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'deployment-manager.db');

// Ensure the data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables. Deliberately no indexes here yet — some reference columns
// added by the migration step below, and CREATE INDEX (unlike CREATE TABLE)
// has no "IF NOT EXISTS"-style tolerance for a column that doesn't exist
// yet on a pre-existing table. Creating them before that migration runs
// would throw "no such column" and crash startup on any database from
// before that column existed.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    email TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS clusters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    environment TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS deployments (
    id TEXT PRIMARY KEY,
    cluster_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reservations (
    id TEXT PRIMARY KEY,
    deployment_id TEXT NOT NULL,
    cluster_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    reserved_at TEXT NOT NULL DEFAULT (datetime('now')),
    released_at TEXT,
    expires_at TEXT,
    notes TEXT,
    FOREIGN KEY (deployment_id) REFERENCES deployments(id) ON DELETE CASCADE,
    FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Migrate pre-existing databases that predate the expires_at/email columns
// (CREATE TABLE IF NOT EXISTS doesn't retroactively add columns to a table
// that already exists). Must run before any index touching these columns.
const reservationColumns = db.prepare("PRAGMA table_info(reservations)").all().map((c) => c.name);
if (!reservationColumns.includes('expires_at')) {
  db.exec('ALTER TABLE reservations ADD COLUMN expires_at TEXT');
}
const userColumns = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (!userColumns.includes('email')) {
  db.exec('ALTER TABLE users ADD COLUMN email TEXT');
}

// Indexes — safe now that every column they reference is guaranteed to
// exist, whether this is a fresh database or one just migrated above.
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_reservations_deployment ON reservations(deployment_id);
  CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations(user_id);
  CREATE INDEX IF NOT EXISTS idx_reservations_active ON reservations(deployment_id, released_at);
  CREATE INDEX IF NOT EXISTS idx_reservations_expiry ON reservations(released_at, expires_at);
`);

/**
 * Auto-releases any active reservation whose duration has elapsed.
 * Called on startup, on a periodic interval, and defensively before
 * reads/writes that depend on "is this deployment currently reserved".
 * Reservations with no expires_at (no time limit) are never touched.
 *
 * Returns the full rows that were just released (joined with the owning
 * user, deployment, and cluster) so callers can act on them — e.g. to
 * send a release notification — without a second round-trip.
 *
 * @returns {Array<object>} The reservations released by this call.
 */
function releaseExpiredReservations() {
  const expired = db.prepare(`
    SELECT r.*, u.username AS owner_username, u.display_name AS owner_display_name, u.email AS owner_email,
           d.name AS deployment_name, c.name AS cluster_name
    FROM reservations r
    JOIN users u ON r.user_id = u.id
    JOIN deployments d ON r.deployment_id = d.id
    JOIN clusters c ON r.cluster_id = c.id
    WHERE r.released_at IS NULL
      AND r.expires_at IS NOT NULL
      AND r.expires_at <= datetime('now')
  `).all();

  if (expired.length > 0) {
    const releaseStmt = db.prepare("UPDATE reservations SET released_at = datetime('now') WHERE id = ?");
    const releaseTransaction = db.transaction((rows) => {
      for (const row of rows) releaseStmt.run(row.id);
    });
    releaseTransaction(expired);
  }

  return expired;
}

db.releaseExpiredReservations = releaseExpiredReservations;

/**
 * Seeds the database with clusters from config/clusters.json
 * Only inserts clusters/deployments that don't already exist.
 */
function seedFromConfig() {
  const configPath = path.join(__dirname, '..', 'config', 'clusters.json');
  if (!fs.existsSync(configPath)) {
    console.warn('No clusters.json config found, skipping seed.');
    return;
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  
  const insertCluster = db.prepare(
    'INSERT OR IGNORE INTO clusters (id, name, environment) VALUES (?, ?, ?)'
  );
  const insertDeployment = db.prepare(
    'INSERT OR IGNORE INTO deployments (id, cluster_id, name) VALUES (?, ?, ?)'
  );

  const seedTransaction = db.transaction(() => {
    for (const cluster of config.clusters) {
      insertCluster.run(cluster.id, cluster.name, cluster.environment);
      for (const deployment of cluster.deployments) {
        insertDeployment.run(deployment.id, cluster.id, deployment.name);
      }
    }
  });

  seedTransaction();
  console.log(`Seeded ${config.clusters.length} clusters from config.`);
}

// Run seed on initialization
seedFromConfig();

// Note: the startup catch-up sweep for expired reservations lives in
// server.js (via lib/notifications' sweepExpiredReservations), not here —
// notifications need to read from this module, so triggering the sweep
// from here would create a circular require.

module.exports = db;
