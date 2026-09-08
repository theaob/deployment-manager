/**
 * Admin View — Manage clusters, deployments, and users
 */
const AdminView = {
  render() {
    return `
      <div class="app-layout">
        ${App.renderNavbar('admin')}
        <main class="main-content">
          <div class="page-header">
            <h2>Admin Panel</h2>
            <p>Manage clusters, deployments, and users</p>
          </div>

          <div class="admin-layout">
            <!-- Add Cluster Form -->
            <div class="admin-section">
              <div class="admin-section-header">
                <h3>➕ Add New Cluster</h3>
              </div>
              <form class="admin-form" id="add-cluster-form">
                <div class="input-group">
                  <label for="new-cluster-name">Cluster Name</label>
                  <input type="text" id="new-cluster-name" placeholder="e.g. Alpha Cluster" required />
                </div>
                <div class="input-group">
                  <label for="new-cluster-env">Environment</label>
                  <select id="new-cluster-env" required>
                    <option value="development">Development</option>
                    <option value="staging">Staging</option>
                    <option value="production">Production</option>
                  </select>
                </div>
                <button type="submit" class="btn btn-primary">Add Cluster</button>
              </form>
            </div>

            <!-- Clusters List -->
            <div class="admin-section">
              <div class="admin-section-header">
                <h3>📦 Clusters & Deployments</h3>
              </div>
              <div id="admin-clusters-list">
                <div class="skeleton skeleton-row"></div>
                <div class="skeleton skeleton-row"></div>
              </div>
            </div>

            <!-- Users -->
            <div class="admin-section">
              <div class="admin-section-header">
                <h3>👥 Users</h3>
              </div>
              <div id="admin-users-list">
                <div class="skeleton skeleton-row"></div>
              </div>
            </div>

            <!-- Notification Settings -->
            <div class="admin-section">
              <div class="admin-section-header">
                <h3>🔔 Release Notifications</h3>
              </div>
              <p style="color: var(--text-tertiary); font-size: 13px; margin-bottom: 16px;">
                When someone's reservation is released by an admin, or auto-released because its time limit ran out, notify them by email and/or Zulip. A user needs an email address on file (see the Users table above) to receive either.
              </p>
              <div id="notification-settings">
                <div class="skeleton skeleton-row"></div>
              </div>
            </div>
          </div>
        </main>
      </div>
    `;
  },

  async afterRender() {
    if (App.user?.role !== 'admin') {
      App.showToast('Admin access required', 'error');
      App.navigate('dashboard');
      return;
    }

    await this.loadData();
    this.setupForms();
  },

  async loadData() {
    try {
      const [clustersRes, usersRes, settingsRes] = await Promise.all([
        App.api('/api/clusters'),
        App.api('/api/admin/users'),
        App.api('/api/admin/settings'),
      ]);

      this.clusters = clustersRes.clusters;
      this.users = usersRes.users;
      this.settings = settingsRes.settings;

      this.renderClusters();
      this.renderUsers();
      this.renderNotificationSettings();
    } catch (err) {
      App.showToast('Failed to load admin data: ' + err.message, 'error');
    }
  },

  renderClusters() {
    const container = document.getElementById('admin-clusters-list');
    if (!container) return;

    if (!this.clusters || this.clusters.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📦</div>
          <p>No clusters yet. Add one above.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = this.clusters.map(cluster => `
      <div class="admin-cluster-item">
        <div class="admin-cluster-header">
          <h4>
            ${this.escapeHtml(cluster.name)}
            <span class="env-badge ${cluster.environment}">${cluster.environment}</span>
          </h4>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-danger btn-sm" onclick="AdminView.deleteCluster('${cluster.id}', '${this.escapeHtml(cluster.name)}')">
              Delete Cluster
            </button>
          </div>
        </div>

        <div class="admin-deployment-list">
          ${cluster.deployments.map(dep => `
            <div class="admin-deployment-item">
              <span>${this.escapeHtml(dep.name)}</span>
              <div style="display: flex; align-items: center; gap: 8px;">
                ${dep.status === 'reserved' ? `
                  <span class="status-badge active">Reserved</span>
                ` : ''}
                <button class="btn btn-ghost btn-sm" onclick="AdminView.deleteDeployment('${dep.id}', '${this.escapeHtml(dep.name)}')" ${dep.status === 'reserved' ? 'disabled title="Release first"' : ''}>
                  Remove
                </button>
              </div>
            </div>
          `).join('')}
        </div>

        <form class="admin-form" style="margin-top: 12px;" onsubmit="AdminView.addDeployment(event, '${cluster.id}')">
          <div class="input-group">
            <input type="text" placeholder="New deployment name" required class="add-deploy-input" />
          </div>
          <button type="submit" class="btn btn-ghost btn-sm">+ Add Deployment</button>
        </form>
      </div>
    `).join('');
  },

  renderUsers() {
    const container = document.getElementById('admin-users-list');
    if (!container) return;

    container.innerHTML = `
      <div class="history-table-container">
        <table class="history-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Display Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Joined</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${this.users.map(user => `
              <tr>
                <td class="mono">${this.escapeHtml(user.username)}</td>
                <td>${this.escapeHtml(user.display_name)}</td>
                <td>
                  <div style="display: flex; gap: 6px; align-items: center;">
                    <input
                      type="email"
                      class="user-email-input"
                      id="email-${user.id}"
                      value="${this.escapeHtml(user.email || '')}"
                      placeholder="user@example.com"
                      style="width: 180px; padding: 6px 10px; background: var(--bg-input); border: 1px solid var(--border-default); border-radius: var(--radius-sm); color: var(--text-primary); font-size: 12px;"
                    />
                    <button class="btn btn-ghost btn-sm" onclick="AdminView.saveUserEmail('${user.id}')">Save</button>
                  </div>
                </td>
                <td><span class="role-tag ${user.role}">${user.role}</span></td>
                <td class="mono">${new Date(user.created_at + 'Z').toLocaleDateString()}</td>
                <td>
                  ${user.id !== App.user.id ? `
                    <button class="btn btn-ghost btn-sm" onclick="AdminView.toggleRole('${user.id}', '${user.role}')">
                      ${user.role === 'admin' ? 'Demote to User' : 'Promote to Admin'}
                    </button>
                  ` : '<span style="color: var(--text-muted); font-size: 12px;">You</span>'}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  renderNotificationSettings() {
    const container = document.getElementById('notification-settings');
    if (!container) return;

    const s = this.settings || {};

    container.innerHTML = `
      <form id="notification-settings-form" onsubmit="return AdminView.saveNotificationSettings(event)" style="display: flex; flex-direction: column; gap: 20px;">
        <div>
          <label style="display: flex; align-items: center; gap: 8px; font-weight: 600; margin-bottom: 12px;">
            <input type="checkbox" id="smtp-enabled" ${s.smtp_enabled ? 'checked' : ''} />
            Email (SMTP)
          </label>
          <div class="admin-form">
            <div class="input-group">
              <label for="smtp-host">Host</label>
              <input type="text" id="smtp-host" value="${this.escapeHtml(s.smtp_host || '')}" placeholder="smtp.example.com" />
            </div>
            <div class="input-group" style="max-width: 100px;">
              <label for="smtp-port">Port</label>
              <input type="number" id="smtp-port" value="${this.escapeHtml(s.smtp_port || '')}" placeholder="587" />
            </div>
            <div class="input-group">
              <label for="smtp-user">Username</label>
              <input type="text" id="smtp-user" value="${this.escapeHtml(s.smtp_user || '')}" autocomplete="off" />
            </div>
            <div class="input-group">
              <label for="smtp-pass">Password</label>
              <input type="password" id="smtp-pass" placeholder="${s.smtp_pass_set ? '••••••••  (leave blank to keep)' : 'Not set'}" autocomplete="new-password" />
            </div>
            <div class="input-group">
              <label for="smtp-from">From Address</label>
              <input type="text" id="smtp-from" value="${this.escapeHtml(s.smtp_from || '')}" placeholder="deployment-manager@example.com" />
            </div>
            <div class="input-group" style="flex: 0 0 auto; min-width: auto;">
              <label style="display: flex; align-items: center; gap: 6px; white-space: nowrap;">
                <input type="checkbox" id="smtp-secure" ${s.smtp_secure ? 'checked' : ''} />
                TLS/SSL
              </label>
            </div>
          </div>
        </div>

        <div style="border-top: 1px solid var(--border-subtle); padding-top: 20px;">
          <label style="display: flex; align-items: center; gap: 8px; font-weight: 600; margin-bottom: 12px;">
            <input type="checkbox" id="zulip-enabled" ${s.zulip_enabled ? 'checked' : ''} />
            Zulip
          </label>
          <div class="admin-form">
            <div class="input-group">
              <label for="zulip-site">Site URL</label>
              <input type="text" id="zulip-site" value="${this.escapeHtml(s.zulip_site || '')}" placeholder="https://yourorg.zulipchat.com" />
            </div>
            <div class="input-group">
              <label for="zulip-bot-email">Bot Email</label>
              <input type="text" id="zulip-bot-email" value="${this.escapeHtml(s.zulip_bot_email || '')}" placeholder="bot@yourorg.zulipchat.com" autocomplete="off" />
            </div>
            <div class="input-group">
              <label for="zulip-bot-api-key">Bot API Key</label>
              <input type="password" id="zulip-bot-api-key" placeholder="${s.zulip_bot_api_key_set ? '••••••••  (leave blank to keep)' : 'Not set'}" autocomplete="new-password" />
            </div>
          </div>
        </div>

        <div style="display: flex; gap: 8px;">
          <button type="submit" class="btn btn-primary">Save Settings</button>
          <button type="button" class="btn btn-ghost" onclick="AdminView.sendTestNotification()">Send Test Notification</button>
        </div>
      </form>
    `;
  },

  setupForms() {
    const addClusterForm = document.getElementById('add-cluster-form');
    if (addClusterForm) {
      addClusterForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('new-cluster-name').value.trim();
        const environment = document.getElementById('new-cluster-env').value;

        if (!name) return;

        try {
          await App.api('/api/admin/clusters', {
            method: 'POST',
            body: JSON.stringify({ name, environment }),
          });
          App.showToast('Cluster created!', 'success');
          document.getElementById('new-cluster-name').value = '';
          await this.loadData();
        } catch (err) {
          App.showToast(err.message || 'Failed to create cluster', 'error');
        }
      });
    }
  },

  async addDeployment(e, clusterId) {
    e.preventDefault();
    const input = e.target.querySelector('.add-deploy-input');
    const name = input.value.trim();
    if (!name) return;

    try {
      await App.api(`/api/admin/clusters/${clusterId}/deployments`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      App.showToast('Deployment added!', 'success');
      input.value = '';
      await this.loadData();
    } catch (err) {
      App.showToast(err.message || 'Failed to add deployment', 'error');
    }
  },

  async deleteCluster(clusterId, name) {
    if (!confirm(`Delete cluster "${name}" and all its deployments? This cannot be undone.`)) return;

    try {
      await App.api(`/api/admin/clusters/${clusterId}`, { method: 'DELETE' });
      App.showToast('Cluster deleted.', 'success');
      await this.loadData();
    } catch (err) {
      App.showToast(err.message || 'Failed to delete cluster', 'error');
    }
  },

  async deleteDeployment(deploymentId, name) {
    if (!confirm(`Remove deployment "${name}"?`)) return;

    try {
      await App.api(`/api/admin/deployments/${deploymentId}`, { method: 'DELETE' });
      App.showToast('Deployment removed.', 'success');
      await this.loadData();
    } catch (err) {
      App.showToast(err.message || 'Failed to delete deployment', 'error');
    }
  },

  async toggleRole(userId, currentRole) {
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    try {
      await App.api(`/api/admin/users/${userId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role: newRole }),
      });
      App.showToast(`User role updated to ${newRole}`, 'success');
      await this.loadData();
    } catch (err) {
      App.showToast(err.message || 'Failed to update role', 'error');
    }
  },

  async saveUserEmail(userId) {
    const input = document.getElementById(`email-${userId}`);
    if (!input) return;
    const email = input.value.trim();

    try {
      await App.api(`/api/admin/users/${userId}/email`, {
        method: 'PUT',
        body: JSON.stringify({ email }),
      });
      App.showToast('Email updated', 'success');
      await this.loadData();
    } catch (err) {
      App.showToast(err.message || 'Failed to update email', 'error');
    }
  },

  async saveNotificationSettings(e) {
    e.preventDefault();

    const body = {
      smtp_enabled: document.getElementById('smtp-enabled').checked,
      smtp_host: document.getElementById('smtp-host').value.trim(),
      smtp_port: document.getElementById('smtp-port').value.trim(),
      smtp_secure: document.getElementById('smtp-secure').checked,
      smtp_user: document.getElementById('smtp-user').value.trim(),
      smtp_from: document.getElementById('smtp-from').value.trim(),
      zulip_enabled: document.getElementById('zulip-enabled').checked,
      zulip_site: document.getElementById('zulip-site').value.trim(),
      zulip_bot_email: document.getElementById('zulip-bot-email').value.trim(),
    };

    // Only send secret fields if the admin actually typed a new value —
    // an empty password/API key field means "keep the current one".
    const smtpPass = document.getElementById('smtp-pass').value;
    if (smtpPass) body.smtp_pass = smtpPass;
    const zulipKey = document.getElementById('zulip-bot-api-key').value;
    if (zulipKey) body.zulip_bot_api_key = zulipKey;

    try {
      await App.api('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      App.showToast('Notification settings saved', 'success');
      await this.loadData();
    } catch (err) {
      App.showToast(err.message || 'Failed to save settings', 'error');
    }

    return false;
  },

  async sendTestNotification() {
    try {
      const data = await App.api('/api/admin/settings/test', { method: 'POST' });
      const parts = Object.entries(data.results || {}).map(([channel, result]) => `${channel}: ${result === 'ok' ? '✓' : '✗ ' + result}`);
      App.showToast(parts.length ? `${data.message} — ${parts.join(', ')}` : data.message, parts.every(p => p.includes('✓')) ? 'success' : 'error');
    } catch (err) {
      App.showToast(err.message || 'Failed to send test notification', 'error');
    }
  },

  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};
