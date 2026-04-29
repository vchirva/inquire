// Shared client cabinet topbar.

import { getProfile, getInitials, signOut } from '../auth.js';
import { navigate } from '../router.js';
import { escapeHtml } from '../utils.js';

export function renderClientTopbar(clientName) {
  const profile = getProfile();
  const initials = getInitials(profile?.full_name, profile?.id);

  return `
    <header class="topbar">
      <button class="logo" data-cabinet-home style="border:none;background:none;cursor:pointer;">
        <div class="logo-mark">Σ</div>
        <span class="logo-text">Sigma Software</span>
        <span class="logo-sub">Inquire</span>
      </button>
      <div style="font-size:13px; font-weight:600; color: rgba(255,255,255,0.7);">
        ${escapeHtml(clientName ?? '')}
      </div>
      <div class="topbar-right">
        <button class="topbar-link" id="cabinetSignOut">Sign out</button>
        <div class="avatar dark" title="${escapeHtml(profile?.full_name ?? '')}">${initials}</div>
      </div>
    </header>
  `;
}

export function attachClientTopbarHandlers(scope) {
  scope.querySelector('[data-cabinet-home]')?.addEventListener('click', () => navigate('/cabinet'));
  scope.querySelector('#cabinetSignOut')?.addEventListener('click', () => signOut());
}
