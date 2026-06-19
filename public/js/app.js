/**
 * App — Main application controller
 * Handles routing, auth state, API calls, and shared UI components.
 */
const App = {
  token: null,
  user: null,
  currentView: null,
  currentViewName: null,

  /** Initialize the app */
  init() {
    // Restore auth from localStorage
    const saved = localStorage.getItem('dm_auth');
    if (saved) {
      try {
        const { token, user } = JSON.parse(saved);
        this.token = token;
        this.user = user;
      } catch {
        localStorage.removeItem('dm_auth');
      }
    }

    // Listen for hash changes
    window.addEventListener('hashchange', () => this.route());

    // Initial route
    this.route();
  },

  /** Route based on hash */
  route() {
    const hash = window.location.hash.slice(1) || '';
    const [view] = hash.split('/');

    // Cleanup previous view
    if (this.currentView?.destroy) {
      this.currentView.destroy();
    }

    // Auth guard
    if (!this.token && view !== 'login') {
      window.location.hash = '#login';
      return;
    }

    // Already logged in → redirect away from login
    if (this.token && (view === 'login' || view === '')) {
      window.location.hash = '#dashboard';
      return;
    }

    // Render view
    const views = {
      login: LoginView,
      dashboard: DashboardView,
      admin: AdminView,
      history: HistoryView,
    };

    const ViewClass = views[view] || views.dashboard;
    this.currentView = ViewClass;
    this.currentViewName = view;

    const app = document.getElementById('app');
    app.innerHTML = ViewClass.render();

    if (ViewClass.afterRender) {
      ViewClass.afterRender();
    }
  },

  /** Navigate to a view */
  navigate(view) {
    window.location.hash = `#${view}`;
  },

  /** Save auth state */
  setAuth(token, user) {
    this.token = token;
    this.user = user;
    localStorage.setItem('dm_auth', JSON.stringify({ token, user }));
  },

  /** Clear auth state */
  logout() {
    this.token = null;
    this.user = null;
    localStorage.removeItem('dm_auth');
    this.navigate('login');
    this.showToast('Logged out.', 'info');
  },

  /** API fetch wrapper */
  async api(url, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
    };

    if (!options.noAuth && this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(url, {
      ...options,
      headers: { ...headers, ...options.headers },
    });

    const data = await res.json();

    if (!res.ok) {
      // Handle expired token
      if (res.status === 401) {
        this.logout();
        throw new Error('Session expired. Please login again.');
      }
      throw new Error(data.error || `Request failed (${res.status})`);
    }

    return data;
  },

  /** Render the navbar */
  renderNavbar(active) {
    const isAdmin = this.user?.role === 'admin';
    const initials = (this.user?.display_name || '?').slice(0, 2).toUpperCase();

    return `
      <nav class="navbar">
        <div class="navbar-brand">
          <div class="navbar-logo">DM</div>
          <span class="navbar-title">Deployment Manager</span>
        </div>
        <div class="navbar-nav">
          <button class="nav-link ${active === 'dashboard' ? 'active' : ''}" onclick="App.navigate('dashboard')">
            📊 Dashboard
          </button>
          <button class="nav-link ${active === 'history' ? 'active' : ''}" onclick="App.navigate('history')">
            📋 History
          </button>
          ${isAdmin ? `
            <button class="nav-link ${active === 'admin' ? 'active' : ''}" onclick="App.navigate('admin')">
              ⚙️ Admin
            </button>
          ` : ''}
        </div>
        <div class="navbar-user">
          <div class="user-badge">
            <div class="user-avatar">${initials}</div>
            <span>${this.escapeHtml(this.user?.display_name)}</span>
            <span class="role-tag ${this.user?.role}">${this.user?.role}</span>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="App.logout()">Logout</button>
        </div>
      </nav>
    `;
  },

  /** Show toast notification */
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span> ${this.escapeHtml(message)}`;

    container.appendChild(toast);

    // Auto remove after 4 seconds
    setTimeout(() => {
      toast.style.animation = 'toastOut 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  },

  /** Escape HTML to prevent XSS */
  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};

// Boot the app
document.addEventListener('DOMContentLoaded', () => App.init());
