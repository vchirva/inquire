// Client cabinet overview — read-only list of questionnaires assigned to the
// signed-in client's organization.

import { sb } from '../supabase.js';
import { navigate } from '../router.js';
import { getProfile, refreshProfile } from '../auth.js';
import { escapeHtml, showToast } from '../utils.js';
import { renderClientTopbar, attachClientTopbarHandlers } from './_client-topbar.js';

const LOAD_TIMEOUT_MS = 20000;

function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out`)), ms))
  ]);
}

export async function renderClientCabinet(root) {
  const profile = getProfile();
  const ctx = { profile };

  root.innerHTML = `
    ${renderClientTopbar('Loading…')}
    <div class="container fade-in" id="cabinetContainer">
      <div style="padding: 64px 0; text-align: center; color: var(--ink-mute);">
        <span class="spinner spinner-dark"></span> Loading workspace…
      </div>
    </div>
  `;

  attachClientTopbarHandlers(root);

  const container = root.querySelector('#cabinetContainer');

  // Delegated click handler for questionnaire rows
  container.addEventListener('click', (e) => {
    const row = e.target.closest('.q-item');
    if (row) {
      e.preventDefault();
      navigate(`/cabinet/q/${row.dataset.id}`);
    }
  });

  try {
    await loadAndPaint(ctx, root, container);
  } catch (err) {
    console.error('Cabinet load failed:', err);
    container.innerHTML = `
      <div class="empty">
        <div class="empty-title">Couldn't load workspace</div>
        <div class="empty-text">${escapeHtml(err?.message ?? '')}</div>
        <button class="btn btn-outline" onclick="location.reload()">Reload</button>
      </div>
    `;
  }
}

async function loadAndPaint(ctx, root, container) {
  // If profile lacks client_id, try a fresh load — handles the case where
  // registration finished but the in-memory profile is stale.
  if (!ctx.profile?.client_id) {
    const fresh = await refreshProfile();
    if (fresh) ctx.profile = fresh;
  }

  if (!ctx.profile?.client_id) {
    container.innerHTML = `
      <div class="empty">
        <div class="empty-title">No organization</div>
        <div class="empty-text">Your account isn't linked to a client organization. Ask your administrator for help.</div>
      </div>
    `;
    return;
  }

  const [clientRes, qsRes] = await withTimeout(Promise.all([
    sb.from('clients').select('name').eq('id', ctx.profile.client_id).single(),
    // Fetch questionnaires via the M:N table — RLS will scope to ones assigned to us
    sb.from('questionnaire_clients')
      .select('questionnaire_id, questionnaires!inner(id, title, description, status, created_at)')
      .eq('client_id', ctx.profile.client_id)
  ]), LOAD_TIMEOUT_MS, 'load cabinet');

  if (clientRes.error) throw clientRes.error;
  if (qsRes.error) throw qsRes.error;

  const clientName = clientRes.data?.name ?? 'Your organization';
  // Update the topbar with the real client name
  const topbarRight = root.querySelector('.topbar > div:nth-child(2)');
  if (topbarRight) topbarRight.textContent = clientName;

  const questionnaires = (qsRes.data || [])
    .map(r => r.questionnaires)
    .filter(Boolean)
    // Most recent first
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // For each questionnaire, fetch session counts (in parallel)
  const counts = await Promise.all(questionnaires.map(async q => {
    const [qcount, sub, prog] = await Promise.all([
      sb.from('questions').select('id', { count: 'exact', head: true }).eq('questionnaire_id', q.id),
      sb.from('response_sessions').select('id', { count: 'exact', head: true })
        .eq('questionnaire_id', q.id).eq('status', 'submitted').eq('client_id', ctx.profile.client_id),
      sb.from('response_sessions').select('id', { count: 'exact', head: true })
        .eq('questionnaire_id', q.id).eq('status', 'in_progress').eq('client_id', ctx.profile.client_id)
    ]);
    return {
      ...q,
      question_count: qcount.count ?? 0,
      submitted_count: sub.count ?? 0,
      in_progress_count: prog.count ?? 0
    };
  }));

  paint(ctx, container, clientName, counts);
}

function paint(ctx, container, clientName, questionnaires) {
  const totalSubmitted = questionnaires.reduce((s, q) => s + (q.submitted_count ?? 0), 0);
  const liveCount = questionnaires.filter(q => q.status === 'live').length;

  container.innerHTML = `
    <section class="hero">
      <div>
        <div class="breadcrumb">${escapeHtml(clientName)} <span class="red">/</span> Cabinet</div>
        <h1 class="page-title">Your <span class="red">insights</span>.</h1>
        <p class="page-subtitle">${
          questionnaires.length === 0
            ? 'Once your administrator assigns questionnaires to your organization, they\'ll appear here.'
            : `${questionnaires.length} questionnaire${questionnaires.length === 1 ? '' : 's'} assigned · ${liveCount} live · ${totalSubmitted} response${totalSubmitted === 1 ? '' : 's'} from your team`
        }</p>
      </div>
    </section>

    <div class="stats">
      <div class="stat">
        <div class="stat-label">Total responses</div>
        <div class="stat-value">${totalSubmitted}</div>
        <div class="stat-delta muted">submitted by your team</div>
      </div>
      <div class="stat">
        <div class="stat-label">Active questionnaires</div>
        <div class="stat-value">${liveCount}</div>
        <div class="stat-delta muted">accepting responses now</div>
      </div>
      <div class="stat">
        <div class="stat-label">Total questionnaires</div>
        <div class="stat-value">${questionnaires.length}</div>
        <div class="stat-delta muted">all states</div>
      </div>
      <div class="stat">
        <div class="stat-label">In progress</div>
        <div class="stat-value">${questionnaires.reduce((s, q) => s + (q.in_progress_count ?? 0), 0)}</div>
        <div class="stat-delta muted">team members answering</div>
      </div>
    </div>

    <section class="section">
      <div class="section-head">
        <div>
          <div class="section-eyebrow">Workspace</div>
          <h2 class="section-title">Questionnaires</h2>
        </div>
      </div>

      ${questionnaires.length === 0 ? `
        <div class="empty">
          <div class="empty-title">No questionnaires yet</div>
          <div class="empty-text">When your administrator assigns one to your organization, you'll see it here with the latest results.</div>
        </div>
      ` : `
        <div class="q-list">
          ${questionnaires.map((q, i) => {
            const total = (q.submitted_count ?? 0) + (q.in_progress_count ?? 0);
            const pct = total > 0 ? Math.round(((q.submitted_count ?? 0) / total) * 100) : 0;
            return `
              <button class="q-item" data-id="${q.id}">
                <div class="q-num">${String(i + 1).padStart(2, '0')}</div>
                <div>
                  <div class="q-name">${escapeHtml(q.title)}</div>
                  <div class="q-meta">${q.question_count ?? 0} question${q.question_count === 1 ? '' : 's'} · ${formatDate(q.created_at)}</div>
                </div>
                <span class="badge ${q.status}">${q.status === 'live' ? '<span class="dot"></span>' : ''}${q.status}</span>
                <div class="progress">
                  <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;"></div></div>
                  <span class="progress-text">${q.submitted_count ?? 0} submitted · ${q.in_progress_count ?? 0} in progress</span>
                </div>
                <div class="q-meta">${pct}%</div>
                <div class="icon-btn">→</div>
              </button>
            `;
          }).join('')}
        </div>
      `}
    </section>
  `;
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
