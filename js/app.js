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
import { renderQuestionnaireResults } from './views/questionnaire-results.js';
import { renderAdminTopbar, attachAdminTopbarHandlers } from './views/_topbar.js';

// ---- Public routes ----

defineRoute({ pattern: '/login', render: renderLogin });

defineRoute({
  pattern: /^\/register\/(?<token>[A-Fa-f0-9-]+)\/?$/,
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
  pattern: /^\/admin\/questionnaires\/(?<id>[a-f0-9-]+)\/results$/,
  render: renderQuestionnaireResults,
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

const BOOT_TIMEOUT_MS = 8000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
  ]);
}

async function boot() {
  await withTimeout(initAuth(), BOOT_TIMEOUT_MS, 'initAuth');
  document.getElementById('appLoading')?.remove();
  startRouter();
}

boot().catch(err => {
  console.error('Boot failed:', err);
  const loading = document.getElementById('appLoading');
  if (loading) loading.remove();
  document.body.innerHTML = `
    <div style="padding: 64px 32px; max-width: 600px; margin: 0 auto; font-family: 'Manrope', sans-serif;">
      <div style="width: 48px; height: 48px; background: #e4002b; display: flex; align-items: center; justify-content: center; color: white; font-weight: 800; font-size: 24px; margin-bottom: 24px;">Σ</div>
      <h1 style="font-weight: 800; letter-spacing: -0.02em; margin-bottom: 12px;">Couldn't start the app</h1>
      <p style="color: #4a4a4a; margin-bottom: 24px;">${err.message}</p>
      <button onclick="location.reload()" style="padding: 14px 24px; background: #0a0a0a; color: white; border: none; font-family: inherit; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; cursor: pointer;">Reload</button>
    </div>
  `;
});
