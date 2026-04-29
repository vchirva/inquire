// Results dashboard for a single questionnaire.
// Uses event delegation for resilience across re-renders.

import { sb } from '../supabase.js';
import { navigate } from '../router.js';
import { escapeHtml, showToast } from '../utils.js';
import { renderAdminTopbar, attachAdminTopbarHandlers } from './_topbar.js';

const LOAD_TIMEOUT_MS = 8000;

function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out`)), ms))
  ]);
}

export async function renderQuestionnaireResults(root, params) {
  // Per-render state — no module-level persistence
  const ctx = { id: params.id };

  root.innerHTML = `
    ${renderAdminTopbar('/admin/questionnaires')}
    <div class="container fade-in" id="resultsContainer">
      <div style="padding: 64px 0; text-align: center; color: var(--ink-mute);">
        <span class="spinner spinner-dark"></span> Loading results…
      </div>
    </div>
  `;
  attachAdminTopbarHandlers(root);

  const container = root.querySelector('#resultsContainer');

  // Single delegated click handler for the whole container.
  // Survives re-renders and avoids per-element handler accumulation.
  container.addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) {
      e.preventDefault();
      const text = copyBtn.getAttribute('data-copy');
      try {
        await navigator.clipboard.writeText(text);
        const original = copyBtn.textContent;
        copyBtn.textContent = '✓ Copied';
        setTimeout(() => { copyBtn.textContent = original; }, 1400);
      } catch {
        // Safari/HTTP fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch {}
        ta.remove();
        const original = copyBtn.textContent;
        copyBtn.textContent = '✓ Copied';
        setTimeout(() => { copyBtn.textContent = original; }, 1400);
      }
      return;
    }

    const toggleBtn = e.target.closest('[data-toggle]');
    if (toggleBtn) {
      e.preventDefault();
      const id = toggleBtn.getAttribute('data-toggle');
      const current = toggleBtn.getAttribute('data-current');
      const fn = current === 'open' ? 'close_link_group' : 'reopen_link_group';
      toggleBtn.disabled = true;
      try {
        const { error } = await withTimeout(
          sb.rpc(fn, { p_group_id: id }),
          LOAD_TIMEOUT_MS,
          fn
        );
        if (error) { showToast('Failed: ' + error.message, 'error'); return; }
        showToast(current === 'open' ? 'Link closed' : 'Link reopened', 'success');
        await loadAndPaint(ctx, container);
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        // Button may have been re-rendered already; this is a no-op then
        toggleBtn.disabled = false;
      }
      return;
    }

    const backBtn = e.target.closest('#backBtn, #editBtn');
    if (backBtn) {
      e.preventDefault();
      navigate(`/admin/questionnaires/${ctx.id}`);
      return;
    }
  });

  try {
    await loadAndPaint(ctx, container);
  } catch (err) {
    console.error('Results load failed:', err);
    container.innerHTML = `
      <div class="empty">
        <div class="empty-title">Couldn't load results</div>
        <div class="empty-text">${escapeHtml(err?.message ?? '')}</div>
        <button class="btn btn-outline" onclick="location.hash='#/admin/questionnaires'">Back to list</button>
      </div>
    `;
  }
}

async function loadAndPaint(ctx, container) {
  await withTimeout(loadData(ctx), LOAD_TIMEOUT_MS, 'load results');
  paint(ctx, container);
}

async function loadData(ctx) {
  const id = ctx.id;
  const [qRes, qsRes, lgRes, ssRes, cRes] = await Promise.all([
    sb.from('questionnaires').select('*').eq('id', id).single(),
    sb.from('questions').select('*').eq('questionnaire_id', id).order('order_index'),
    sb.from('link_groups').select('*, clients(name)').eq('questionnaire_id', id).order('created_at'),
    sb.from('response_sessions').select('*').eq('questionnaire_id', id),
    sb.from('clients').select('id, name')
  ]);

  if (qRes.error) throw qRes.error;
  if (!qRes.data) throw new Error('Questionnaire not found');
  if (qsRes.error) throw qsRes.error;
  if (lgRes.error) throw lgRes.error;
  if (ssRes.error) throw ssRes.error;

  ctx.questionnaire = qRes.data;
  ctx.questions = qsRes.data || [];
  ctx.linkGroups = lgRes.data || [];
  ctx.sessions = ssRes.data || [];
  ctx.clientsById = Object.fromEntries((cRes.data || []).map(c => [c.id, c.name]));

  // Responses for submitted sessions only
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
}

function paint(ctx, container) {
  const q = ctx.questionnaire;
  const submitted = ctx.sessions.filter(s => s.status === 'submitted').length;
  const inProgress = ctx.sessions.filter(s => s.status === 'in_progress').length;
  const total = submitted + inProgress;
  const completionRate = total > 0 ? Math.round((submitted / total) * 100) : 0;
  const openLinks = ctx.linkGroups.filter(g => g.status === 'open').length;

  container.innerHTML = `
    <button class="back-link" id="backBtn">← Back to questionnaire</button>

    <section class="hero">
      <div>
        <div class="breadcrumb">Questionnaires <span class="red">/</span> ${escapeHtml(q.title)} <span class="red">/</span> Results</div>
        <h1 class="page-title">${escapeHtml(q.title)}</h1>
        <p class="page-subtitle">
          <span class="badge ${q.status}">${q.status === 'live' ? '<span class="dot"></span>' : ''}${q.status}</span>
          · ${ctx.questions.length} question${ctx.questions.length === 1 ? '' : 's'}
          · ${submitted} submitted response${submitted === 1 ? '' : 's'}
        </p>
      </div>
      <button class="btn btn-outline" id="editBtn">Open builder <span class="arrow">→</span></button>
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
        <div class="stat-label">Open links</div>
        <div class="stat-value">${openLinks}</div>
        <div class="stat-delta muted">accepting responses</div>
      </div>
    </div>

    <section class="section">
      <div class="section-head">
        <div>
          <div class="section-eyebrow">Distribution</div>
          <h2 class="section-title">Share links</h2>
        </div>
      </div>
      <div>${renderLinkGroups(ctx)}</div>
    </section>

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

function renderLinkGroups(ctx) {
  if (ctx.linkGroups.length === 0) {
    return `
      <div class="empty">
        <div class="empty-title">No link groups yet</div>
        <div class="empty-text">${ctx.questionnaire.status === 'live' ? 'Strange — this should have one per assigned client.' : 'Publish the questionnaire to generate share links.'}</div>
      </div>
    `;
  }

  return ctx.linkGroups.map(g => {
    const clientName = g.clients?.name ?? ctx.clientsById[g.client_id] ?? 'Unknown client';
    const sessions = ctx.sessions.filter(s => s.link_group_id === g.id);
    const subCount = sessions.filter(s => s.status === 'submitted').length;
    const url = buildGroupUrl(g.group_token);
    const isOpen = g.status === 'open';

    return `
      <div class="invite-output" style="margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div>
            <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.1em; font-weight:700; color: var(--ink-mute);">For client</div>
            <div style="font-size:18px; font-weight:700; margin-top:2px;">${escapeHtml(clientName)}</div>
          </div>
          <span class="invite-status-badge" style="background: ${isOpen ? 'var(--green)' : 'var(--ink)'}; color: white; border: none;">${isOpen ? 'Open' : 'Closed'}</span>
        </div>
        <div class="invite-url">${escapeHtml(url)}</div>
        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap: wrap;">
          <div class="invite-meta" style="margin-bottom:0;">
            ${sessions.length} session${sessions.length === 1 ? '' : 's'}
            · ${subCount} submitted
          </div>
          <div style="display:flex; gap:8px;">
            <button type="button" class="btn btn-outline btn-sm" data-copy="${escapeHtml(url)}">Copy link</button>
            <button type="button" class="btn btn-outline btn-sm" data-toggle="${g.id}" data-current="${g.status}">${isOpen ? 'Close link' : 'Reopen link'}</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function buildGroupUrl(token) {
  const base = location.origin + location.pathname;
  return `${base}#/q/${token}`;
}

// ─── Breakdown rendering ────────────────────────────────────────────────────

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
