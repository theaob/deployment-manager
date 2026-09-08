/**
 * Rancher app status — looks up the live state of the Rancher Helm/Catalog
 * app ("Apps & Marketplace") a deployment corresponds to, so it can be
 * shown alongside its reservation status.
 *
 * Mapping is opt-in and per-record, set from the Admin panel:
 *   - clusters.rancher_cluster_id   — the Rancher-internal cluster id
 *     (e.g. "c-m-abc12345", or "local"), found in the Rancher UI's URL
 *     when viewing that cluster.
 *   - deployments.rancher_namespace / rancher_app_name — the namespace and
 *     release name of the Helm app as Rancher shows it under
 *     Apps & Marketplace → Installed Apps.
 * A deployment missing any of these three simply has no Rancher status.
 *
 * Connection settings (rancher_enabled/rancher_url/rancher_api_token) are
 * DB-backed via lib/settings.js, same as the SMTP/Zulip notification
 * config — editable at runtime from the Admin panel, no redeploy needed.
 * Create the API token in Rancher under User Avatar → API & Keys.
 *
 * Talks to Rancher's v1 ("Steve") API:
 *   GET {rancher_url}/k8s/clusters/{rancherClusterId}/v1/catalog.cattle.io.apps/{namespace}/{appName}
 * whose `status.summary.state` is one of Rancher's standard Helm operation
 * states — "deployed", "failed", "unknown", or a transitional one like
 * "installing"/"upgrading" (summary.transitioning is true for those).
 *
 * TLS, for a Rancher instance on an internal/self-signed CA (the common
 * case on an intranet with no public internet access), is configured the
 * same way as this app's OIDC client (see middleware/oidc-auth.js):
 *   RANCHER_CA_CERT_PATH          — PEM CA cert/bundle to trust.
 *   RANCHER_TLS_REJECT_UNAUTHORIZED — "false" to skip verification entirely
 *                                      (internal/test environments only).
 */
const https = require('https');
const fs = require('fs');
const { getSettings } = require('./settings');

const CACHE_TTL_MS = 15000; // Keeps a burst of dashboard polls from every user from hammering Rancher.
const REQUEST_TIMEOUT_MS = 8000;

const statusCache = new Map(); // key -> { expires, value }
const inFlight = new Map(); // key -> Promise

let cachedAgent = null;
let cachedAgentKey = null;

/**
 * Returns true once Rancher integration is fully configured (enabled, with
 * a URL and API token on file).
 */
function isRancherEnabled() {
  const s = getSettings();
  return s.rancher_enabled === 'true' && !!s.rancher_url && !!s.rancher_api_token;
}

/**
 * Returns true if this cluster/deployment pair has everything needed to
 * look up a Rancher app status.
 */
function isDeploymentMapped(cluster, deployment) {
  return !!(cluster?.rancher_cluster_id && deployment?.rancher_namespace && deployment?.rancher_app_name);
}

function buildAgent() {
  const caCertPath = process.env.RANCHER_CA_CERT_PATH;
  const rejectUnauthorized = process.env.RANCHER_TLS_REJECT_UNAUTHORIZED !== 'false';
  const key = `${caCertPath || ''}|${rejectUnauthorized}`;

  if (cachedAgent && cachedAgentKey === key) {
    return cachedAgent;
  }

  const options = { keepAlive: true };
  if (caCertPath) {
    console.log(`[Rancher] Trusting CA certificate at: ${caCertPath}`);
    options.ca = fs.readFileSync(caCertPath);
  }
  if (!rejectUnauthorized) {
    console.warn('[Rancher] WARNING: RANCHER_TLS_REJECT_UNAUTHORIZED=false — TLS certificate verification is DISABLED for the Rancher API. Do not use this in production.');
    options.rejectUnauthorized = false;
  }

  cachedAgent = new https.Agent(options);
  cachedAgentKey = key;
  return cachedAgent;
}

/**
 * Issues an authenticated GET against the Rancher API and returns the
 * parsed JSON body. Rejects on a non-2xx response, a network error, or a
 * timeout.
 */
function rancherGet(pathname) {
  const settings = getSettings();
  const base = (settings.rancher_url || '').replace(/\/+$/, '');

  let url;
  try {
    url = new URL(base + pathname);
  } catch {
    return Promise.reject(new Error('Rancher URL is not configured or invalid'));
  }

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        agent: buildAgent(),
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${settings.rancher_api_token}`,
          Accept: 'application/json',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`Rancher API returned ${res.statusCode}${data ? `: ${data.slice(0, 300)}` : ''}`));
          }
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch (err) {
            reject(new Error(`Rancher API returned invalid JSON: ${err.message}`));
          }
        });
      }
    );

    req.on('timeout', () => req.destroy(new Error('Rancher API request timed out')));
    req.on('error', reject);
    req.end();
  });
}

/**
 * Fetches the live status of a single Rancher app. Not cached — callers
 * generally want getAppStatus() below instead.
 *
 * @returns {Promise<{state: string, error: boolean, transitioning: boolean, message: string}>}
 */
async function fetchAppStatus({ rancherClusterId, namespace, appName }) {
  const pathname = `/k8s/clusters/${encodeURIComponent(rancherClusterId)}/v1/catalog.cattle.io.apps/${encodeURIComponent(namespace)}/${encodeURIComponent(appName)}`;
  const body = await rancherGet(pathname);
  const summary = body?.status?.summary || {};

  return {
    state: summary.state || 'unknown',
    error: !!summary.error,
    transitioning: !!summary.transitioning,
    message: summary.message || '',
  };
}

/**
 * Cached, never-throws wrapper around fetchAppStatus() — a failed lookup
 * resolves to { ok: false, error } instead of rejecting, so callers (the
 * clusters endpoint, showing many of these at once) don't need per-app
 * try/catch. A successful lookup resolves to { ok: true, ...status }.
 *
 * Concurrent requests for the same app within the cache window are
 * deduplicated to a single in-flight Rancher API call.
 */
function getAppStatus({ rancherClusterId, namespace, appName }) {
  const key = `${rancherClusterId}/${namespace}/${appName}`;

  const cached = statusCache.get(key);
  if (cached && cached.expires > Date.now()) {
    return Promise.resolve(cached.value);
  }

  if (inFlight.has(key)) {
    return inFlight.get(key);
  }

  const promise = fetchAppStatus({ rancherClusterId, namespace, appName })
    .then((status) => ({ ok: true, ...status }))
    .catch((err) => ({ ok: false, error: err.message }))
    .then((value) => {
      statusCache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
      inFlight.delete(key);
      return value;
    });

  inFlight.set(key, promise);
  return promise;
}

/**
 * Given the cluster list assembled by GET /api/clusters (each cluster with
 * a .deployments array), attaches `.rancher_status` to every deployment
 * that's mapped to a Rancher app, fetching in parallel. A no-op if Rancher
 * integration isn't enabled/configured. Mutates its argument.
 */
async function attachRancherStatuses(clusters) {
  if (!isRancherEnabled()) {
    return;
  }

  const tasks = [];
  for (const cluster of clusters) {
    for (const deployment of cluster.deployments || []) {
      if (isDeploymentMapped(cluster, deployment)) {
        tasks.push(
          getAppStatus({
            rancherClusterId: cluster.rancher_cluster_id,
            namespace: deployment.rancher_namespace,
            appName: deployment.rancher_app_name,
          }).then((status) => {
            deployment.rancher_status = status;
          })
        );
      }
    }
  }

  await Promise.all(tasks);
}

/**
 * Verifies the configured Rancher URL/token actually work, independent of
 * any specific cluster/app mapping — used by the Admin panel's "Test
 * Connection" button. Hits the v3 server-version endpoint, which any valid
 * token can read regardless of cluster-level permissions.
 */
async function testConnection() {
  const settings = getSettings();
  if (!settings.rancher_url) {
    throw new Error('Set a Rancher URL first');
  }
  if (!settings.rancher_api_token) {
    throw new Error('Set a Rancher API token first');
  }

  const body = await rancherGet('/v3/settings/server-version');
  return { version: body?.value || body?.default || 'unknown' };
}

module.exports = {
  isRancherEnabled,
  isDeploymentMapped,
  attachRancherStatuses,
  testConnection,
};
