/**
 * Dashboard View — Cluster grid with deployments, reservations, live timers
 */
const DashboardView = {
  timerInterval: null,
  refreshInterval: null,

  render() {
    return `
      <div class="app-layout">
        ${App.renderNavbar('dashboard')}
        <main class="main-content">
          <div class="page-header">
            <h2>Cluster Dashboard</h2>
            <p>Manage deployments across your clusters</p>
          </div>

          <div id="my-reservations-section"></div>

          <div class="filter-bar" id="filter-bar">
            <select id="filter-env">
              <option value="">All Environments</option>
              <option value="production">Production</option>
              <option value="staging">Staging</option>
              <option value="development">Development</option>
            </select>
            <select id="filter-status">
              <option value="">All Statuses</option>
              <option value="available">Available</option>
              <option value="reserved">Reserved</option>
            </select>
            <input type="text" id="filter-search" placeholder="Search deployments..." />
          </div>

          <div class="cluster-grid" id="cluster-grid">
            <div class="skeleton skeleton-card"></div>
            <div class="skeleton skeleton-card"></div>
            <div class="skeleton skeleton-card"></div>
          </div>
        </main>
      </div>
    `;
  },

  async afterRender() {
    await this.loadData();
    this.setupFilters();
    this.startTimers();
    
    // Auto-refresh every 30 seconds
    this.refreshInterval = setInterval(() => this.loadData(true), 30000);
  },

  async loadData(silent = false) {
    try {
      const [clustersRes, myRes] = await Promise.all([
        App.api('/api/clusters'),
        App.api('/api/deployments/my-reservations/active'),
      ]);

      this.clusters = clustersRes.clusters;
      this.myReservations = myRes.reservations;

      this.renderMyReservations();
      this.renderClusters();
    } catch (err) {
      if (!silent) {
        App.showToast('Failed to load clusters: ' + err.message, 'error');
      }
    }
  },

  renderMyReservations() {
    const container = document.getElementById('my-reservations-section');
    if (!container) return;

    if (!this.myReservations || this.myReservations.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <div class="my-reservations">
        <div class="my-reservations-header">
          <h3>
            ⚡ My Active Reservations
            <span class="reservation-count">${this.myReservations.length}</span>
          </h3>
        </div>
        <div class="my-reservations-grid">
          ${this.myReservations.map(r => `
            <div class="my-reservation-card">
              <div class="my-reservation-info">
                <span class="deploy-name">${this.escapeHtml(r.deployment_name)}</span>
                <span class="cluster-name">${this.escapeHtml(r.cluster_name)} · ${r.environment}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="time-tracker" data-reserved-at="${r.reserved_at}">
                  <span class="clock-icon">⏱</span>
                  <span class="timer-value">${this.formatDuration(r.reserved_at)}</span>
                </span>
                <button class="btn btn-warning btn-sm" onclick="DashboardView.releaseDeployment('${r.deployment_id}')">
                  Release
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  renderClusters() {
    const grid = document.getElementById('cluster-grid');
    if (!grid) return;

    const envFilter = document.getElementById('filter-env')?.value || '';
    const statusFilter = document.getElementById('filter-status')?.value || '';
    const search = (document.getElementById('filter-search')?.value || '').toLowerCase();

    let filtered = this.clusters;

    if (envFilter) {
      filtered = filtered.filter(c => c.environment === envFilter);
    }

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div class="empty-icon">📦</div>
          <p>No clusters found. ${App.user?.role === 'admin' ? 'Go to Admin panel to add clusters.' : 'Contact an admin to set up clusters.'}</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map((cluster, i) => {
      let deployments = cluster.deployments;

      if (statusFilter === 'available') {
        deployments = deployments.filter(d => d.status === 'available');
      } else if (statusFilter === 'reserved') {
        deployments = deployments.filter(d => d.status === 'reserved');
      }

      if (search) {
        deployments = deployments.filter(d =>
          d.name.toLowerCase().includes(search) ||
          (d.reservation?.display_name || '').toLowerCase().includes(search)
        );
      }

      return `
        <div class="cluster-card" style="animation-delay: ${i * 80}ms">
          <div class="cluster-card-header">
            <div class="cluster-info">
              <span class="cluster-name">${this.escapeHtml(cluster.name)}</span>
              <div class="cluster-meta">
                <span class="env-badge ${cluster.environment}">${cluster.environment}</span>
              </div>
            </div>
            <div class="cluster-stats">
              <div class="stat">
                <span class="stat-value available">${cluster.available}</span>
                <span class="stat-label">Free</span>
              </div>
              <div class="stat">
                <span class="stat-value reserved">${cluster.reserved}</span>
                <span class="stat-label">Reserved</span>
              </div>
            </div>
          </div>
          <div class="deployment-list">
            ${deployments.length === 0 ? `
              <div class="empty-state" style="padding: 24px;">
                <p>No matching deployments</p>
              </div>
            ` : deployments.map(dep => this.renderDeploymentRow(dep, cluster)).join('')}
          </div>
        </div>
      `;
    }).join('');
  },

  renderDeploymentRow(dep, cluster) {
    const isReserved = dep.status === 'reserved';
    const isMine = isReserved && dep.reservation?.user_id === App.user?.id;
    const statusClass = !isReserved ? 'available' : (isMine ? 'reserved-self' : 'reserved-other');
    
    const durationHours = isReserved ? this.getDurationHours(dep.reservation.reserved_at) : 0;
    const longDuration = durationHours > 4;

    return `
      <div class="deployment-row" id="deploy-row-${dep.id}">
        <div class="deployment-info">
          <span class="status-dot ${statusClass}"></span>
          <span class="deployment-name">${this.escapeHtml(dep.name)}</span>
        </div>
        <div class="deployment-meta">
          ${isReserved ? `
            <span class="reserved-by">
              <span class="user-icon">${(dep.reservation.display_name || '?')[0].toUpperCase()}</span>
              ${this.escapeHtml(dep.reservation.display_name)}
            </span>
            <span class="time-tracker ${longDuration ? 'long-duration' : ''}" data-reserved-at="${dep.reservation.reserved_at}">
              <span class="clock-icon">⏱</span>
              <span class="timer-value">${this.formatDuration(dep.reservation.reserved_at)}</span>
            </span>
          ` : ''}
          ${!isReserved ? `
            <div class="reserve-form">
              <input type="text" placeholder="Notes (optional)" id="notes-${dep.id}" />
              <button class="btn btn-success btn-sm" onclick="DashboardView.reserveDeployment('${dep.id}')">
                Reserve
              </button>
            </div>
          ` : ''}
          ${isMine ? `
            <button class="btn btn-warning btn-sm" onclick="DashboardView.releaseDeployment('${dep.id}')">
              Release
            </button>
          ` : ''}
          ${isReserved && !isMine && App.user?.role === 'admin' ? `
            <button class="btn btn-danger btn-sm" onclick="DashboardView.releaseDeployment('${dep.id}')" title="Admin force-release">
              Force Release
            </button>
          ` : ''}
        </div>
      </div>
    `;
  },

  setupFilters() {
    ['filter-env', 'filter-status', 'filter-search'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener(id === 'filter-search' ? 'input' : 'change', () => {
          this.renderClusters();
        });
      }
    });
  },

  startTimers() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      document.querySelectorAll('.time-tracker').forEach(el => {
        const reservedAt = el.dataset.reservedAt;
        if (!reservedAt) return;
        const timerVal = el.querySelector('.timer-value');
        if (timerVal) {
          timerVal.textContent = this.formatDuration(reservedAt);
        }
        // Toggle long-duration class
        const hours = this.getDurationHours(reservedAt);
        el.classList.toggle('long-duration', hours > 4);
      });
    }, 1000);
  },

  async reserveDeployment(deploymentId) {
    const notesInput = document.getElementById(`notes-${deploymentId}`);
    const notes = notesInput ? notesInput.value.trim() : '';

    try {
      await App.api(`/api/deployments/${deploymentId}/reserve`, {
        method: 'POST',
        body: JSON.stringify({ notes }),
      });
      App.showToast('Deployment reserved!', 'success');
      await this.loadData();
    } catch (err) {
      App.showToast(err.message || 'Failed to reserve', 'error');
    }
  },

  async releaseDeployment(deploymentId) {
    try {
      await App.api(`/api/deployments/${deploymentId}/release`, {
        method: 'POST',
      });
      App.showToast('Deployment released!', 'success');
      await this.loadData();
    } catch (err) {
      App.showToast(err.message || 'Failed to release', 'error');
    }
  },

  formatDuration(reservedAt) {
    const now = new Date();
    const reserved = new Date(reservedAt + 'Z'); // SQLite stores UTC
    const diffMs = now - reserved;

    if (diffMs < 0) return '0s';

    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  },

  getDurationHours(reservedAt) {
    const now = new Date();
    const reserved = new Date(reservedAt + 'Z');
    return (now - reserved) / (1000 * 60 * 60);
  },

  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  destroy() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  },
};
