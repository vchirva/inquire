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
