// App entry point.
// Initializes auth, registers routes, starts the router.

import { initAuth } from './auth.js';
import { defineRoute, startRouter } from './router.js';
import { renderLogin } from './views/login.js';
import { renderAdminDashboard } from './views/admin-dashboard.js';
import { renderClientCabinet } from './views/client-cabinet.js';
import { renderRegister } from './views/register.js';

// Routes
defineRoute({ pattern: '/login', render: renderLogin });

defineRoute({
  pattern: /^\/register\/(?<token>[a-f0-9-]+)$/,
  render: renderRegister
});

defineRoute({
  pattern: '/admin',
  render: renderAdminDashboard,
  requireAuth: true,
  requireRole: 'admin'
});

defineRoute({
  pattern: '/admin/clients',
  render: (root) => {
    root.innerHTML = `
      <header class="topbar">
        <div class="logo"><div class="logo-mark">Σ</div><span class="logo-text">Sigma Software</span><span class="logo-sub">Inquire</span></div>
      </header>
      <div class="container">
        <div class="empty">
          <div class="empty-title">Clients screen coming next</div>
          <div class="empty-text">This is where you'll create clients and generate registration links.</div>
          <button class="btn btn-outline" onclick="location.hash='#/admin'">Back to dashboard</button>
        </div>
      </div>
    `;
  },
  requireAuth: true,
  requireRole: 'admin'
});

defineRoute({
  pattern: '/admin/questionnaires',
  render: (root) => {
    root.innerHTML = `
      <header class="topbar">
        <div class="logo"><div class="logo-mark">Σ</div><span class="logo-text">Sigma Software</span><span class="logo-sub">Inquire</span></div>
      </header>
      <div class="container">
        <div class="empty">
          <div class="empty-title">Questionnaires screen coming next</div>
          <div class="empty-text">This is where you'll build, clone, and publish questionnaires.</div>
          <button class="btn btn-outline" onclick="location.hash='#/admin'">Back to dashboard</button>
        </div>
      </div>
    `;
  },
  requireAuth: true,
  requireRole: 'admin'
});

defineRoute({
  pattern: '/admin/settings',
  render: (root) => {
    root.innerHTML = `
      <header class="topbar">
        <div class="logo"><div class="logo-mark">Σ</div><span class="logo-text">Sigma Software</span><span class="logo-sub">Inquire</span></div>
      </header>
      <div class="container">
        <div class="empty">
          <div class="empty-title">Settings screen coming later</div>
          <div class="empty-text">LLM provider config (Claude / OpenAI / Mistral / Grok / Ollama) goes here.</div>
          <button class="btn btn-outline" onclick="location.hash='#/admin'">Back to dashboard</button>
        </div>
      </div>
    `;
  },
  requireAuth: true,
  requireRole: 'admin'
});

defineRoute({
  pattern: '/cabinet',
  render: renderClientCabinet,
  requireAuth: true,
  requireRole: 'client'
});

// Boot
async function boot() {
  await initAuth();
  document.getElementById('appLoading')?.remove();
  startRouter();
}

boot().catch(err => {
  console.error('Boot failed:', err);
  document.body.innerHTML = `
    <div style="padding: 64px; max-width: 600px; margin: 0 auto; font-family: sans-serif;">
      <h1 style="color: #e4002b;">Something went wrong</h1>
      <p>${err.message}</p>
    </div>
  `;
});
