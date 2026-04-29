import { sb } from '../supabase.js';
import { showToast } from '../utils.js';
import { navigate } from '../router.js';
import { refreshProfile, signUp, signIn } from '../auth.js';

export async function renderRegister(root, params) {
  const token = params.token;

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
          <h2 class="login-quote">You've been <span class="red">invited</span>.</h2>
          <div class="login-quote-attr">Set up your client account to access your dashboards</div>
        </div>
      </div>

      <div class="login-right">
        <form class="login-form" id="registerForm" novalidate>
          <div class="login-eyebrow">Client registration</div>
          <h1 class="login-title">Create your <span class="red">account</span>.</h1>
          <p class="login-subtitle">Set a password to activate your invitation. You'll use this email and password to sign in from now on.</p>

          <div class="login-fields">
            <div class="field">
              <label class="field-label" for="email">Email</label>
              <input class="input" type="email" id="email" name="email" autocomplete="email" required />
              <span class="field-hint">Use the same email your administrator invited.</span>
            </div>
            <div class="field">
              <label class="field-label" for="password">Choose a password</label>
              <input class="input" type="password" id="password" name="password" autocomplete="new-password" required minlength="8" />
              <span class="field-hint">Minimum 8 characters.</span>
            </div>
            <div class="field">
              <label class="field-label" for="fullName">Your name</label>
              <input class="input" type="text" id="fullName" name="fullName" autocomplete="name" />
            </div>
            <div class="field-error" id="registerError" style="display:none;"></div>
          </div>

          <button class="btn btn-block" type="submit" id="registerBtn">
            <span id="registerBtnText">Create my account</span>
            <span class="arrow">→</span>
          </button>
        </form>
      </div>
    </div>
  `;

  const form = root.querySelector('#registerForm');
  const errorEl = root.querySelector('#registerError');
  const btn = root.querySelector('#registerBtn');
  const btnText = root.querySelector('#registerBtnText');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.style.display = 'none';

    const email = form.email.value.trim();
    const password = form.password.value;
    const fullName = form.fullName.value.trim();

    if (!email || !password) {
      errorEl.textContent = 'Email and password are required.';
      errorEl.style.display = 'block';
      return;
    }

    btn.disabled = true;
    btnText.innerHTML = '<span class="spinner"></span> Creating account';

    try {
      // 1. Sign up — auth module handles the response shape and stores tokens.
      let signUpResult;
      try {
        signUpResult = await signUp(email, password, { full_name: fullName });
      } catch (err) {
        throw err;
      }

      // If email confirmation is required, signUp returns no session.
      // Try a direct sign-in (works if email confirmation is off in Supabase settings).
      if (!signUpResult.session) {
        try {
          await signIn(email, password);
        } catch {
          showToast('Account created. Please check your email to confirm, then sign in.', 'success', 5000);
          setTimeout(() => navigate('/login'), 1500);
          return;
        }
      }

      // 2. Consume the invite token to bind to the client and set role
      const { error: rpcErr } = await sb.rpc('register_client_user', { p_token: token });
      if (rpcErr) throw rpcErr;

      // 3. Force-reload profile so getProfile() returns the freshly set client_id.
      await refreshProfile();

      showToast('Welcome to Inquire!', 'success');
      // The auth state change handler will redirect to /cabinet
    } catch (err) {
      console.error(err);
      errorEl.textContent = err?.message ?? 'Registration failed.';
      errorEl.style.display = 'block';
      btn.disabled = false;
      btnText.textContent = 'Create account';
    }
  });
}
