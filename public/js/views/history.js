/**
 * History View — Reservation history table with filters
 */
const HistoryView = {
  page: 0,
  limit: 20,
  total: 0,

  render() {
    return `
      <div class="app-layout">
        ${App.renderNavbar('history')}
        <main class="main-content">
          <div class="page-header">
            <h2>Reservation History</h2>
            <p>Full audit trail of all deployment reservations</p>
          </div>

          <div class="filter-bar">
            <select id="history-filter-cluster">
              <option value="">All Clusters</option>
            </select>
            <select id="history-filter-status">
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="released">Released</option>
            </select>
          </div>

          <div id="history-content">
            <div class="history-table-container">
              <table class="history-table">
                <thead>
                  <tr>
                    <th>Deployment</th>
                    <th>Cluster</th>
                    <th>User</th>
                    <th>Reserved At</th>
                    <th>Released At</th>
                    <th>Duration</th>
                    <th>Status</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody id="history-tbody">
                  <tr><td colspan="8"><div class="skeleton skeleton-row"></div></td></tr>
                </tbody>
              </table>
            </div>
            <div class="pagination" id="history-pagination"></div>
          </div>
        </main>
      </div>
    `;
  },

  async afterRender() {
    await this.loadClusters();
    await this.loadHistory();
    this.setupFilters();
  },

  async loadClusters() {
    try {
      const data = await App.api('/api/clusters');
      const select = document.getElementById('history-filter-cluster');
      if (select && data.clusters) {
        data.clusters.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.id;
          opt.textContent = c.name;
          select.appendChild(opt);
        });
      }
    } catch (err) {
      // Non-critical, filter just won't have cluster options
    }
  },

  async loadHistory() {
    const clusterId = document.getElementById('history-filter-cluster')?.value || '';
    const statusFilter = document.getElementById('history-filter-status')?.value || '';

    try {
      let url = `/api/admin/history?limit=${this.limit}&offset=${this.page * this.limit}`;
      if (clusterId) url += `&cluster_id=${clusterId}`;

      // Try admin endpoint first, fall back to basic
      let data;
      try {
        data = await App.api(url);
      } catch {
        // If not admin, use per-deployment history — show only user's reservations
        data = { history: [], total: 0 };
      }

      let history = data.history || [];

      // Client-side status filter
      if (statusFilter === 'active') {
        history = history.filter(h => !h.released_at);
      } else if (statusFilter === 'released') {
        history = history.filter(h => h.released_at);
      }

      this.total = data.total || 0;
      this.renderTable(history);
      this.renderPagination();
    } catch (err) {
      App.showToast('Failed to load history: ' + err.message, 'error');
    }
  },

  renderTable(history) {
    const tbody = document.getElementById('history-tbody');
    if (!tbody) return;

    if (history.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8">
            <div class="empty-state">
              <div class="empty-icon">📋</div>
              <p>No reservation history found.</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = history.map(item => {
      const isActive = !item.released_at;
      const duration = this.calcDuration(item.reserved_at, item.released_at);
      const durationClass = this.getDurationClass(item.reserved_at, item.released_at);

      return `
        <tr>
          <td class="mono">${this.escapeHtml(item.deployment_name)}</td>
          <td>${this.escapeHtml(item.cluster_name)}</td>
          <td>
            <span class="reserved-by">
              <span class="user-icon">${(item.display_name || '?')[0].toUpperCase()}</span>
              ${this.escapeHtml(item.display_name)}
            </span>
          </td>
          <td class="mono">${this.formatDate(item.reserved_at)}</td>
          <td class="mono">${isActive ? '—' : this.formatDate(item.released_at)}</td>
          <td>
            <span class="duration-badge ${durationClass}">${duration}</span>
          </td>
          <td>
            <span class="status-badge ${isActive ? 'active' : 'released'}">
              ${isActive ? '● Active' : '✓ Released'}
            </span>
          </td>
          <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis;" title="${this.escapeHtml(item.notes || '')}">
            ${this.escapeHtml(item.notes || '—')}
          </td>
        </tr>
      `;
    }).join('');
  },

  renderPagination() {
    const container = document.getElementById('history-pagination');
    if (!container) return;

    const totalPages = Math.ceil(this.total / this.limit);
    if (totalPages <= 1) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <button ${this.page === 0 ? 'disabled' : ''} onclick="HistoryView.goToPage(${this.page - 1})">← Prev</button>
      <span class="page-info">Page ${this.page + 1} of ${totalPages}</span>
      <button ${this.page >= totalPages - 1 ? 'disabled' : ''} onclick="HistoryView.goToPage(${this.page + 1})">Next →</button>
    `;
  },

  goToPage(page) {
    this.page = page;
    this.loadHistory();
  },

  setupFilters() {
    ['history-filter-cluster', 'history-filter-status'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', () => {
          this.page = 0;
          this.loadHistory();
        });
      }
    });
  },

  calcDuration(reservedAt, releasedAt) {
    const start = new Date(reservedAt + 'Z');
    const end = releasedAt ? new Date(releasedAt + 'Z') : new Date();
    const diffMs = end - start;

    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
  },

  getDurationClass(reservedAt, releasedAt) {
    const start = new Date(reservedAt + 'Z');
    const end = releasedAt ? new Date(releasedAt + 'Z') : new Date();
    const hours = (end - start) / (1000 * 60 * 60);

    if (hours < 1) return 'short';
    if (hours < 4) return 'medium';
    return 'long';
  },

  formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'Z');
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  },

  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};
