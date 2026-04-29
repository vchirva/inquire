import { sb } from '../supabase.js';
import { navigate } from '../router.js';
import { getSession } from '../auth.js';
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
        <button class="btn" id="newQuestionnaireBtn">
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

  root.querySelector('#newQuestionnaireBtn').addEventListener('click', async () => {
    const session = getSession();
    const { data, error } = await sb
      .from('questionnaires')
      .insert({
        title: 'Untitled questionnaire',
        status: 'draft',
        created_by: session.user.id
      })
      .select()
      .single();
    if (error) {
      showToast('Failed to create: ' + error.message, 'error');
      return;
    }
    navigate(`/admin/questionnaires/${data.id}`);
  });

  await loadDashboardData(root);
}

async function loadDashboardData(root) {
  // Fetch questionnaires + counts via direct queries (not the view) to avoid
  // any RLS-on-view edge cases, and so each query independently surfaces errors.
  const [responsesQ, linksQ, clientsQ, qsQ] = await Promise.all([
    sb.from('response_sessions').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
    sb.from('link_groups').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    sb.from('clients').select('id', { count: 'exact', head: true }),
    sb.from('questionnaires').select('id, title, status, created_at').order('created_at', { ascending: false }).limit(10)
  ]);

  if (qsQ.error) {
    console.error('Failed to load questionnaires:', qsQ.error);
    showToast('Failed to load questionnaires: ' + qsQ.error.message, 'error');
  }

  const questionnaires = qsQ.data || [];

  // Per-questionnaire counts (in parallel)
  const counts = await Promise.all(questionnaires.map(async q => {
    const [qcount, sub, prog] = await Promise.all([
      sb.from('questions').select('id', { count: 'exact', head: true }).eq('questionnaire_id', q.id),
      sb.from('response_sessions').select('id', { count: 'exact', head: true }).eq('questionnaire_id', q.id).eq('status', 'submitted'),
      sb.from('response_sessions').select('id', { count: 'exact', head: true }).eq('questionnaire_id', q.id).eq('status', 'in_progress')
    ]);
    return {
      ...q,
      question_count: qcount.count ?? 0,
      submitted_count: sub.count ?? 0,
      in_progress_count: prog.count ?? 0
    };
  }));

  setStat(root, '#statResponses', responsesQ.count ?? 0);
  setStat(root, '#statActiveLinks', linksQ.count ?? 0);
  setStat(root, '#statClients', clientsQ.count ?? 0);
  setStat(root, '#statQuestionnaires', counts.length);

  const total = counts.length;
  const live = counts.filter(q => q.status === 'live').length;
  root.querySelector('#heroSubtitle').textContent =
    total === 0
      ? 'No questionnaires yet — create your first one to get started.'
      : `${total} questionnaire${total === 1 ? '' : 's'} · ${live} live · ${responsesQ.count ?? 0} response${responsesQ.count === 1 ? '' : 's'} collected`;

  const list = root.querySelector('#qList');
  if (counts.length === 0) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-title">No questionnaires yet</div>
        <div class="empty-text">Create your first questionnaire to start collecting responses.</div>
      </div>
    `;
    return;
  }

  list.innerHTML = counts.map((q, i) => {
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

  // Wire click → open builder
  list.querySelectorAll('.q-item').forEach(btn => {
    btn.addEventListener('click', () => navigate(`/admin/questionnaires/${btn.dataset.id}`));
  });
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
