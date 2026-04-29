// Client per-questionnaire dashboard — read-only.
// Same charts as admin results, but scoped to the client's own responses
// (RLS already filters this server-side, but we double-check).

import { sb } from '../supabase.js';
import { navigate } from '../router.js';
import { getProfile, refreshProfile } from '../auth.js';
import { escapeHtml } from '../utils.js';
import { renderClientTopbar, attachClientTopbarHandlers } from './_client-topbar.js';

const LOAD_TIMEOUT_MS = 20000;

function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out`)), ms))
  ]);
}

export async function renderClientQuestionnaireDashboard(root, params) {
  const profile = getProfile();
  const ctx = { id: params.id, profile };

  root.innerHTML = `
    ${renderClientTopbar('Loading…')}
    <div class="container fade-in" id="cqdContainer">
      <div style="padding: 64px 0; text-align: center; color: var(--ink-mute);">
        <span class="spinner spinner-dark"></span> Loading dashboard…
      </div>
    </div>
  `;

  attachClientTopbarHandlers(root);

  const container = root.querySelector('#cqdContainer');

  container.addEventListener('click', (e) => {
    if (e.target.closest('[data-back]')) {
      e.preventDefault();
      navigate('/cabinet');
    }
  });

  try {
    await loadAndPaint(ctx, root, container);
  } catch (err) {
    console.error('Cabinet dashboard load failed:', err);
    container.innerHTML = `
      <div class="empty">
        <div class="empty-title">Couldn't load dashboard</div>
        <div class="empty-text">${escapeHtml(err?.message ?? '')}</div>
        <button class="btn btn-outline" data-back>Back to cabinet</button>
      </div>
    `;
  }
}

async function loadAndPaint(ctx, root, container) {
  // Refresh profile if client_id is missing (handles stale in-memory state)
  if (!ctx.profile?.client_id) {
    const fresh = await refreshProfile();
    if (fresh) ctx.profile = fresh;
  }

  if (!ctx.profile?.client_id) {
    container.innerHTML = `
      <div class="empty">
        <div class="empty-title">No organization</div>
        <div class="empty-text">Your account isn't linked to a client organization.</div>
        <button class="btn btn-outline" data-back>Back to cabinet</button>
      </div>
    `;
    return;
  }

  const [clientRes, qRes, qsRes, ssRes] = await withTimeout(Promise.all([
    sb.from('clients').select('name').eq('id', ctx.profile.client_id).single(),
    sb.from('questionnaires').select('*').eq('id', ctx.id).single(),
    sb.from('questions').select('*').eq('questionnaire_id', ctx.id).order('order_index'),
    // Sessions for this questionnaire AND this client only
    sb.from('response_sessions').select('*')
      .eq('questionnaire_id', ctx.id)
      .eq('client_id', ctx.profile.client_id)
  ]), LOAD_TIMEOUT_MS, 'load dashboard');

  if (clientRes.error) throw clientRes.error;
  if (qRes.error || !qRes.data) throw new Error('Questionnaire not found or not accessible');
  if (qsRes.error) throw qsRes.error;
  if (ssRes.error) throw ssRes.error;

  ctx.clientName = clientRes.data?.name ?? 'Your organization';
  ctx.questionnaire = qRes.data;
  ctx.questions = qsRes.data || [];
  ctx.sessions = ssRes.data || [];

  // Update topbar client name
  const topbarRight = root.querySelector('.topbar > div:nth-child(2)');
  if (topbarRight) topbarRight.textContent = ctx.clientName;

  // Fetch responses for submitted sessions
  const submittedIds = ctx.sessions.filter(s => s.status === 'submitted').map(s => s.id);
  if (submittedIds.length > 0) {
    const { data: responses, error: rErr } = await sb
      .from('responses')
      .select('id, session_id, question_id, answer')
      .in('session_id', submittedIds);
    if (rErr) throw rErr;
    ctx.responses = responses || [];
  } else {
    ctx.responses = [];
  }

  paint(ctx, container);
}

function paint(ctx, container) {
  const q = ctx.questionnaire;
  const submitted = ctx.sessions.filter(s => s.status === 'submitted').length;
  const inProgress = ctx.sessions.filter(s => s.status === 'in_progress').length;
  const total = submitted + inProgress;
  const completionRate = total > 0 ? Math.round((submitted / total) * 100) : 0;

  container.innerHTML = `
    <button class="back-link" data-back>← Back to cabinet</button>

    <section class="hero">
      <div>
        <div class="breadcrumb">${escapeHtml(ctx.clientName)} <span class="red">/</span> ${escapeHtml(q.title)}</div>
        <h1 class="page-title">${escapeHtml(q.title)}</h1>
        <p class="page-subtitle">
          <span class="badge ${q.status}">${q.status === 'live' ? '<span class="dot"></span>' : ''}${q.status}</span>
          · ${ctx.questions.length} question${ctx.questions.length === 1 ? '' : 's'}
          · ${submitted} submitted response${submitted === 1 ? '' : 's'} from your team
        </p>
      </div>
    </section>

    <div class="stats">
      <div class="stat">
        <div class="stat-label">Submitted</div>
        <div class="stat-value">${submitted}</div>
        <div class="stat-delta muted">finalized responses</div>
      </div>
      <div class="stat">
        <div class="stat-label">In progress</div>
        <div class="stat-value">${inProgress}</div>
        <div class="stat-delta muted">active sessions</div>
      </div>
      <div class="stat">
        <div class="stat-label">Completion rate</div>
        <div class="stat-value">${completionRate}<span class="pct">%</span></div>
        <div class="stat-delta muted">submitted / started</div>
      </div>
      <div class="stat">
        <div class="stat-label">Questions</div>
        <div class="stat-value">${ctx.questions.length}</div>
        <div class="stat-delta muted">in this questionnaire</div>
      </div>
    </div>

    <section class="section">
      <div class="section-head">
        <div>
          <div class="section-eyebrow">Breakdown</div>
          <h2 class="section-title">Per-question results</h2>
        </div>
      </div>
      <div>${renderBreakdown(ctx)}</div>
    </section>
  `;
}

// ─── Breakdown rendering (mirrors admin results page) ───────────────────────

function renderBreakdown(ctx) {
  if (ctx.questions.length === 0) {
    return '<div class="empty"><div class="empty-text">No questions in this questionnaire.</div></div>';
  }

  const responsesByQ = new Map();
  for (const r of ctx.responses) {
    if (!responsesByQ.has(r.question_id)) responsesByQ.set(r.question_id, []);
    responsesByQ.get(r.question_id).push(r.answer);
  }

  return ctx.questions.map((q, i) => {
    const answers = responsesByQ.get(q.id) || [];
    return `
      <div class="panel" style="margin-bottom:16px;">
        <div style="display:flex; gap:12px; align-items:baseline; margin-bottom:16px;">
          <span class="q-num" style="font-size:13px; font-weight:600; color: var(--ink-mute); font-family: var(--font-mono);">${String(i + 1).padStart(2, '0')}</span>
          <div style="flex:1;">
            <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.1em; font-weight:700; color: var(--ink-mute);">${typeLabel(q.type)}${q.required ? ' · Required' : ''}</div>
            <div style="font-size:18px; font-weight:700; letter-spacing:-0.01em;">${escapeHtml(q.text || '(untitled)')}</div>
            <div style="font-size:12px; color: var(--ink-mute); margin-top:4px;">${answers.length} response${answers.length === 1 ? '' : 's'}</div>
          </div>
        </div>
        ${renderQuestionBreakdown(q, answers)}
      </div>
    `;
  }).join('');
}

function typeLabel(t) {
  return ({
    single_choice: 'Single choice',
    multi_choice: 'Multiple choice',
    text: 'Free text',
    rating: 'Rating',
    date: 'Date',
    ranking: 'Ranking'
  })[t] || t;
}

function renderQuestionBreakdown(q, answers) {
  if (answers.length === 0) {
    return '<div style="font-size:13px; color: var(--ink-mute); padding: 8px 0;">No responses yet.</div>';
  }
  if (q.type === 'single_choice' || q.type === 'multi_choice') return renderChoiceBreakdown(q, answers);
  if (q.type === 'rating') return renderRatingBreakdown(q, answers);
  if (q.type === 'date') return renderDateBreakdown(answers);
  if (q.type === 'ranking') return renderRankingBreakdown(q, answers);
  if (q.type === 'text') return renderTextBreakdown(answers);
  return '';
}

function renderChoiceBreakdown(q, answers) {
  const opts = Array.isArray(q.options) ? q.options : [];
  const tallies = new Map();
  for (const o of opts) tallies.set(o, 0);
  tallies.set('__OTHER__', 0);

  for (const a of answers) {
    const arr = Array.isArray(a) ? a : (a != null ? [a] : []);
    for (const v of arr) {
      const key = opts.includes(v) ? v : '__OTHER__';
      tallies.set(key, (tallies.get(key) ?? 0) + 1);
    }
  }

  const total = answers.length;
  const rows = opts.map(o => ({ label: o, count: tallies.get(o) ?? 0 }));
  if ((tallies.get('__OTHER__') ?? 0) > 0) rows.push({ label: 'Other', count: tallies.get('__OTHER__') });
  return renderBars(rows, total);
}

function renderRatingBreakdown(q, answers) {
  const opt = (q.options && typeof q.options === 'object' && !Array.isArray(q.options)) ? q.options : { min: 1, max: 5 };
  const min = Number(opt.min ?? 1);
  const max = Number(opt.max ?? 5);
  const tallies = new Map();
  for (let i = min; i <= max; i++) tallies.set(i, 0);

  let sum = 0, count = 0;
  for (const a of answers) {
    const n = Number(a);
    if (Number.isFinite(n)) {
      tallies.set(n, (tallies.get(n) ?? 0) + 1);
      sum += n;
      count++;
    }
  }
  const avg = count > 0 ? (sum / count).toFixed(2) : '—';
  const rows = [];
  for (let i = min; i <= max; i++) rows.push({ label: String(i), count: tallies.get(i) ?? 0 });

  return `
    <div style="font-size:13px; color: var(--ink-soft); margin-bottom:12px;">
      Average: <strong style="color: var(--ink); font-size: 16px;">${avg}</strong>
    </div>
    ${renderBars(rows, count)}
  `;
}

function renderRankingBreakdown(q, answers) {
  const opts = Array.isArray(q.options) ? q.options : [];
  const N = opts.length;
  const scores = new Map();
  for (const o of opts) scores.set(o, 0);

  for (const a of answers) {
    if (!Array.isArray(a)) continue;
    a.forEach((item, idx) => {
      if (scores.has(item)) scores.set(item, scores.get(item) + (N - idx));
    });
  }

  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const maxScore = sorted[0]?.[1] ?? 0;
  const rows = sorted.map(([label, score]) => ({ label, count: score }));

  return `
    <div style="font-size:13px; color: var(--ink-soft); margin-bottom:12px;">
      Ranked by aggregate Borda score (higher = preferred)
    </div>
    ${renderBars(rows, maxScore, { showRaw: true })}
  `;
}

function renderTextBreakdown(answers) {
  return `
    <div class="invite-list">
      ${answers.map(a => `
        <div style="padding: 12px 0; border-bottom: 1px solid var(--line-soft); font-size: 14px;">
          ${escapeHtml(String(a ?? '')) || '<em style="color: var(--ink-mute);">(empty)</em>'}
        </div>
      `).join('')}
    </div>
  `;
}

function renderDateBreakdown(answers) {
  const tallies = new Map();
  for (const a of answers) {
    const d = new Date(a);
    if (isNaN(d)) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    tallies.set(key, (tallies.get(key) ?? 0) + 1);
  }
  const rows = [...tallies.entries()].sort().map(([k, v]) => ({ label: k, count: v }));
  return renderBars(rows, answers.length);
}

function renderBars(rows, total, opts = {}) {
  const max = Math.max(...rows.map(r => r.count), 1);
  return `
    <div style="display: flex; flex-direction: column; gap: 8px;">
      ${rows.map(r => {
        const pct = total > 0 ? Math.round((r.count / total) * 100) : 0;
        const w = max > 0 ? Math.round((r.count / max) * 100) : 0;
        return `
          <div style="display:grid; grid-template-columns: 200px 1fr 80px; gap:12px; align-items:center;">
            <div style="font-size:13px; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}</div>
            <div style="height:24px; background: var(--bg-alt); position: relative;">
              <div style="position:absolute; inset:0 auto 0 0; width: ${w}%; background: var(--ink); transition: width 0.4s ease;"></div>
            </div>
            <div style="font-size:12px; font-family: var(--font-mono); color: var(--ink-soft); text-align:right;">
              ${r.count}${opts.showRaw ? '' : ` · ${pct}%`}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}
