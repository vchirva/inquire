import { sb } from '../supabase.js';
import { navigate } from '../router.js';
import { escapeHtml, showToast } from '../utils.js';
import { renderAdminTopbar, attachAdminTopbarHandlers } from './_topbar.js';

export async function renderAdminDashboard(root) {
  root.innerHTML = `
    ${renderAdminTopbar('/admin')}

    <div class="container fade-in">
      <section class="hero">
        <div>
          <div class="breadcrumb">Workspace <span class="red">/</span> Overview</div>
          <h1 class="page-title">Turn questions into <span class="red">decisions</span>.</h1>
          <p class="page-subtitle" id="heroSubtitle">Loading workspace…</p>
        </div>
        <button class="btn" data-route="/admin/questionnaires">
          New questionnaire <span class="arrow">→</span>
        </button>
      </section>

      <div class="stats">
        <div class="stat">
          <div class="stat-label">Total responses</div>
          <div class="stat-value" id="statResponses">—</div>
          <div class="stat-delta muted">all-time submitted</div>
        </div>
        <div class="stat">
          <div class="stat-label">Active links</div>
          <div class="stat-value" id="statActiveLinks">—</div>
          <div class="stat-delta muted">open link groups</div>
        </div>
        <div class="stat">
          <div class="stat-label">Clients</div>
          <div class="stat-value" id="statClients">—</div>
          <div class="stat-delta muted">registered organizations</div>
        </div>
        <div class="stat">
          <div class="stat-label">Questionnaires</div>
          <div class="stat-value" id="statQuestionnaires">—</div>
          <div class="stat-delta muted">across all states</div>
        </div>
      </div>

      <section class="section">
        <div class="section-head">
          <div>
            <div class="section-eyebrow">Active workflows</div>
            <h2 class="section-title">Your questionnaires</h2>
          </div>
          <button class="section-link" data-route="/admin/questionnaires">View all <span>→</span></button>
        </div>

        <div class="q-list" id="qList">
          <div style="padding: 64px 0; text-align: center; color: var(--ink-mute);">
            <span class="spinner spinner-dark"></span> Loading questionnaires…
          </div>
        </div>
      </section>
    </div>
  `;

  attachAdminTopbarHandlers(root);
  root.querySelectorAll('[data-route]').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.route));
  });

  await loadDashboardData(root);
}

async function loadDashboardData(root) {
  const [responsesQ, linksQ, clientsQ, qsumQ] = await Promise.all([
    sb.from('response_sessions').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
    sb.from('link_groups').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    sb.from('clients').select('id', { count: 'exact', head: true }),
    sb.from('questionnaire_summary').select('*').order('created_at', { ascending: false }).limit(10)
  ]);

  setStat(root, '#statResponses', responsesQ.count ?? 0);
  setStat(root, '#statActiveLinks', linksQ.count ?? 0);
  setStat(root, '#statClients', clientsQ.count ?? 0);
  setStat(root, '#statQuestionnaires', qsumQ.data?.length ?? 0);

  const total = qsumQ.data?.length ?? 0;
  const live = qsumQ.data?.filter(q => q.status === 'live').length ?? 0;
  root.querySelector('#heroSubtitle').textContent =
    total === 0
      ? 'No questionnaires yet — create your first one to get started.'
      : `${total} questionnaire${total === 1 ? '' : 's'} · ${live} live · ${responsesQ.count ?? 0} response${responsesQ.count === 1 ? '' : 's'} collected`;

  const list = root.querySelector('#qList');
  if (!qsumQ.data || qsumQ.data.length === 0) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-title">No questionnaires yet</div>
        <div class="empty-text">Create your first questionnaire to start collecting responses.</div>
      </div>
    `;
    return;
  }

  list.innerHTML = qsumQ.data.map((q, i) => {
    const total = (q.submitted_count ?? 0) + (q.in_progress_count ?? 0);
    const pct = total > 0 ? Math.round(((q.submitted_count ?? 0) / total) * 100) : 0;
    return `
      <button class="q-item" data-id="${q.id}">
        <div class="q-num">${String(i + 1).padStart(2, '0')}</div>
        <div>
          <div class="q-name">${escapeHtml(q.title)}</div>
          <div class="q-meta">${q.question_count ?? 0} question${q.question_count === 1 ? '' : 's'} · created ${formatDate(q.created_at)}</div>
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
  }).join('');
}

function setStat(root, selector, value) {
  const el = root.querySelector(selector);
  if (el) el.textContent = value;
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) === 1 ? '' : 's'} ago`;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
