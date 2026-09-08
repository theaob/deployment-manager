/**
 * Key/value app settings backed by the `settings` table — currently used
 * for the SMTP and Zulip notification configuration entered in the Admin
 * panel. Unlike the auth-provider configuration (which is env-var only),
 * these are meant to be editable at runtime without a redeploy.
 */
const db = require('../db/database');

const upsertStmt = db.prepare(`
  INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

/**
 * Returns all settings as a flat { key: value } object. Missing keys are
 * simply absent (callers should treat that as "unset"/falsy).
 */
function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const result = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

/**
 * Merges the given { key: value } pairs into the settings table. Only the
 * provided keys are touched — everything else is left as-is.
 */
function setSettings(updates) {
  const entries = Object.entries(updates);
  const transaction = db.transaction((rows) => {
    for (const [key, value] of rows) {
      upsertStmt.run(key, value);
    }
  });
  transaction(entries);
}

module.exports = { getSettings, setSettings };
