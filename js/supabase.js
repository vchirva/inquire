// Supabase client + raw-fetch auth helpers.
// We bypass the Supabase JS client's built-in auth subsystem (getSession,
// signIn, etc.) because it has a deadlock issue on Safari that hangs forever
// on init even with empty localStorage. Instead we make raw fetch calls to
// GoTrue's HTTP API directly. The Supabase JS client is still used for
// PostgREST queries (sb.from(...).select(), sb.rpc(...)) which work fine.

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

export const SUPABASE_URL = config.supabaseUrl;
export const SUPABASE_ANON_KEY = config.supabaseAnonKey;

// Token storage key. We pick our own to avoid colliding with the Supabase JS
// client's storage (which it controls and may try to mutate).
const TOKEN_KEY = 'inquire-auth-token';

// One-time cleanup: previous versions of this app stored tokens under the
// Supabase JS client's default key. Migrate or clear so they don't interfere.
(function cleanupLegacyTokens() {
  try {
    const legacyKeys = Object.keys(localStorage).filter(k =>
      k.startsWith('sb-') && k.endsWith('-auth-token')
    );
    for (const k of legacyKeys) {
      // If we don't already have our own token, try to migrate from the legacy one.
      if (!localStorage.getItem(TOKEN_KEY)) {
        const legacy = localStorage.getItem(k);
        if (legacy) {
          try {
            const parsed = JSON.parse(legacy);
            // Legacy tokens have the same shape — just need access_token + refresh_token + user
            if (parsed?.access_token && parsed?.refresh_token) {
              localStorage.setItem(TOKEN_KEY, JSON.stringify({
                access_token: parsed.access_token,
                refresh_token: parsed.refresh_token,
                expires_at: parsed.expires_at,
                expires_in: parsed.expires_in,
                user: parsed.user
              }));
              console.info('[auth] Migrated legacy token to new storage key.');
            }
          } catch {}
        }
      }
      localStorage.removeItem(k);
    }
  } catch (e) {
    console.warn('Legacy token cleanup failed:', e);
  }
})();

export function getStoredToken() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  else localStorage.removeItem(TOKEN_KEY);
}

// ─── Raw GoTrue auth API ────────────────────────────────────────────────────

async function gotrue(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      ...(init.headers || {})
    }
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!res.ok) {
    const msg = body?.msg || body?.error_description || body?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

export async function authSignInWithPassword(email, password) {
  return gotrue('token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
}

export async function authSignUp(email, password, metadata = {}) {
  return gotrue('signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, data: metadata })
  });
}

export async function authRefresh(refreshToken) {
  return gotrue('token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken })
  });
}

export async function authGetUser(accessToken) {
  return gotrue('user', {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}

export async function authSignOut(accessToken) {
  // Best-effort revoke; ignore failures (the local token clear is what matters).
  try {
    await gotrue('logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` }
    });
  } catch (e) {
    console.warn('Sign-out revoke failed (ignored):', e);
  }
}

// ─── Supabase JS client (for PostgREST queries only) ────────────────────────

// Custom fetch wrapper that injects the current access token. The Supabase JS
// client uses this for every HTTP call. Since we manage the session ourselves,
// we just look up the current token at request time.
function authFetch(input, init = {}) {
  const stored = getStoredToken();
  const token = stored?.access_token || SUPABASE_ANON_KEY;
  const headers = new Headers(init.headers || {});
  // Override Authorization with whatever token we have (signed-in user or anon key).
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

export const sb = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'inquire-supabase-internal-do-not-use'
    },
    global: {
      fetch: authFetch
    }
  }
);

// Compatibility shim: callers can still call setClientAuth, but it's a no-op now
// because authFetch reads the token at request time.
export function setClientAuth(_accessToken) {
  // No-op. authFetch reads getStoredToken() lazily.
}
