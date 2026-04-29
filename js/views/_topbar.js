// Shared admin topbar.

import { getProfile, getInitials, signOut } from '../auth.js';
import { navigate } from '../router.js';
import { escapeHtml } from '../utils.js';

export function renderAdminTopbar(activePath = '') {
  const profile = getProfile();
  const initials = getInitials(profile?.full_name, profile?.id);

  const links = [
    { path: '/admin', label: 'Overview' },
    { path: '/admin/clients', label: 'Clients' },
    { path: '/admin/questionnaires', label: 'Questionnaires' },
    { path: '/admin/settings', label: 'Settings' }
  ];

  // Match the most specific (longest) prefix
  const active = links
    .filter(l => activePath === l.path || activePath.startsWith(l.path + '/'))
    .sort((a, b) => b.path.length - a.path.length)[0];

  const html = `
    <header class="topbar">
      <button class="logo" data-route="/admin" style="border:none;background:none;cursor:pointer;">
        <div class="logo-mark">Σ</div>
        <span class="logo-text">Sigma Software</span>
        <span class="logo-sub">Inquire</span>
      </button>
      <nav class="topbar-nav">
        ${links.map(l => `
          <button class="topbar-link${active?.path === l.path ? ' active' : ''}" data-route="${l.path}">${l.label}</button>
        `).join('')}
      </nav>
      <div class="topbar-right">
        <button class="topbar-link" id="topbarSignOut">Sign out</button>
        <div class="avatar" title="${escapeHtml(profile?.full_name ?? '')}">${initials}</div>
      </div>
    </header>
  `;

  return html;
}

export function attachAdminTopbarHandlers(scope) {
  scope.querySelectorAll('[data-route]').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.route));
  });
  const signOutBtn = scope.querySelector('#topbarSignOut');
  if (signOutBtn) signOutBtn.addEventListener('click', () => signOut());
}
