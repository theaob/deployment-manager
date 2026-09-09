/**
 * Rancher app status — looks up the live state of the Rancher Helm/Catalog
 * app ("Apps & Marketplace") a deployment corresponds to, so it can be
 * shown alongside its reservation status.
 *
 * Each cluster has its own standalone Rancher (not one Rancher managing
 * many downstream clusters), so the connection — URL + API token — is
 * configured per cluster, from the Admin panel:
 *   - clusters.rancher_url / rancher_api_token — that cluster's own
 *     Rancher server and an API token for it (create one under User
 *     Avatar → Account & API Keys → Create API Key).
 *   - deployments.rancher_app_name — the release name of the Helm app as
 *     Rancher shows it under Apps & Marketplace → Installed Apps. Its
 *     namespace isn't stored separately — it's the deployment's own name.
 * A deployment whose cluster has no Rancher URL/token, or that has no
 * rancher_app_name itself, simply has no Rancher status. Opt-in, per
 * cluster and per deployment — no separate on/off setting.
 *
 * Talks to Rancher's v1 ("Steve") API directly (no `/k8s/clusters/<id>/`
 * proxy prefix — that's only for a Rancher server managing *other*
 * clusters; a cluster's own dedicated Rancher exposes its resources at
 * the top level):
 *   GET {rancher_url}/v1/catalog.cattle.io.apps/{namespace}/{appName}
 * whose `status.summary.state` is one of Rancher's standard Helm operation
 * states — "deployed", "failed", "unknown", or a transitional one like
 * "installing"/"upgrading" (summary.transitioning is true for those).
 *
 * TLS trust is shared across every cluster's Rancher (same org, generally
 * the same internal CA), configured the same way as this app's OIDC client
 * (see middleware/oidc-auth.js):
 *   RANCHER_CA_CERT_PATH          — PEM CA cert/bundle to trust.
 *   RANCHER_TLS_REJECT_UNAUTHORIZED — "false" to skip verification entirely
 *                                      for Rancher specifically (or set the
 *                                      global TLS_REJECT_UNAUTHORIZED to do
 *                                      this for Rancher, OIDC, Zulip, and
 *                                      SMTP all at once — see lib/tls.js).
 *                                      Internal/test environments only.
 */
const https = require('https');
const fs = require('fs');
const { shouldRejectUnauthorized } = require('./tls');

const CACHE_TTL_MS = 15000; // Keeps a burst of dashboard polls from every user from hammering Rancher.
const REQUEST_TIMEOUT_MS = 8000;

const statusCache = new Map(); // key -> { expires, value }
const inFlight = new Map(); // key -> Promise

let cachedAgent = null;
let cachedAgentKey = null;

/**
 * Returns true if this cluster has a Rancher connection configured.
 */
function isClusterRancherConfigured(cluster) {
  return !!(cluster?.rancher_url && cluster?.rancher_api_token);
}

/**
 * Returns true if this cluster/deployment pair has everything needed to
 * look up a Rancher app status: the owning cluster's Rancher connection,
 * plus this deployment's own app name (its namespace is just its name).
 */
function isDeploymentMapped(cluster, deployment) {
  return isClusterRancherConfigured(cluster) && !!deployment?.rancher_app_name;
}

/**
 * Strips the raw Rancher API token off a cluster row before it goes to a
 * client, replacing it with a `rancher_api_token_set` boolean — the same
 * masking convention as the SMTP/Zulip secrets in lib/settings.js. Every
 * route that sends a cluster object (GET /api/clusters and its :id variant,
 * and the admin create/update responses) must pass it through this first;
 * the raw token is a bearer credential for that cluster's Rancher.
 */
function redactCluster(cluster) {
  if (!cluster) return cluster;
  const { rancher_api_token, ...rest } = cluster;
  return { ...rest, rancher_api_token_set: !!rancher_api_token };
}

function buildAgent() {
  const caCertPath = process.env.RANCHER_CA_CERT_PATH;
  const rejectUnauthorized = shouldRejectUnauthorized('RANCHER_TLS_REJECT_UNAUTHORIZED');
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
    console.warn('[Rancher] WARNING: TLS certificate verification is DISABLED for the Rancher API (TLS_REJECT_UNAUTHORIZED or RANCHER_TLS_REJECT_UNAUTHORIZED=false). Do not use this in production.');
    options.rejectUnauthorized = false;
  }

  cachedAgent = new https.Agent(options);
  cachedAgentKey = key;
  return cachedAgent;
}

/**
 * Issues an authenticated GET against a specific cluster's Rancher API and
 * returns the parsed JSON body. Rejects on a non-2xx response, a network
 * error, or a timeout.
 */
function rancherGet(rancherUrl, rancherApiToken, pathname) {
  const base = (rancherUrl || '').replace(/\/+$/, '');

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
          Authorization: `Bearer ${rancherApiToken}`,
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
 * Also surfaces the deployed chart's version info, from the App resource's
 * `spec.chart.metadata` (the same Helm chart metadata `helm show chart`
 * would print) — appVersion is the underlying application's own version
 * (e.g. "2.4.1"), chartVersion is the packaging/chart's version, which can
 * differ from and is a fallback for appVersion when a chart doesn't set one.
 *
 * @returns {Promise<{state: string, error: boolean, transitioning: boolean, message: string, appVersion: string|null, chartVersion: string|null}>}
 */
async function fetchAppStatus({ rancherUrl, rancherApiToken, namespace, appName }) {
  const pathname = `/v1/catalog.cattle.io.apps/${encodeURIComponent(namespace)}/${encodeURIComponent(appName)}`;
  const body = await rancherGet(rancherUrl, rancherApiToken, pathname);
  const summary = body?.status?.summary || {};
  const chartMeta = body?.spec?.chart?.metadata || {};

  return {
    state: summary.state || 'unknown',
    error: !!summary.error,
    transitioning: !!summary.transitioning,
    message: summary.message || '',
    appVersion: chartMeta.appVersion || null,
    chartVersion: chartMeta.version || null,
  };
}

/**
 * Cached, never-throws wrapper around fetchAppStatus() — a failed lookup
 * resolves to { ok: false, error } instead of rejecting, so callers (the
 * clusters endpoint, showing many of these at once) don't need per-app
 * try/catch. A successful lookup resolves to { ok: true, ...status }.
 *
 * Concurrent requests for the same app within the cache window are
 * deduplicated to a single in-flight Rancher API call. Keyed by URL (not
 * just namespace/app) since different clusters have entirely separate
 * Rancher servers and could coincidentally share a namespace/app name.
 */
function getAppStatus({ rancherUrl, rancherApiToken, namespace, appName }) {
  const key = `${rancherUrl}/${namespace}/${appName}`;

  const cached = statusCache.get(key);
  if (cached && cached.expires > Date.now()) {
    return Promise.resolve(cached.value);
  }

  if (inFlight.has(key)) {
    return inFlight.get(key);
  }

  const promise = fetchAppStatus({ rancherUrl, rancherApiToken, namespace, appName })
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
 * that's mapped to a Rancher app, fetching in parallel — one cluster's
 * Rancher being unconfigured or unreachable doesn't affect any other's.
 * Mutates its argument.
 */
async function attachRancherStatuses(clusters) {
  const tasks = [];

  for (const cluster of clusters) {
    if (!isClusterRancherConfigured(cluster)) continue;

    for (const deployment of cluster.deployments || []) {
      if (isDeploymentMapped(cluster, deployment)) {
        tasks.push(
          getAppStatus({
            rancherUrl: cluster.rancher_url,
            rancherApiToken: cluster.rancher_api_token,
            namespace: deployment.name,
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
 * Verifies a cluster's configured Rancher URL/token actually work,
 * independent of any specific app mapping — used by the Admin panel's
 * per-cluster "Test Connection" button. Hits the v3 server-version
 * endpoint, which any valid token can read.
 */
async function testConnection({ rancherUrl, rancherApiToken }) {
  if (!rancherUrl) {
    throw new Error('Set a Rancher URL first');
  }
  if (!rancherApiToken) {
    throw new Error('Set a Rancher API token first');
  }

  const body = await rancherGet(rancherUrl, rancherApiToken, '/v3/settings/server-version');
  return { version: body?.value || body?.default || 'unknown' };
}

module.exports = {
  isClusterRancherConfigured,
  isDeploymentMapped,
  redactCluster,
  attachRancherStatuses,
  testConnection,
};
