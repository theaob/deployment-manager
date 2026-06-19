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
      const [clustersRes, usersRes] = await Promise.all([
        App.api('/api/clusters'),
        App.api('/api/admin/users'),
      ]);

      this.clusters = clustersRes.clusters;
      this.users = usersRes.users;

      this.renderClusters();
      this.renderUsers();
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

  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};
