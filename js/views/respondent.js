// Respondent flow.
// State machine: claim_session → answer questions one at a time → review → submit.
// Anonymous (no auth required). Cookie holds session_token for resume.

import { sb } from '../supabase.js';
import { escapeHtml } from '../utils.js';
import { brandLogo } from './_brand.js';

const COOKIE_NAME = 'inquire_session';
const COOKIE_DAYS = 30;
const LOAD_TIMEOUT_MS = 20000;

function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out`)), ms))
  ]);
}

// ─── Cookie helpers (scoped per group_token) ────────────────────────────────

function cookieKey(groupToken) {
  return `${COOKIE_NAME}_${groupToken}`;
}

function getCookie(name) {
  const m = document.cookie.match(new RegExp('(^|; )' + name.replace(/[^a-zA-Z0-9_]/g, '\\$&') + '=([^;]*)'));
  return m ? decodeURIComponent(m[2]) : null;
}

function setCookie(name, value) {
  const d = new Date();
  d.setTime(d.getTime() + COOKIE_DAYS * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${d.toUTCString()}; path=/; SameSite=Lax`;
}

// ─── Entry ──────────────────────────────────────────────────────────────────

export async function renderRespondent(root, params) {
  const groupToken = params.token;
  const ctx = {
    groupToken,
    sessionToken: null,
    questionnaire: null,
    questions: [],
    answers: new Map(),  // question_id -> answer
    currentIndex: 0,     // index into visible questions
    submitted: false
  };

  root.innerHTML = `
    <div class="respondent-shell" id="respondentShell">
      <header class="respondent-topbar">
        <div class="logo">
          ${brandLogo()}
        </div>
        <div style="font-size: 12px; color: rgba(255,255,255,0.6); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600;">
          Anonymous response
        </div>
      </header>
      <main class="respondent-main" id="respondentMain">
        <div style="text-align: center; padding: 64px 0; color: var(--ink-mute);">
          <span class="spinner spinner-dark"></span> Loading…
        </div>
      </main>
    </div>
  `;

  const main = root.querySelector('#respondentMain');
  const shell = root.querySelector('#respondentShell');

  // Single delegated click handler — survives re-renders
  shell.addEventListener('click', async (e) => {
    if (e.target.closest('[data-back]')) {
      e.preventDefault();
      goBack(ctx, shell);
      return;
    }
    if (e.target.closest('[data-next]')) {
      e.preventDefault();
      await goNext(ctx, shell);
      return;
    }
    if (e.target.closest('[data-submit]')) {
      e.preventDefault();
      await submit(ctx, shell);
      return;
    }
    const editBtn = e.target.closest('[data-edit]');
    if (editBtn) {
      e.preventDefault();
      const targetIdx = Number(editBtn.getAttribute('data-edit'));
      ctx.currentIndex = targetIdx;
      paint(ctx, shell);
      return;
    }
    const rankBtn = e.target.closest('[data-rank]');
    if (rankBtn) {
      e.preventDefault();
      const dir = rankBtn.getAttribute('data-rank');  // 'up' or 'down'
      const i = Number(rankBtn.getAttribute('data-i'));
      handleRankMove(ctx, i, dir === 'up' ? -1 : 1);
      paint(ctx, shell);
      return;
    }
    const ratingBtn = e.target.closest('[data-rating-pick]');
    if (ratingBtn) {
      e.preventDefault();
      const q = currentQuestion(ctx);
      if (!q) return;
      const v = Number(ratingBtn.getAttribute('data-rating-pick'));
      ctx.answers.set(q.id, v);
      paint(ctx, shell);
      return;
    }
    const choiceLabel = e.target.closest('[data-choice]');
    if (choiceLabel) {
      // Let the radio/checkbox handle it; we re-paint after via `change` listener below
    }
  });

  // Input changes — split: 'change' handles radio/checkbox/date toggles (which
  // need a repaint to reveal/hide "Other" text fields). 'input' handles text
  // typing (no repaint, preserves cursor position).
  shell.addEventListener('change', (e) => {
    const kind = e.target.getAttribute?.('data-q-input');
    if (!kind) return;
    // Skip text inputs in 'change' — they're handled by 'input' below
    if (kind === 'text' || kind === 'other-text') return;
    handleInputChange(ctx, e, shell, false);
  });
  shell.addEventListener('input', (e) => {
    const kind = e.target.getAttribute?.('data-q-input');
    if (!kind) return;
    // Only handle text-typing here. Radios/checkboxes/dates fire 'input' too,
    // but we ignore that — 'change' handles those and triggers a repaint.
    if (kind !== 'text' && kind !== 'other-text') return;
    handleInputChange(ctx, e, shell, true);
  });

  try {
    await load(ctx);
    paint(ctx, shell);
  } catch (err) {
    console.error('Respondent load failed:', err);
    main.innerHTML = `
      <div class="respondent-message">
        <h1>This link is <span class="red">not available</span></h1>
        <p>${escapeHtml(humanError(err))}</p>
        <p style="font-size:12px; color: var(--ink-mute);">If you think this is a mistake, contact whoever sent you the link.</p>
      </div>
    `;
  }
}

function humanError(err) {
  const msg = err?.message ?? '';
  if (msg.includes('invalid_group_token')) return 'This link is invalid or has expired.';
  if (msg.includes('group_closed')) return 'This questionnaire is no longer accepting responses.';
  if (msg.includes('timed out')) return 'The server took too long to respond. Please try again in a moment.';
  return msg || 'Something went wrong loading this questionnaire.';
}

// ─── Loading ────────────────────────────────────────────────────────────────

async function load(ctx) {
  // Resume existing session if cookie is set, else create new
  const existing = getCookie(cookieKey(ctx.groupToken));

  // Call claim_session via raw fetch to bypass any quirks in the Supabase JS
  // client's RPC handling (which has caused "Cannot coerce" errors when the
  // function returns jsonb). PostgREST jsonb-returning functions need
  // Accept: application/json (NOT vnd.pgrst.object+json).
  const url = `${window.INQUIRE_CONFIG.supabaseUrl}/rest/v1/rpc/claim_session`;
  const res = await withTimeout(fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'apikey': window.INQUIRE_CONFIG.supabaseAnonKey,
      'Authorization': `Bearer ${window.INQUIRE_CONFIG.supabaseAnonKey}`
    },
    body: JSON.stringify({
      p_group_token: ctx.groupToken,
      p_existing_session_token: existing || null
    })
  }), LOAD_TIMEOUT_MS, 'claim session');

  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = j.message || j.error || j.hint || text;
    } catch {}
    throw new Error(msg);
  }

  const data = await res.json();
  if (!data) throw new Error('claim returned empty response');

  // Function returns jsonb directly — should be an object, not array
  const session = Array.isArray(data) ? data[0] : data;
  if (!session?.session_token) throw new Error('claim returned empty session');

  ctx.sessionToken = session.session_token;
  ctx.currentIndex = session.current_question_index || 0;
  setCookie(cookieKey(ctx.groupToken), session.session_token);

  if (session.status === 'submitted') {
    ctx.submitted = true;
    return;
  }

  // Load questionnaire + questions via RPC. Anonymous respondents can't read
  // these tables directly under RLS, so we use a security-definer function
  // gated by the session token.
  const dataUrl = `${window.INQUIRE_CONFIG.supabaseUrl}/rest/v1/rpc/get_session_data`;
  const dataRes = await withTimeout(fetch(dataUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'apikey': window.INQUIRE_CONFIG.supabaseAnonKey,
      'Authorization': `Bearer ${window.INQUIRE_CONFIG.supabaseAnonKey}`
    },
    body: JSON.stringify({ p_token: ctx.sessionToken })
  }), LOAD_TIMEOUT_MS, 'load questions');

  if (!dataRes.ok) {
    const text = await dataRes.text();
    throw new Error(text);
  }
  const sessionData = await dataRes.json();
  ctx.questionnaire = sessionData?.questionnaire ?? null;
  ctx.questions = sessionData?.questions ?? [];

  // Load any previously-saved answers for this session (for resume)
  const answersUrl = `${window.INQUIRE_CONFIG.supabaseUrl}/rest/v1/rpc/get_session_answers`;
  const ansRes = await fetch(answersUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'apikey': window.INQUIRE_CONFIG.supabaseAnonKey,
      'Authorization': `Bearer ${window.INQUIRE_CONFIG.supabaseAnonKey}`
    },
    body: JSON.stringify({ p_token: ctx.sessionToken })
  });
  if (ansRes.ok) {
    const prevAnswers = await ansRes.json();
    if (Array.isArray(prevAnswers)) {
      for (const r of prevAnswers) ctx.answers.set(r.question_id, r.answer);
    }
  }
}

// ─── State helpers ──────────────────────────────────────────────────────────

// Returns the list of questions visible right now, given current answers.
// Conditional questions are filtered out if their show_if doesn't match.
function visibleQuestions(ctx) {
  return ctx.questions.filter(q => isVisible(q, ctx.answers, ctx.questions));
}

function isVisible(q, answers, allQuestions) {
  if (!q.show_if || !q.show_if.question_id) return true;
  const refQ = allQuestions.find(x => x.id === q.show_if.question_id);
  if (!refQ) return false; // referenced question doesn't exist
  if (!isVisible(refQ, answers, allQuestions)) return false; // ref question itself is hidden
  const refAnswer = answers.get(refQ.id);
  if (refAnswer == null) return false; // not answered yet
  return matchCondition(refAnswer, q.show_if.operator, q.show_if.value);
}

function matchCondition(answer, op, value) {
  const a = answer;
  if (op === 'equals') {
    if (Array.isArray(a)) return a.includes(value);
    return String(a) === String(value);
  }
  if (op === 'not_equals') {
    if (Array.isArray(a)) return !a.includes(value);
    return String(a) !== String(value);
  }
  if (op === 'contains') {
    if (Array.isArray(a)) return a.includes(value);
    return String(a).includes(String(value));
  }
  return true;
}

// Discard answers to questions that are hidden in current state.
function pruneHiddenAnswers(ctx) {
  for (const q of ctx.questions) {
    if (!isVisible(q, ctx.answers, ctx.questions)) {
      ctx.answers.delete(q.id);
    }
  }
}

function currentQuestion(ctx) {
  const list = visibleQuestions(ctx);
  return list[ctx.currentIndex] ?? null;
}

// ─── Painting ───────────────────────────────────────────────────────────────

function paint(ctx, shell) {
  if (ctx.submitted) {
    paintThanks(ctx, shell);
    return;
  }

  const visible = visibleQuestions(ctx);
  if (visible.length === 0) {
    shell.querySelector('#respondentMain').innerHTML = `
      <div class="respondent-message">
        <h1>No questions <span class="red">to answer</span></h1>
        <p>This questionnaire doesn't have any questions visible to you right now.</p>
      </div>
    `;
    return;
  }

  // Clamp currentIndex
  if (ctx.currentIndex < 0) ctx.currentIndex = 0;
  if (ctx.currentIndex > visible.length) ctx.currentIndex = visible.length;

  // Review screen if past the last question
  if (ctx.currentIndex >= visible.length) {
    paintReview(ctx, shell, visible);
    return;
  }

  paintQuestion(ctx, shell, visible);
}

function paintQuestion(ctx, shell, visible) {
  const q = visible[ctx.currentIndex];
  const total = visible.length;
  const num = ctx.currentIndex + 1;
  const pct = Math.round((num / total) * 100);
  const required = q.required;

  shell.innerHTML = `
    <header class="respondent-topbar">
      <div class="logo">
        ${brandLogo()}
      </div>
      <div class="respondent-questionnaire-title">${escapeHtml(ctx.questionnaire?.title ?? '')}</div>
      <div style="font-size: 12px; color: rgba(255,255,255,0.6); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600;">
        Anonymous · auto-saved
      </div>
    </header>

    <div class="respondent-progress-wrap">
      <div class="respondent-progress-info">
        <span>Question ${num} of ${total}</span>
        <span>${pct}%</span>
      </div>
      <div class="respondent-progress-bar"><div class="respondent-progress-fill" style="width: ${pct}%;"></div></div>
    </div>

    <main class="respondent-main">
      <div class="respondent-question-eyebrow">${typeLabel(q.type)}${required ? ' · required' : ' · optional'}</div>
      <h1 class="respondent-question-text">
        ${escapeHtml(q.text || '(untitled)')}${required ? ' <span class="respondent-required-marker">*</span>' : ''}
      </h1>
      <div class="respondent-input">${renderInput(q, ctx.answers.get(q.id))}</div>
      <div class="respondent-validation" id="respondentValidation" style="display:none;"></div>
    </main>

    <footer class="respondent-footer">
      <div class="respondent-footer-inner">
        <button class="btn btn-outline" data-back ${num === 1 ? 'disabled' : ''}>← Back</button>
        <button class="btn" data-next>
          ${num === total ? 'Review answers' : 'Next'} <span class="arrow">→</span>
        </button>
      </div>
    </footer>
  `;
}

function paintReview(ctx, shell, visible) {
  shell.innerHTML = `
    <header class="respondent-topbar">
      <div class="logo">
        ${brandLogo()}
      </div>
      <div class="respondent-questionnaire-title">${escapeHtml(ctx.questionnaire?.title ?? '')}</div>
      <div style="font-size: 12px; color: rgba(255,255,255,0.6); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600;">
        Review your answers
      </div>
    </header>

    <div class="respondent-progress-wrap">
      <div class="respondent-progress-info">
        <span>Review · ${visible.length} of ${visible.length}</span>
        <span>100%</span>
      </div>
      <div class="respondent-progress-bar"><div class="respondent-progress-fill" style="width: 100%;"></div></div>
    </div>

    <main class="respondent-main">
      <div class="respondent-question-eyebrow">Final review</div>
      <h1 class="respondent-question-text">Ready to <span style="color: var(--red);">submit</span>?</h1>
      <p class="respondent-question-help">Take a look at your answers below. You can edit any of them before submitting. <strong>Once submitted, the link expires and you can't change anything.</strong></p>

      <div class="review-list">
        ${visible.map((q, i) => `
          <div class="review-item">
            <div class="review-num">${String(i + 1).padStart(2, '0')}</div>
            <div>
              <div class="review-q-text">${escapeHtml(q.text || '(untitled)')}${q.required ? ' <span class="respondent-required-marker">*</span>' : ''}</div>
              <div class="review-answer">${formatAnswerForReview(q, ctx.answers.get(q.id))}</div>
            </div>
            <button class="review-edit" data-edit="${i}">Edit</button>
          </div>
        `).join('')}
      </div>
    </main>

    <footer class="respondent-footer">
      <div class="respondent-footer-inner">
        <button class="btn btn-outline" data-back>← Back</button>
        <button class="btn" data-submit>
          Submit questionnaire <span class="arrow">→</span>
        </button>
      </div>
    </footer>
  `;
}

function paintThanks(ctx, shell) {
  shell.innerHTML = `
    <header class="respondent-topbar">
      <div class="logo">
        ${brandLogo()}
      </div>
    </header>
    <main class="respondent-main">
      <div class="respondent-message">
        <h1>Thank <span class="red">you</span>.</h1>
        <p>Your responses have been submitted successfully. The link is now closed for you.</p>
        <p style="font-size:12px; color: var(--ink-mute);">You can close this window.</p>
      </div>
    </main>
  `;
}

// ─── Input rendering per type ───────────────────────────────────────────────

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

function renderInput(q, answer) {
  if (q.type === 'single_choice') return renderSingleChoice(q, answer);
  if (q.type === 'multi_choice')  return renderMultiChoice(q, answer);
  if (q.type === 'text')          return renderText(q, answer);
  if (q.type === 'rating')        return renderRating(q, answer);
  if (q.type === 'date')          return renderDate(q, answer);
  if (q.type === 'ranking')       return renderRanking(q, answer);
  return '<em>Unsupported type</em>';
}

function renderSingleChoice(q, answer) {
  const opts = Array.isArray(q.options) ? q.options.filter(o => o && o.trim()) : [];
  const selected = answer;
  const isOther = selected != null && !opts.includes(selected) && typeof selected === 'string';
  return `
    <div class="choice-group">
      ${opts.map(o => `
        <label class="choice-option ${selected === o ? 'selected' : ''}" data-choice>
          <input type="radio" name="choice" value="${escapeHtml(o)}" ${selected === o ? 'checked' : ''} data-q-input="single" />
          <span class="choice-marker radio"></span>
          <span>${escapeHtml(o)}</span>
        </label>
      `).join('')}
      <label class="choice-option ${isOther ? 'selected' : ''}" data-choice>
        <input type="radio" name="choice" value="__OTHER__" ${isOther ? 'checked' : ''} data-q-input="single-other" />
        <span class="choice-marker radio"></span>
        <span>Other (please specify)</span>
      </label>
      ${isOther ? `<input type="text" class="choice-other-input" data-q-input="other-text" value="${escapeHtml(selected ?? '')}" placeholder="Type your answer…" autofocus />` : ''}
    </div>
  `;
}

function renderMultiChoice(q, answer) {
  const opts = Array.isArray(q.options) ? q.options.filter(o => o && o.trim()) : [];
  const selected = Array.isArray(answer) ? answer : [];
  // "Other" value: any selected entry not in opts
  const otherText = selected.find(s => !opts.includes(s) && typeof s === 'string') ?? '';
  const otherChecked = otherText !== '';
  return `
    <div class="choice-group">
      ${opts.map(o => `
        <label class="choice-option ${selected.includes(o) ? 'selected' : ''}" data-choice>
          <input type="checkbox" value="${escapeHtml(o)}" ${selected.includes(o) ? 'checked' : ''} data-q-input="multi" />
          <span class="choice-marker"></span>
          <span>${escapeHtml(o)}</span>
        </label>
      `).join('')}
      <label class="choice-option ${otherChecked ? 'selected' : ''}" data-choice>
        <input type="checkbox" value="__OTHER__" ${otherChecked ? 'checked' : ''} data-q-input="multi-other" />
        <span class="choice-marker"></span>
        <span>Other (please specify)</span>
      </label>
      ${otherChecked ? `<input type="text" class="choice-other-input" data-q-input="other-text" value="${escapeHtml(otherText)}" placeholder="Type your answer…" autofocus />` : ''}
    </div>
  `;
}

function renderText(q, answer) {
  return `<textarea class="respondent-textarea" data-q-input="text" placeholder="Type your answer…">${escapeHtml(answer ?? '')}</textarea>`;
}

function renderDate(q, answer) {
  return `<input type="date" class="respondent-date" data-q-input="date" value="${escapeHtml(answer ?? '')}" />`;
}

function renderRating(q, answer) {
  const opt = (q.options && typeof q.options === 'object' && !Array.isArray(q.options)) ? q.options : { min: 1, max: 5 };
  const min = Number(opt.min ?? 1);
  const max = Number(opt.max ?? 5);
  const selected = Number(answer);
  const pills = [];
  for (let i = min; i <= max; i++) {
    pills.push(`<button type="button" class="rating-pill ${selected === i ? 'selected' : ''}" data-rating-pick="${i}">${i}</button>`);
  }
  return `
    <div class="rating-scale">${pills.join('')}</div>
    ${opt.min_label || opt.max_label ? `
      <div class="rating-labels">
        <span>${escapeHtml(opt.min_label ?? '')}</span>
        <span>${escapeHtml(opt.max_label ?? '')}</span>
      </div>
    ` : ''}
  `;
}

function renderRanking(q, answer) {
  const opts = Array.isArray(q.options) ? q.options.filter(o => o && o.trim()) : [];
  // Initial ordering: use answer if it's a complete permutation, else use option order
  let order = opts.slice();
  if (Array.isArray(answer) && answer.length === opts.length && opts.every(o => answer.includes(o))) {
    order = answer.slice();
  }
  return `
    <div class="ranking-list">
      ${order.map((item, i) => `
        <div class="ranking-item">
          <div class="ranking-pos">${i + 1}</div>
          <div class="ranking-text">${escapeHtml(item)}</div>
          <div class="ranking-controls">
            <button type="button" class="ranking-btn" data-rank="up" data-i="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="ranking-btn" data-rank="down" data-i="${i}" ${i === order.length - 1 ? 'disabled' : ''}>↓</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// ─── Input change handler ───────────────────────────────────────────────────

function handleInputChange(ctx, e, shell, isInputEvent = false) {
  const el = e.target;
  const kind = el.getAttribute?.('data-q-input');
  if (!kind) return;
  const q = currentQuestion(ctx);
  if (!q) return;

  // Clear validation error as soon as the user interacts
  const errEl = shell.querySelector('#respondentValidation');
  if (errEl && errEl.style.display !== 'none') {
    errEl.style.display = 'none';
    errEl.textContent = '';
  }

  if (kind === 'single' || kind === 'single-other') {
    const value = el.value === '__OTHER__' ? '' : el.value;
    ctx.answers.set(q.id, value);
    // Defensive immediate visual update: clear selected class from all sibling
    // options, set on the one whose input was just clicked. Prevents stale
    // visual state if paint() doesn't run synchronously.
    const labels = shell.querySelectorAll('.choice-group .choice-option');
    labels.forEach(l => l.classList.remove('selected'));
    el.closest('.choice-option')?.classList.add('selected');
    if (!isInputEvent) paint(ctx, shell);
    return;
  }
  if (kind === 'multi' || kind === 'multi-other') {
    const checks = shell.querySelectorAll('[data-q-input="multi"]');
    const selected = [];
    for (const c of checks) if (c.checked) selected.push(c.value);
    const otherCheck = shell.querySelector('[data-q-input="multi-other"]');
    if (otherCheck?.checked) {
      // Reserve a slot; actual text comes from other-text
      const otherInput = shell.querySelector('[data-q-input="other-text"]');
      const otherVal = otherInput?.value ?? '';
      if (otherVal) selected.push(otherVal);
    }
    ctx.answers.set(q.id, selected);
    if (!isInputEvent) paint(ctx, shell);
    return;
  }
  if (kind === 'other-text') {
    if (q.type === 'single_choice') {
      ctx.answers.set(q.id, el.value);
    } else if (q.type === 'multi_choice') {
      const checks = shell.querySelectorAll('[data-q-input="multi"]');
      const selected = [];
      for (const c of checks) if (c.checked) selected.push(c.value);
      if (el.value) selected.push(el.value);
      ctx.answers.set(q.id, selected);
    }
    // No repaint — preserve focus/cursor
    return;
  }
  if (kind === 'text') {
    ctx.answers.set(q.id, el.value);
    return;
  }
  if (kind === 'date') {
    ctx.answers.set(q.id, el.value);
    return;
  }
}

function isAnswerEmpty(q, a) {
  if (a == null) return true;
  if (Array.isArray(a)) return a.length === 0 || a.every(x => x === '' || x == null);
  if (typeof a === 'string') return a.trim() === '';
  return false;
}

// ─── Ranking move ───────────────────────────────────────────────────────────

function handleRankMove(ctx, i, delta) {
  const q = currentQuestion(ctx);
  if (!q || q.type !== 'ranking') return;
  const opts = Array.isArray(q.options) ? q.options.filter(o => o && o.trim()) : [];
  let order = ctx.answers.get(q.id);
  if (!Array.isArray(order) || order.length !== opts.length || !opts.every(o => order.includes(o))) {
    order = opts.slice();
  } else {
    order = order.slice();
  }
  const j = i + delta;
  if (j < 0 || j >= order.length) return;
  const tmp = order[i];
  order[i] = order[j];
  order[j] = tmp;
  ctx.answers.set(q.id, order);
}

// ─── Navigation ─────────────────────────────────────────────────────────────

async function goNext(ctx, shell) {
  const visible = visibleQuestions(ctx);
  const q = visible[ctx.currentIndex];
  if (q) {
    // Required check — show inline error if empty
    if (q.required && isAnswerEmpty(q, ctx.answers.get(q.id))) {
      const errEl = shell.querySelector('#respondentValidation');
      if (errEl) {
        errEl.textContent = 'Please answer this question to continue.';
        errEl.style.display = 'block';
        // Briefly shake the input area to draw attention
        const inputArea = shell.querySelector('.respondent-input');
        if (inputArea) {
          inputArea.classList.remove('shake');
          // Force reflow so the animation can re-trigger
          void inputArea.offsetWidth;
          inputArea.classList.add('shake');
        }
      }
      return;
    }
    // Save answer if present
    if (ctx.answers.has(q.id)) {
      const newIdx = ctx.currentIndex + 1;
      const { error } = await sb.rpc('save_answer', {
        p_session_token: ctx.sessionToken,
        p_question_id: q.id,
        p_answer: ctx.answers.get(q.id),
        p_current_index: newIdx
      });
      if (error) {
        console.error('save_answer failed', error);
      }
    }
  }

  ctx.currentIndex += 1;
  pruneHiddenAnswers(ctx);
  paint(ctx, shell);
}

function goBack(ctx, shell) {
  if (ctx.currentIndex > 0) {
    ctx.currentIndex -= 1;
    paint(ctx, shell);
  }
}

async function submit(ctx, shell) {
  const submitBtn = shell.querySelector('[data-submit]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Submitting…';
  }

  // Save any unsaved answers first
  for (const q of ctx.questions) {
    if (ctx.answers.has(q.id) && isVisible(q, ctx.answers, ctx.questions)) {
      await sb.rpc('save_answer', {
        p_session_token: ctx.sessionToken,
        p_question_id: q.id,
        p_answer: ctx.answers.get(q.id),
        p_current_index: null
      });
    }
  }

  const { error } = await sb.rpc('submit_session', { p_session_token: ctx.sessionToken });
  if (error) {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Submit questionnaire <span class="arrow">→</span>';
    }
    alert('Submit failed: ' + error.message);
    return;
  }

  ctx.submitted = true;
  paint(ctx, shell);
}

// ─── Review formatting ──────────────────────────────────────────────────────

function formatAnswerForReview(q, answer) {
  if (answer == null || isAnswerEmpty(q, answer)) {
    return '<span class="empty">— no answer —</span>';
  }
  if (q.type === 'multi_choice' && Array.isArray(answer)) {
    return escapeHtml(answer.join(', '));
  }
  if (q.type === 'ranking' && Array.isArray(answer)) {
    return answer.map((a, i) => `${i + 1}. ${escapeHtml(a)}`).join(' · ');
  }
  if (q.type === 'rating') {
    return escapeHtml(String(answer));
  }
  if (q.type === 'date') {
    try {
      return escapeHtml(new Date(answer).toLocaleDateString('en-GB', { dateStyle: 'medium' }));
    } catch { return escapeHtml(String(answer)); }
  }
  return escapeHtml(String(answer));
}
