/**
 * Login View — SPINEGO branded login screen
 */
const LoginView = {
  render() {
    return `
      <div class="login-page">
        <div class="login-card">
          <div class="login-brand">
            <div class="login-logo">DM</div>
            <h1>Deployment Manager</h1>
            <div class="subtitle">Powered by SPINEGO</div>
          </div>
          <form class="login-form" id="login-form">
            <div class="input-group">
              <label for="username-input">Username</label>
              <input
                type="text"
                id="username-input"
                placeholder="Enter your SPINEGO username"
                autocomplete="username"
                autofocus
                required
              />
            </div>
            <button type="submit" class="btn btn-primary btn-lg btn-block" id="login-btn">
              Sign In with SPINEGO
            </button>
          </form>
          <p style="text-align: center; margin-top: 16px; font-size: 12px; color: var(--text-muted);">
            First user to sign in becomes the administrator.
          </p>
        </div>
      </div>
    `;
  },

  afterRender() {
    const form = document.getElementById('login-form');
    const input = document.getElementById('username-input');
    const btn = document.getElementById('login-btn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = input.value.trim();
      if (!username) return;

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Signing in...';

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
        btn.innerHTML = 'Sign In with SPINEGO';
      }
    });
  },
};
