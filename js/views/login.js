import { signIn } from '../auth.js';
import { showToast } from '../utils.js';

export async function renderLogin(root) {
  root.innerHTML = `
    <div class="login-shell fade-in">
      <div class="login-left">
        <div class="login-left-top">
          <div class="logo">
            <div class="logo-mark">Σ</div>
            <span class="logo-text">Sigma Software</span>
            <span class="logo-sub">Inquire</span>
          </div>
        </div>
        <div>
          <h2 class="login-quote">Turn questions into <span class="red">decisions</span>.</h2>
          <div class="login-quote-attr">Inquire · v0.1</div>
        </div>
      </div>

      <div class="login-right">
        <form class="login-form" id="loginForm" novalidate>
          <div class="login-eyebrow">Sign in</div>
          <h1 class="login-title">Welcome back.</h1>
          <p class="login-subtitle">Enter your credentials to access your workspace.</p>

          <div class="login-fields">
            <div class="field">
              <label class="field-label" for="email">Email</label>
              <input class="input" type="email" id="email" name="email" autocomplete="email" required />
            </div>
            <div class="field">
              <label class="field-label" for="password">Password</label>
              <input class="input" type="password" id="password" name="password" autocomplete="current-password" required />
            </div>
            <div class="field-error" id="loginError" style="display:none;"></div>
          </div>

          <button class="btn btn-block" type="submit" id="loginBtn">
            <span id="loginBtnText">Sign in</span>
            <span class="arrow">→</span>
          </button>

          <div class="login-footer">
            Need a client account? Use the registration link from your administrator.
          </div>
        </form>
      </div>
    </div>
  `;

  const form = root.querySelector('#loginForm');
  const errorEl = root.querySelector('#loginError');
  const btn = root.querySelector('#loginBtn');
  const btnText = root.querySelector('#loginBtnText');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.style.display = 'none';
    errorEl.textContent = '';

    const email = form.email.value.trim();
    const password = form.password.value;

    if (!email || !password) {
      errorEl.textContent = 'Email and password are required.';
      errorEl.style.display = 'block';
      return;
    }

    btn.disabled = true;
    btnText.innerHTML = '<span class="spinner"></span> Signing in';

    try {
      await signIn(email, password);
      // onAuthChange triggers router → automatically navigates to /admin or /cabinet
    } catch (err) {
      const msg = err?.message ?? 'Sign in failed.';
      errorEl.textContent = msg.includes('Invalid login') ? 'Invalid email or password.' : msg;
      errorEl.style.display = 'block';
      btn.disabled = false;
      btnText.textContent = 'Sign in';
    }
  });
}
