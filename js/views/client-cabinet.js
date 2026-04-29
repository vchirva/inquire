import { sb } from '../supabase.js';
import { getProfile, getInitials, signOut } from '../auth.js';
import { escapeHtml } from '../utils.js';

export async function renderClientCabinet(root) {
  const profile = getProfile();
  const initials = getInitials(profile?.full_name, profile?.id);

  // Look up the client's name
  let clientName = 'Your organization';
  if (profile?.client_id) {
    const { data } = await sb.from('clients').select('name').eq('id', profile.client_id).single();
    if (data?.name) clientName = data.name;
  }

  root.innerHTML = `
    <header class="topbar">
      <div class="logo">
        <div class="logo-mark">Σ</div>
        <span class="logo-text">Sigma Software</span>
        <span class="logo-sub">Inquire</span>
      </div>
      <div class="topbar-right">
        <button class="topbar-link" id="signOutBtn">Sign out</button>
        <div class="avatar dark">${initials}</div>
      </div>
    </header>

    <div class="container fade-in">
      <section class="hero">
        <div>
          <div class="breadcrumb">${escapeHtml(clientName)} <span class="red">/</span> Cabinet</div>
          <h1 class="page-title">Your <span class="red">insights</span>.</h1>
          <p class="page-subtitle">Dashboards for questionnaires completed by your team.</p>
        </div>
      </section>

      <div class="cabinet-message">
        <h2>Cabinet coming soon</h2>
        <p>Once questionnaires are assigned to your organization and your team has responded, dashboards with charts and breakdowns will appear here.</p>
      </div>
    </div>
  `;

  root.querySelector('#signOutBtn').addEventListener('click', async () => {
    await signOut();
  });
}
