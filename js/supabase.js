// Supabase client singleton.
// Loaded via the supabase-js UMD bundle in index.html (window.supabase).

const config = window.INQUIRE_CONFIG;

if (!config?.supabaseUrl || !config?.supabaseAnonKey) {
  document.body.innerHTML = `
    <div style="padding: 64px; max-width: 600px; margin: 0 auto; font-family: sans-serif;">
      <h1 style="color: #e4002b;">Configuration missing</h1>
      <p>No <code>config.js</code> found, or it's missing <code>supabaseUrl</code> / <code>supabaseAnonKey</code>.</p>
      <p>Copy <code>config.example.js</code> → <code>config.js</code> and fill in your Supabase credentials.</p>
    </div>
  `;
  throw new Error('INQUIRE_CONFIG missing');
}

// Pre-validate the stored auth token before initializing the Supabase client.
// Safari has a known issue where the JS client's internal lock can deadlock on
// stale/expired tokens, hanging getSession() forever with no network activity.
// We sniff the token first and clear it if expired so the client sees a clean slate.
function preValidateAuthToken() {
  try {
    const projectRef = new URL(config.supabaseUrl).hostname.split('.')[0];
    const tokenKey = `sb-${projectRef}-auth-token`;
    const raw = localStorage.getItem(tokenKey);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const expiresAt = parsed?.expires_at;
    if (!expiresAt) return;
    // expires_at is a unix timestamp in seconds. Clear if expired or near-expiry.
    const expiresMs = expiresAt * 1000;
    const nowMs = Date.now();
    // If token expired more than 60s ago, clear it. Within 60s could be normal clock skew.
    // If it's expired by more than the refresh window, the auto-refresh path is the
    // one that hangs in Safari — better to start fresh.
    if (expiresMs < nowMs - 60000) {
      console.warn('[supabase] Clearing expired auth token; please sign in again.');
      localStorage.removeItem(tokenKey);
    }
  } catch (e) {
    console.warn('[supabase] Could not pre-validate token:', e);
  }
}

preValidateAuthToken();

export const sb = window.supabase.createClient(
  config.supabaseUrl,
  config.supabaseAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);
