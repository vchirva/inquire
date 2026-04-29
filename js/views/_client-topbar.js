// Shared client cabinet topbar.

import { getProfile, getInitials, signOut } from '../auth.js';
import { navigate } from '../router.js';
import { escapeHtml } from '../utils.js';
import { brandLogo } from './_brand.js';

export function renderClientTopbar() {
  const profile = getProfile();
  const initials = getInitials(profile?.full_name, profile?.id);

  return `
    <header class="topbar">
      <button class="logo" data-cabinet-home style="border:none;background:none;cursor:pointer;">
        ${brandLogo()}
      </button>
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
