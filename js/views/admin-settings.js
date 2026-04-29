// Admin settings placeholder.
// Future: LLM config for PDF reports (Slice 7), branding overrides, etc.

import { renderAdminTopbar, attachAdminTopbarHandlers } from './_topbar.js';

export async function renderAdminSettings(root) {
  root.innerHTML = `
    ${renderAdminTopbar('/admin/settings')}
    <div class="container fade-in">
      <section class="hero">
        <div>
          <div class="breadcrumb">Admin <span class="red">/</span> Settings</div>
          <h1 class="page-title">Settings</h1>
          <p class="page-subtitle">Configure platform-wide preferences for your administrator workspace.</p>
        </div>
      </section>

      <section class="section">
        <div class="section-head">
          <div>
            <div class="section-eyebrow">Coming soon</div>
            <h2 class="section-title">LLM configuration</h2>
          </div>
        </div>
        <div class="empty">
          <div class="empty-title">Not available yet</div>
          <div class="empty-text">
            PDF reports with AI enrichment will arrive in a later release.
            You'll be able to connect Claude, OpenAI, Mistral, Grok, or your own Ollama instance to automatically draft narrative summaries of questionnaire results.
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section-head">
          <div>
            <div class="section-eyebrow">About</div>
            <h2 class="section-title">Inquire</h2>
          </div>
        </div>
        <div class="panel">
          <div class="info-list">
            <div class="info-label">Version</div>
            <div class="info-value">v0.1 · MVP</div>

            <div class="info-label">Built by</div>
            <div class="info-value">Sigma Software</div>

            <div class="info-label">Source</div>
            <div class="info-value"><a href="https://github.com/vchirva/inquire" target="_blank" rel="noopener noreferrer" style="color:var(--ink); text-decoration:underline;">github.com/vchirva/inquire</a></div>
          </div>
        </div>
      </section>
    </div>
  `;
  attachAdminTopbarHandlers(root);
}
