/**
 * Login View
 * Supports: "local" (username only) manual login, "sso" (trusted header)
 * with a manual fallback if the header is missing, and "oidc" (Keycloak) —
 * which has no manual fallback, since Keycloak is the sole identity source
 * once configured.
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
            <button type="submit" class="btn btn-primary btn-lg btn-block" id="login-btn">
              Sign In
            </button>
          </form>
          <div id="login-loading" style="text-align:center; padding: 24px 0;">
            <span class="spinner"></span>
            <p style="margin-top: 12px; color: var(--text-muted); font-size: 13px;">Checking authentication mode…</p>
          </div>
        </div>
      </div>
    `;
  },

  async afterRender() {
    const form = document.getElementById('login-form');
    const usernameInput = document.getElementById('username-input');
    const btn = document.getElementById('login-btn');
    const loading = document.getElementById('login-loading');

    // Register event listener first so it is ALWAYS active
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = usernameInput.value.trim();
      if (!username) return;

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Signing in…';

      try {
        const data = await App.api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username }),
          noAuth: true,
        });

        App.setAuth(data.token, data.user);
        App.showToast(`Welcome, ${data.user.display_name}!`, 'success');
        App.navigate('dashboard');
      } catch (err) {
        App.showToast(err.message || 'Login failed', 'error');
        btn.disabled = false;
        btn.innerHTML = 'Sign In';
      }
    });

    // Determine auth mode from the server
    try {
      const data = await App.api('/api/auth/mode', { noAuth: true });
      this.authMode = data.mode;
    } catch {
      // Default to local mode if the endpoint is unreachable
      this.authMode = 'local';
    }

    const switchToManual = () => {
      // Remove any SSO error or OIDC container
      const ssoErr = document.getElementById('sso-error-container');
      if (ssoErr) ssoErr.remove();
      const oidcCont = document.getElementById('oidc-container');
      if (oidcCont) oidcCont.remove();

      usernameInput.placeholder = 'Enter your username';
      btn.textContent = 'Sign In';

      // Show the form, hide the loading indicator
      loading.style.display = 'none';
      form.style.display = '';
      usernameInput.focus();
    };

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
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <button class="btn btn-primary btn-block" onclick="window.location.reload()">Retry Sign-in</button>
            <button class="btn btn-secondary btn-block" id="sso-fallback-btn">Sign In Manually</button>
          </div>
        `;
        card.appendChild(errDiv);

        document.getElementById('sso-fallback-btn').addEventListener('click', () => {
          switchToManual();
        });
      }
      return;
    }

    if (this.authMode === 'oidc') {
      // No manual fallback here on purpose: Keycloak is the sole identity
      // source in this mode, so there is no "type any username" option —
      // the backend rejects it outright even if one were shown.
      //
      // Auto-redirect immediately rather than waiting for a click — if the
      // browser already has an active Keycloak session, this bounces the
      // user straight back in without ever showing a login screen, the
      // same way "sso" mode logs in without any interaction.
      loading.querySelector('p').textContent = 'Redirecting to Keycloak…';
      const card = document.querySelector('.login-card');
      const oidcDiv = document.createElement('div');
      oidcDiv.id = 'oidc-container';
      oidcDiv.style.textAlign = 'center';
      oidcDiv.style.padding = '12px 0';
      oidcDiv.innerHTML = `
        <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 20px;">
          Click below if you're not redirected automatically.
        </p>
        <a href="/api/auth/oidc/login" class="btn btn-primary btn-lg btn-block" style="text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 8px;">
          🔑 Sign In with Keycloak
        </a>
      `;
      card.appendChild(oidcDiv);
      window.location.href = '/api/auth/oidc/login';
      return;
    }

    // Local mode
    usernameInput.placeholder = 'Enter your username';
    btn.textContent = 'Sign In';

    // Show the form, hide the loading indicator
    loading.style.display = 'none';
    form.style.display = '';

    // Focus the username input
    usernameInput.focus();
  },
};
