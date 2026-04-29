// App entry point.
// Initializes auth, registers routes, starts the router.

import { initAuth } from './auth.js';
import { defineRoute, startRouter } from './router.js';
import { renderLogin } from './views/login.js';
import { renderAdminDashboard } from './views/admin-dashboard.js';
import { renderClientsList } from './views/clients-list.js';
import { renderClientDetail } from './views/client-detail.js';
import { renderClientCabinet } from './views/client-cabinet.js';
import { renderRegister } from './views/register.js';
import { renderQuestionnairesList } from './views/questionnaires-list.js';
import { renderQuestionnaireBuilder } from './views/questionnaire-builder.js';
import { renderAdminTopbar, attachAdminTopbarHandlers } from './views/_topbar.js';

// ---- Public routes ----

defineRoute({ pattern: '/login', render: renderLogin });

defineRoute({
  pattern: /^\/register\/(?<token>[a-f0-9-]+)$/,
  render: renderRegister
});

// ---- Admin routes ----

defineRoute({
  pattern: '/admin',
  render: renderAdminDashboard,
  requireAuth: true,
  requireRole: 'admin'
});

defineRoute({
  pattern: '/admin/clients',
  render: renderClientsList,
  requireAuth: true,
  requireRole: 'admin'
});

defineRoute({
  pattern: /^\/admin\/clients\/(?<id>[a-f0-9-]+)$/,
  render: renderClientDetail,
  requireAuth: true,
  requireRole: 'admin'
});

defineRoute({
  pattern: '/admin/questionnaires',
  render: renderQuestionnairesList,
  requireAuth: true,
  requireRole: 'admin'
});

defineRoute({
  pattern: /^\/admin\/questionnaires\/(?<id>[a-f0-9-]+)$/,
  render: renderQuestionnaireBuilder,
  requireAuth: true,
  requireRole: 'admin'
});

defineRoute({
  pattern: '/admin/settings',
  render: (root) => {
    root.innerHTML = `
      ${renderAdminTopbar('/admin/settings')}
      <div class="container">
        <div class="empty">
          <div class="empty-title">Settings screen coming later</div>
          <div class="empty-text">LLM provider config (Claude / OpenAI / Mistral / Grok / Ollama) goes here.</div>
          <button class="btn btn-outline" onclick="location.hash='#/admin'">Back to dashboard</button>
        </div>
      </div>
    `;
    attachAdminTopbarHandlers(root);
  },
  requireAuth: true,
  requireRole: 'admin'
});

// ---- Client routes ----

defineRoute({
  pattern: '/cabinet',
  render: renderClientCabinet,
  requireAuth: true,
  requireRole: 'client'
});

// ---- Boot ----

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
