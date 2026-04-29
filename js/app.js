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
import { renderRespondent } from './views/respondent.js';
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

// Public respondent route — no auth required. Anyone with a valid group_token
// in the URL can answer the questionnaire.
defineRoute({
  pattern: /^\/q\/(?<token>[A-Fa-f0-9-]+)\/?$/,
  render: renderRespondent
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

const AUTH_INIT_TIMEOUT_MS = 20000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
  ]);
}

async function boot() {
  // Public respondent route: skip auth entirely. Anonymous users hitting /q/<token>
  // don't need a Supabase session, and forcing them through initAuth would block on
  // free-tier cold-start.
  const path = (location.hash || '').slice(1) || '/';
  const isRespondentRoute = path.startsWith('/q/');

  document.getElementById('appLoading')?.remove();

  if (isRespondentRoute) {
    // Don't await initAuth — respondent flow doesn't need it.
    // Kick it off in the background so cached calls warm up if user later navigates.
    initAuth().catch(err => console.warn('Background initAuth failed:', err));
    startRouter();
    return;
  }

  // For all other routes, we need auth state before rendering (router uses it
  // for redirects). Show loading screen while we wait.
  const loading = document.createElement('div');
  loading.id = 'appLoading';
  loading.className = 'app-loading';
  loading.innerHTML = `
    <div class="logo-mark">Σ</div>
    <div class="app-loading-text">Loading…</div>
  `;
  document.body.appendChild(loading);

  try {
    await withTimeout(initAuth(), AUTH_INIT_TIMEOUT_MS, 'initAuth');
    loading.remove();
    startRouter();
  } catch (err) {
    loading.remove();
    throw err;
  }
}

boot().catch(err => {
  console.error('Boot failed:', err);
  document.body.innerHTML = `
    <div style="padding: 64px 32px; max-width: 600px; margin: 0 auto; font-family: 'Manrope', sans-serif;">
      <div style="width: 48px; height: 48px; background: #e4002b; display: flex; align-items: center; justify-content: center; color: white; font-weight: 800; font-size: 24px; margin-bottom: 24px;">Σ</div>
      <h1 style="font-weight: 800; letter-spacing: -0.02em; margin-bottom: 12px;">Couldn't start the app</h1>
      <p style="color: #4a4a4a; margin-bottom: 24px;">${err.message}</p>
      <button onclick="location.reload()" style="padding: 14px 24px; background: #0a0a0a; color: white; border: none; font-family: inherit; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; cursor: pointer;">Reload</button>
    </div>
  `;
});