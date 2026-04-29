// App entry point.
// Initializes auth, registers routes, starts the router.

import { initAuth } from './auth.js';
import { defineRoute, startRouter } from './router.js';
import { renderLogin } from './views/login.js';
import { renderAdminDashboard } from './views/admin-dashboard.js';
import { renderClientsList } from './views/clients-list.js';
import { renderClientDetail } from './views/client-detail.js';
import { renderClientCabinet } from './views/client-cabinet.js';
import { renderClientQuestionnaireDashboard } from './views/client-questionnaire.js';
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

defineRoute({
  pattern: /^\/cabinet\/q\/(?<id>[a-f0-9-]+)$/,
  render: renderClientQuestionnaireDashboard,
  requireAuth: true,
  requireRole: 'client'
});

// ---- Boot ----

// Supabase free tier has a cold start of 15-30s when the project has been idle.
// 45s gives generous headroom to avoid false timeouts after long pauses.
const AUTH_INIT_TIMEOUT_MS = 45000;
// After this many ms, swap the loading text to acknowledge the wait.
const SLOW_BOOT_HINT_MS = 5000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
  ]);
}

async function boot() {
  const path = (location.hash || '').slice(1) || '/';
  const isRespondentRoute = path.startsWith('/q/');

  document.getElementById('appLoading')?.remove();

  if (isRespondentRoute) {
    // Public respondent flow doesn't need auth. Kick initAuth off in the background
    // for warm-up if they later navigate to a private route.
    initAuth().catch(err => console.warn('Background initAuth failed:', err));
    startRouter();
    return;
  }

  // For private routes we need auth state before rendering.
  const loading = document.createElement('div');
  loading.id = 'appLoading';
  loading.className = 'app-loading';
  loading.innerHTML = `
    <div class="logo-mark">Σ</div>
    <div class="app-loading-text" id="appLoadingText">Loading…</div>
    <div class="app-loading-hint" id="appLoadingHint" style="display:none;"></div>
  `;
  document.body.appendChild(loading);

  // After ~5s, acknowledge the cold start so the user knows we're not frozen.
  const slowHintTimer = setTimeout(() => {
    const hint = document.getElementById('appLoadingHint');
    const text = document.getElementById('appLoadingText');
    if (text) text.textContent = 'Waking up the server…';
    if (hint) {
      hint.style.display = 'block';
      hint.textContent = 'This can take up to a minute after a period of inactivity.';
    }
  }, SLOW_BOOT_HINT_MS);

  try {
    await withTimeout(initAuth(), AUTH_INIT_TIMEOUT_MS, 'initAuth');
    clearTimeout(slowHintTimer);
    loading.remove();
    startRouter();
  } catch (err) {
    clearTimeout(slowHintTimer);
    loading.remove();
    throw err;
  }
}

boot().catch(err => {
  console.error('Boot failed:', err);
  const isTimeout = err?.message?.includes('timed out');
  document.body.innerHTML = `
    <div style="padding: 64px 32px; max-width: 600px; margin: 0 auto; font-family: 'Manrope', sans-serif;">
      <div style="width: 48px; height: 48px; background: #e4002b; display: flex; align-items: center; justify-content: center; color: white; font-weight: 800; font-size: 24px; margin-bottom: 24px;">Σ</div>
      <h1 style="font-weight: 800; letter-spacing: -0.02em; margin-bottom: 12px;">Couldn't connect</h1>
      <p style="color: #4a4a4a; margin-bottom: 12px; line-height: 1.5;">
        ${isTimeout
          ? 'The server is taking too long to respond. This usually means it\'s waking up from a long idle period. Try reloading — it should be fast the second time.'
          : (err.message ?? 'Unknown error')
        }
      </p>
      <p style="color: #8a8a8a; font-size: 13px; margin-bottom: 24px;">If this keeps happening, the database may be paused. Contact your administrator.</p>
      <button onclick="location.reload()" style="padding: 14px 24px; background: #0a0a0a; color: white; border: none; font-family: inherit; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; cursor: pointer;">Reload</button>
    </div>
  `;
});
