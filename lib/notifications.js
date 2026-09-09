/**
 * Release notifications — email (SMTP) and Zulip private message, sent to
 * a reservation's owner when *someone else* releases it for them: an admin
 * force-release, or an automatic release once a timed reservation expires.
 * A user releasing their own reservation never triggers a notification —
 * they already know, since they just did it.
 *
 * Both channels are optional and independently enabled/configured via the
 * Admin panel (see lib/settings.js) rather than environment variables,
 * since these are meant to be editable at runtime. A missing/incomplete
 * configuration, a user with no email on file, or a delivery failure are
 * all non-fatal: they're logged and otherwise swallowed so a notification
 * problem never blocks or fails the release itself.
 *
 * Zulip TLS, for a Zulip server on an internal/self-signed CA (the common
 * case on an intranet with no public internet access), is configured the
 * same way as this app's OIDC and Rancher clients:
 *   ZULIP_CA_CERT_PATH          — PEM CA cert/bundle to trust.
 *   ZULIP_TLS_REJECT_UNAUTHORIZED — "false" to skip verification entirely
 *                                    (internal/test environments only).
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const nodemailer = require('nodemailer');
const db = require('../db/database');
const { getSettings } = require('./settings');

/**
 * Builds the notification's subject/body for a single released reservation.
 * `reason` is 'admin' (someone force-released it) or 'expired' (its
 * duration ran out and it was auto-released).
 */
function buildMessage({ deploymentName, clusterName, reason, releasedByLabel }) {
  const subject = `Reservation released: ${deploymentName}`;
  const body = reason === 'expired'
    ? `Your reservation for "${deploymentName}" (${clusterName}) expired and was automatically released.`
    : `Your reservation for "${deploymentName}" (${clusterName}) was released${releasedByLabel ? ` by ${releasedByLabel}` : ''}.`;
  return { subject, body };
}

async function sendEmail(settings, toEmail, subject, body) {
  const transporter = nodemailer.createTransport({
    host: settings.smtp_host,
    port: Number(settings.smtp_port) || 587,
    secure: settings.smtp_secure === 'true',
    auth: settings.smtp_user
      ? { user: settings.smtp_user, pass: settings.smtp_pass }
      : undefined,
  });

  await transporter.sendMail({
    from: settings.smtp_from || settings.smtp_user,
    to: toEmail,
    subject,
    text: body,
  });
}

let cachedZulipAgent = null;
let cachedZulipAgentKey = null;

function buildZulipAgent() {
  const caCertPath = process.env.ZULIP_CA_CERT_PATH;
  const rejectUnauthorized = process.env.ZULIP_TLS_REJECT_UNAUTHORIZED !== 'false';
  const key = `${caCertPath || ''}|${rejectUnauthorized}`;

  if (cachedZulipAgent && cachedZulipAgentKey === key) {
    return cachedZulipAgent;
  }

  const options = { keepAlive: true };
  if (caCertPath) {
    console.log(`[Zulip] Trusting CA certificate at: ${caCertPath}`);
    options.ca = fs.readFileSync(caCertPath);
  }
  if (!rejectUnauthorized) {
    console.warn('[Zulip] WARNING: ZULIP_TLS_REJECT_UNAUTHORIZED=false — TLS certificate verification is DISABLED for the Zulip API. Do not use this in production.');
    options.rejectUnauthorized = false;
  }

  cachedZulipAgent = new https.Agent(options);
  cachedZulipAgentKey = key;
  return cachedZulipAgent;
}

/**
 * Sends a Zulip private message (DM) via the REST API.
 *
 * Uses Node's own http(s).request rather than fetch()/undici deliberately:
 * fetch's TLS failures all collapse into an opaque "fetch failed" with the
 * actual cause (a self-signed cert, DNS, connection refused, ...) buried in
 * a non-enumerable `cause` most callers never see or log — exactly the
 * unhelpful error this replaced. http(s).request surfaces that detail
 * directly on the error, and (via buildZulipAgent) can trust an internal CA
 * the same way the OIDC and Rancher clients already do.
 */
function sendZulipDM(settings, toEmail, body) {
  const site = (settings.zulip_site || '').replace(/\/+$/, '');
  const auth = Buffer.from(`${settings.zulip_bot_email}:${settings.zulip_bot_api_key}`).toString('base64');
  const form = new URLSearchParams({
    type: 'private',
    to: JSON.stringify([toEmail]),
    content: body,
  }).toString();

  let url;
  try {
    url = new URL(`${site}/api/v1/messages`);
  } catch {
    return Promise.reject(new Error('Zulip Site URL is not configured or invalid'));
  }

  const client = url.protocol === 'http:' ? http : https;

  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: 'POST',
        agent: client === https ? buildZulipAgent() : undefined,
        timeout: 8000,
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(form),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`Zulip API returned ${res.statusCode}${data ? `: ${data.slice(0, 300)}` : ''}`));
          }
          resolve();
        });
      }
    );

    req.on('timeout', () => req.destroy(new Error('Zulip API request timed out')));
    req.on('error', (err) => reject(new Error(`Could not reach the Zulip API at ${site}: ${err.message}`)));
    req.write(form);
    req.end();
  });
}

/**
 * Notifies a single reservation's owner that it was released.
 *
 * @param {object} params
 * @param {{email?: string, display_name: string}} params.owner — the reservation's owner
 * @param {string} params.deploymentName
 * @param {string} params.clusterName
 * @param {'admin'|'expired'} params.reason
 * @param {string} [params.releasedByLabel] — display name of the admin who released it (reason: 'admin' only)
 */
async function notifyReservationReleased({ owner, deploymentName, clusterName, reason, releasedByLabel }) {
  if (!owner?.email) {
    return; // Nothing to notify — no email on file for this user.
  }

  const settings = getSettings();
  const { subject, body } = buildMessage({ deploymentName, clusterName, reason, releasedByLabel });

  const tasks = [];
  if (settings.smtp_enabled === 'true' && settings.smtp_host) {
    tasks.push(
      sendEmail(settings, owner.email, subject, body)
        .catch((err) => console.error(`[notify] Email to ${owner.email} failed:`, err.message))
    );
  }
  if (settings.zulip_enabled === 'true' && settings.zulip_site && settings.zulip_bot_email) {
    tasks.push(
      sendZulipDM(settings, owner.email, body)
        .catch((err) => console.error(`[notify] Zulip DM to ${owner.email} failed:`, err.message))
    );
  }

  await Promise.all(tasks);
}

/**
 * Runs the expired-reservation sweep (db.releaseExpiredReservations()) and
 * fires a release notification for each reservation it released. Use this
 * instead of calling db.releaseExpiredReservations() directly wherever the
 * sweep needs to run, so auto-expiry notifications actually go out.
 *
 * Fire-and-forget by design: callers don't need to await the notification
 * sends, only the release itself (already synchronous via better-sqlite3).
 *
 * @returns {number} Number of reservations released by this call.
 */
function sweepExpiredReservations() {
  const expired = db.releaseExpiredReservations();

  for (const row of expired) {
    notifyReservationReleased({
      owner: { email: row.owner_email, display_name: row.owner_display_name },
      deploymentName: row.deployment_name,
      clusterName: row.cluster_name,
      reason: 'expired',
    }).catch((err) => console.error('[notify] Auto-expiry notification failed:', err.message));
  }

  return expired.length;
}

/**
 * Sends a one-off test message through whichever channels are enabled, to
 * verify the Admin panel's notification settings actually work.
 *
 * A channel that's enabled but missing required fields (e.g. "Zulip"
 * checked but no Bot API Key saved yet) still gets a result explaining
 * that, rather than being silently skipped like a real release
 * notification would be — this is a deliberate test, so silence here would
 * just look like a channel that quietly did nothing.
 *
 * @param {string} toEmail
 * @returns {Promise<{smtp?: 'ok'|string, zulip?: 'ok'|string}>} Per-channel result — 'ok' or an explanatory message. A channel key is present only when that channel is enabled.
 */
async function sendTestNotification(toEmail) {
  const settings = getSettings();
  const results = {};

  if (settings.smtp_enabled === 'true') {
    if (!settings.smtp_host) {
      results.smtp = 'Enabled, but no SMTP host is set — fill in Host and Save Settings.';
    } else {
      try {
        await sendEmail(settings, toEmail, 'Deployment Manager — test notification', 'This is a test notification from Deployment Manager. If you received this, SMTP is configured correctly.');
        results.smtp = 'ok';
      } catch (err) {
        results.smtp = err.message;
      }
    }
  }

  if (settings.zulip_enabled === 'true') {
    if (!settings.zulip_site || !settings.zulip_bot_email || !settings.zulip_bot_api_key) {
      results.zulip = 'Enabled, but Site URL, Bot Email, and/or Bot API Key are missing — fill them in and Save Settings.';
    } else {
      try {
        await sendZulipDM(settings, toEmail, 'This is a test notification from Deployment Manager. If you received this, Zulip is configured correctly.');
        results.zulip = 'ok';
      } catch (err) {
        results.zulip = err.message;
      }
    }
  }

  return results;
}

module.exports = {
  notifyReservationReleased,
  sweepExpiredReservations,
  sendTestNotification,
};
