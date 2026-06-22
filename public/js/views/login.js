/**
 * Login View — SPINEGO branded login screen
 * Supports two modes:
 *   - "ad"    → username + password (validated against Active Directory via LDAP)
 *   - "local" → username only (no password, current behaviour)
 */
const LoginView = {
  authMode: null,

  render() {
    return `
      <div class="login-page">
        <div class="login-card">
          <div class="login-brand">
            <div class="login-logo">DM</div>
            <h1>Deployment Manager</h1>
            <div class="subtitle">Powered by SPINEGO</div>
          </div>
          <form class="login-form" id="login-form" style="display:none;">
            <div class="input-group">
              <label for="username-input">Username</label>
              <input
                type="text"
                id="username-input"
                placeholder="Enter your username"
                autocomplete="username"
                autofocus
                required
              />
            </div>
            <div class="input-group" id="password-group" style="display:none;">
              <label for="password-input">Password</label>
              <input
                type="password"
                id="password-input"
                placeholder="Enter your password"
                autocomplete="current-password"
                required
              />
            </div>
            <button type="submit" class="btn btn-primary btn-lg btn-block" id="login-btn">
              Sign In
            </button>
          </form>
          <div id="login-loading" style="text-align:center; padding: 24px 0;">
            <span class="spinner"></span>
            <p style="margin-top: 12px; color: var(--text-muted); font-size: 13px;">Checking authentication mode…</p>
          </div>
          <p style="text-align: center; margin-top: 16px; font-size: 12px; color: var(--text-muted);">
            First user to sign in becomes the administrator.
          </p>
        </div>
      </div>
    `;
  },

  async afterRender() {
    const form = document.getElementById('login-form');
    const usernameInput = document.getElementById('username-input');
    const passwordGroup = document.getElementById('password-group');
    const passwordInput = document.getElementById('password-input');
    const btn = document.getElementById('login-btn');
    const loading = document.getElementById('login-loading');

    // Determine auth mode from the server
    try {
      const data = await App.api('/api/auth/mode', { noAuth: true });
      this.authMode = data.mode;
    } catch {
      // Default to local mode if the endpoint is unreachable
      this.authMode = 'local';
    }

    // Configure the form based on auth mode
    if (this.authMode === 'sso') {
      loading.querySelector('p').textContent = 'Signing in automatically via SSO…';
      try {
        const data = await App.api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({}),
          noAuth: true,
        });

        App.setAuth(data.token, data.user);
        App.showToast(`Welcome, ${data.user.display_name}!`, 'success');
        App.navigate('dashboard');
      } catch (err) {
        loading.style.display = 'none';
        const card = document.querySelector('.login-card');
        const errDiv = document.createElement('div');
        errDiv.id = 'sso-error-container';
        errDiv.style.textAlign = 'center';
        errDiv.innerHTML = `
          <div style="color: #ef4444; margin-bottom: 20px;">
            <div style="font-size: 40px; margin-bottom: 8px;">⚠️</div>
            <h3 style="margin-bottom: 6px;">SSO Sign-in Failed</h3>
            <p style="font-size: 13px; color: var(--text-muted);">${App.escapeHtml(err.message)}</p>
          </div>
          <button class="btn btn-primary btn-block" onclick="window.location.reload()">Retry Sign-in</button>
        `;
        card.appendChild(errDiv);
      }
      return;
    }

    if (this.authMode === 'ad') {
      usernameInput.placeholder = 'Enter your Active Directory username';
      passwordGroup.style.display = '';
      passwordInput.required = true;
      btn.textContent = 'Sign In with Active Directory';
    } else {
      usernameInput.placeholder = 'Enter your SPINEGO username';
      passwordGroup.style.display = 'none';
      passwordInput.required = false;
      btn.textContent = 'Sign In with SPINEGO';
    }

    // Show the form, hide the loading indicator
    loading.style.display = 'none';
    form.style.display = '';

    // Focus the username input
    usernameInput.focus();

    // Handle form submission
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = usernameInput.value.trim();
      if (!username) return;

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Signing in…';

      try {
        const body = { username };
        if (this.authMode === 'ad') {
          body.password = passwordInput.value;
        }

        const data = await App.api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify(body),
          noAuth: true,
        });

        App.setAuth(data.token, data.user);
        App.showToast(`Welcome, ${data.user.display_name}!`, 'success');
        App.navigate('dashboard');
      } catch (err) {
        App.showToast(err.message || 'Login failed', 'error');
        btn.disabled = false;
        btn.innerHTML = this.authMode === 'ad'
          ? 'Sign In with Active Directory'
          : 'Sign In with SPINEGO';
      }
    });
  },
};
