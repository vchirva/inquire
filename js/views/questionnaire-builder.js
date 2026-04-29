// Questionnaire Builder
// =======================
// State machine: load → edit (autosave on change) → save back to DB.
// All persistence goes through one autosave function debounced at 500ms.

import { sb } from '../supabase.js';
import { navigate } from '../router.js';
import { escapeHtml, showToast } from '../utils.js';
import { renderAdminTopbar, attachAdminTopbarHandlers } from './_topbar.js';

// ─── In-memory model ────────────────────────────────────────────────────────
let state = null;          // { questionnaire, questions, clients, tags, allClients, allTags, locked }
let saveTimer = null;
let qSaveTimer = null;
let saveStatus = 'idle';   // 'idle' | 'saving' | 'saved' | 'error'

// Question type metadata
const TYPES = [
  { id: 'single_choice', label: 'Single choice' },
  { id: 'multi_choice',  label: 'Multiple choice' },
  { id: 'text',          label: 'Free text' },
  { id: 'rating',        label: 'Rating' },
  { id: 'date',          label: 'Date' },
  { id: 'ranking',       label: 'Ranking' }
];

const OPTIONS_TYPES = new Set(['single_choice', 'multi_choice', 'ranking']);
const RATING_DEFAULT = { min: 1, max: 5, min_label: '', max_label: '' };

// Default options shape per type
function defaultOptions(type) {
  if (OPTIONS_TYPES.has(type)) return ['', ''];
  if (type === 'rating') return { ...RATING_DEFAULT };
  return null;
}

// ─── Entry ──────────────────────────────────────────────────────────────────

export async function renderQuestionnaireBuilder(root, params) {
  const id = params.id;

  // Reset module state and any pending timers from prior visits.
  state = null;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (qSaveTimer) { clearTimeout(qSaveTimer); qSaveTimer = null; }

  root.innerHTML = `
    ${renderAdminTopbar('/admin/questionnaires')}
    <div id="builderContainer" class="fade-in">
      <div class="builder-shell">
        <div style="padding: 64px 0; text-align: center; color: var(--ink-mute);">
          <span class="spinner spinner-dark"></span> Loading…
        </div>
      </div>
    </div>
  `;
  attachAdminTopbarHandlers(root);

  let ok = false;
  try {
    ok = await loadAll(id);
  } catch (err) {
    console.error('Builder load failed:', err);
    root.querySelector('#builderContainer').innerHTML = `
      <div class="builder-shell">
        <div class="empty">
          <div class="empty-title">Couldn't load questionnaire</div>
          <div class="empty-text">${escapeHtml(err?.message ?? 'Unknown error')}</div>
          <button class="btn btn-outline" onclick="location.hash='#/admin/questionnaires'">Back to list</button>
        </div>
      </div>
    `;
    return;
  }

  if (!ok) {
    root.querySelector('#builderContainer').innerHTML = `
      <div class="builder-shell">
        <div class="empty">
          <div class="empty-title">Not found</div>
          <div class="empty-text">This questionnaire doesn't exist or you don't have access to it.</div>
          <button class="btn btn-outline" onclick="location.hash='#/admin/questionnaires'">Back to list</button>
        </div>
      </div>
    `;
    return;
  }

  paint();
}

async function loadAll(id) {
  const [q, qq, qc, qt, c, t] = await Promise.all([
    sb.from('questionnaires').select('*').eq('id', id).single(),
    sb.from('questions').select('*').eq('questionnaire_id', id).order('order_index'),
    sb.from('questionnaire_clients').select('client_id').eq('questionnaire_id', id),
    sb.from('questionnaire_tags').select('tag_id').eq('questionnaire_id', id),
    sb.from('clients').select('id, name').order('name'),
    sb.from('tags').select('id, name').order('name')
  ]);

  if (q.error) {
    // PGRST116 == no rows; treat as not-found, anything else is a real error
    if (q.error.code === 'PGRST116') return false;
    throw q.error;
  }
  if (!q.data) return false;
  if (qq.error) throw qq.error;
  if (c.error) throw c.error;
  if (t.error) throw t.error;

  state = {
    questionnaire: q.data,
    questions: qq.data || [],
    clientIds: (qc.data || []).map(r => r.client_id),
    tagIds: (qt.data || []).map(r => r.tag_id),
    allClients: c.data || [],
    allTags: t.data || [],
    locked: !!q.data.locked_at
  };
  return true;
}

// ─── Painting ───────────────────────────────────────────────────────────────

function paint() {
  const container = document.getElementById('builderContainer');
  const { questionnaire: q, locked } = state;

  container.innerHTML = `
    <div class="builder-shell">
      <button class="builder-back" id="backBtn">← Back to questionnaires</button>

      <div class="builder-status">
        <span class="badge ${q.status}">${q.status === 'live' ? '<span class="dot"></span>' : ''}${q.status}</span>
        <span class="save-indicator" id="saveIndicator"><span class="dot"></span> <span id="saveText">All changes saved</span></span>
        ${locked ? '<span style="color:var(--amber);">· Locked — published questionnaires can\'t be edited</span>' : ''}
      </div>

      <input class="builder-title" id="titleInput" placeholder="Untitled questionnaire" value="${escapeHtml(q.title)}" ${locked ? 'readonly' : ''} />
      <textarea class="builder-description" id="descInput" rows="2" placeholder="Add a description (optional)" ${locked ? 'readonly' : ''}>${escapeHtml(q.description ?? '')}</textarea>

      <div class="builder-section">
        <div class="builder-section-title">Assigned to</div>
        <div class="chip-row" id="clientChips"></div>
      </div>

      <div class="builder-section">
        <div class="builder-section-title">Tags</div>
        <div class="chip-row" id="tagChips"></div>
      </div>

      <div class="builder-section">
        <div class="builder-section-title">Questions</div>
        <div id="questionsContainer"></div>
        ${locked ? '' : `<button class="add-question-btn" id="addQuestionBtn">+ Add question</button>`}
      </div>

      <div class="builder-footer">
        <div style="display:flex; gap:16px; align-items:center; font-size:12px; color: var(--ink-mute);">
          ${state.questions.length} question${state.questions.length === 1 ? '' : 's'}
          ${locked ? '' : `<button class="conditional-toggle remove" id="deleteQuestionnaireBtn" style="margin-left:8px;">Delete questionnaire</button>`}
        </div>
        <div style="display:flex; gap:12px;">
          <button class="btn btn-outline" id="previewBtn" disabled title="Coming in a later slice">Preview</button>
          ${locked ? '' : `<button class="btn" id="publishBtn" disabled title="Publishing comes in the next slice">Publish & generate link</button>`}
        </div>
      </div>
    </div>
  `;

  // Wire up
  container.querySelector('#backBtn').addEventListener('click', () => navigate('/admin/questionnaires'));

  if (!locked) {
    container.querySelector('#titleInput').addEventListener('input', e => {
      state.questionnaire.title = e.target.value;
      scheduleSave();
    });
    container.querySelector('#descInput').addEventListener('input', e => {
      state.questionnaire.description = e.target.value;
      scheduleSave();
    });
    container.querySelector('#addQuestionBtn').addEventListener('click', addQuestion);
    container.querySelector('#deleteQuestionnaireBtn')?.addEventListener('click', deleteQuestionnaire);
  }

  paintClientChips();
  paintTagChips();
  paintQuestions();
}

function paintClientChips() {
  const wrap = document.getElementById('clientChips');
  if (!wrap) return;
  const assigned = state.allClients.filter(c => state.clientIds.includes(c.id));
  const unassigned = state.allClients.filter(c => !state.clientIds.includes(c.id));

  wrap.innerHTML = `
    ${assigned.map(c => `
      <span class="chip">${escapeHtml(c.name)}<button data-remove-client="${c.id}" ${state.locked ? 'disabled style="display:none;"' : ''} title="Remove">×</button></span>
    `).join('')}
    ${state.locked ? '' : `<span class="combo-wrap" id="addClientCombo">
      <button class="chip-add" id="addClientBtn">+ Add client</button>
    </span>`}
  `;

  wrap.querySelectorAll('[data-remove-client]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await removeClient(btn.dataset.removeClient);
    });
  });

  if (!state.locked) {
    document.getElementById('addClientBtn').addEventListener('click', () => {
      openCombo('addClientCombo', unassigned.map(c => ({ id: c.id, label: c.name })), async (picked) => {
        if (picked?.id) await addClient(picked.id);
      });
    });
  }
}

function paintTagChips() {
  const wrap = document.getElementById('tagChips');
  if (!wrap) return;
  const assigned = state.allTags.filter(t => state.tagIds.includes(t.id));
  const unassigned = state.allTags.filter(t => !state.tagIds.includes(t.id));

  wrap.innerHTML = `
    ${assigned.map(t => `
      <span class="chip">${escapeHtml(t.name)}<button data-remove-tag="${t.id}" ${state.locked ? 'disabled style="display:none;"' : ''} title="Remove">×</button></span>
    `).join('')}
    ${state.locked ? '' : `<span class="combo-wrap" id="addTagCombo">
      <button class="chip-add" id="addTagBtn">+ Add tag</button>
    </span>`}
  `;

  wrap.querySelectorAll('[data-remove-tag]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await removeTag(btn.dataset.removeTag);
    });
  });

  if (!state.locked) {
    document.getElementById('addTagBtn').addEventListener('click', () => {
      openCombo(
        'addTagCombo',
        unassigned.map(t => ({ id: t.id, label: t.name })),
        async (picked) => {
          if (picked?.id) await addTagById(picked.id);
          else if (picked?.create) await createAndAddTag(picked.create);
        },
        { allowCreate: true }
      );
    });
  }
}

function paintQuestions() {
  const wrap = document.getElementById('questionsContainer');
  if (!wrap) return;

  if (state.questions.length === 0) {
    wrap.innerHTML = `
      <div style="padding: 32px 0; color: var(--ink-mute); font-size: 14px; text-align: center;">
        No questions yet. ${state.locked ? '' : 'Click "Add question" below to start building.'}
      </div>
    `;
    return;
  }

  wrap.innerHTML = state.questions.map((q, i) => renderQuestionCard(q, i)).join('');
  state.questions.forEach((q, i) => wireQuestionCard(q, i));
}

function renderQuestionCard(q, idx) {
  const num = String(idx + 1).padStart(2, '0');
  const showIfActive = q.show_if && q.show_if.question_id;
  return `
    <div class="question-card" data-qid="${q.id}">
      <div class="question-card-header">
        <div class="question-num">${num}</div>
        <select class="question-type-select" data-field="type" ${state.locked ? 'disabled' : ''}>
          ${TYPES.map(t => `<option value="${t.id}" ${q.type === t.id ? 'selected' : ''}>${t.label}</option>`).join('')}
        </select>
        <label class="question-required-toggle">
          <input type="checkbox" data-field="required" ${q.required ? 'checked' : ''} ${state.locked ? 'disabled' : ''} />
          <span class="toggle-track"></span>
          <span class="toggle-label">${q.required ? 'Required' : 'Optional'}</span>
        </label>
        <div class="question-card-actions">
          <button class="q-icon-btn" data-action="up" ${idx === 0 ? 'disabled' : ''} ${state.locked ? 'disabled' : ''} title="Move up">↑</button>
          <button class="q-icon-btn" data-action="down" ${idx === state.questions.length - 1 ? 'disabled' : ''} ${state.locked ? 'disabled' : ''} title="Move down">↓</button>
          <button class="q-icon-btn danger" data-action="delete" ${state.locked ? 'disabled' : ''} title="Delete">×</button>
        </div>
      </div>

      <input class="question-text-input" data-field="text" value="${escapeHtml(q.text ?? '')}" placeholder="Type your question…" ${state.locked ? 'readonly' : ''} />

      ${renderTypeEditor(q)}

      ${renderConditionalBar(q, idx)}
    </div>
  `;
}

function renderTypeEditor(q) {
  if (OPTIONS_TYPES.has(q.type)) {
    const opts = Array.isArray(q.options) ? q.options : [];
    const showOther = (q.type === 'single_choice' || q.type === 'multi_choice');
    return `
      <div class="options-editor" data-options>
        ${opts.map((o, i) => `
          <div class="option-row">
            <span class="option-marker ${q.type === 'single_choice' ? 'radio' : q.type === 'multi_choice' ? 'check' : 'rank'}">${q.type === 'ranking' ? (i + 1) : ''}</span>
            <input class="option-input" data-opt-index="${i}" value="${escapeHtml(o)}" placeholder="Option ${i + 1}" ${state.locked ? 'readonly' : ''} />
            ${state.locked ? '' : `<button class="q-icon-btn danger" data-opt-remove="${i}" title="Remove option">×</button>`}
          </div>
        `).join('')}
        ${state.locked ? '' : `<button class="add-option-btn" data-opt-add>+ Add option</button>`}
        ${showOther ? `<div class="option-other-pseudo">
          <span class="option-marker ${q.type === 'single_choice' ? 'radio' : 'check'}"></span>
          Other (please specify) — automatically included
        </div>` : ''}
      </div>
    `;
  }

  if (q.type === 'rating') {
    const o = (q.options && typeof q.options === 'object') ? q.options : { ...RATING_DEFAULT };
    return `
      <div class="rating-editor">
        <div class="field">
          <span class="field-label">Min</span>
          <input type="number" data-rating="min" value="${o.min ?? 1}" min="0" max="10" ${state.locked ? 'readonly' : ''} />
        </div>
        <div class="field">
          <span class="field-label">Max</span>
          <input type="number" data-rating="max" value="${o.max ?? 5}" min="2" max="10" ${state.locked ? 'readonly' : ''} />
        </div>
        <div class="field">
          <span class="field-label">Min label</span>
          <input type="text" data-rating="min_label" value="${escapeHtml(o.min_label ?? '')}" placeholder="e.g. Poor" ${state.locked ? 'readonly' : ''} />
        </div>
        <div class="field">
          <span class="field-label">Max label</span>
          <input type="text" data-rating="max_label" value="${escapeHtml(o.max_label ?? '')}" placeholder="e.g. Excellent" ${state.locked ? 'readonly' : ''} />
        </div>
      </div>
    `;
  }

  // text, date — no extra editor
  return '';
}

function renderConditionalBar(q, idx) {
  if (state.locked) return '';
  const earlier = state.questions.slice(0, idx);
  if (earlier.length === 0) return ''; // no possible conditions
  const showIf = q.show_if;
  if (!showIf?.question_id) {
    return `
      <div class="conditional-bar">
        <button class="conditional-toggle" data-action="add-condition">+ Add condition</button>
      </div>
    `;
  }
  const refQ = earlier.find(e => e.id === showIf.question_id);
  return `
    <div class="conditional-bar active">
      Show this question only if
      <select data-cond="question_id">
        ${earlier.map(e => `<option value="${e.id}" ${e.id === showIf.question_id ? 'selected' : ''}>${escapeHtml((e.text || '(untitled)').slice(0, 40))}</option>`).join('')}
      </select>
      <select data-cond="operator">
        <option value="equals" ${showIf.operator === 'equals' ? 'selected' : ''}>equals</option>
        <option value="not_equals" ${showIf.operator === 'not_equals' ? 'selected' : ''}>does not equal</option>
        <option value="contains" ${showIf.operator === 'contains' ? 'selected' : ''}>contains</option>
      </select>
      ${renderConditionValueInput(refQ, showIf.value)}
      <button class="conditional-toggle remove" data-action="remove-condition">Remove</button>
    </div>
  `;
}

function renderConditionValueInput(refQ, value) {
  if (!refQ) return `<input data-cond="value" value="${escapeHtml(value ?? '')}" placeholder="value" />`;
  if (OPTIONS_TYPES.has(refQ.type)) {
    const opts = Array.isArray(refQ.options) ? refQ.options : [];
    return `
      <select data-cond="value">
        <option value="" disabled ${value == null ? 'selected' : ''}>— pick a value —</option>
        ${opts.map(o => `<option value="${escapeHtml(o)}" ${value === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
      </select>
    `;
  }
  return `<input data-cond="value" value="${escapeHtml(value ?? '')}" placeholder="value" />`;
}

function wireQuestionCard(q, idx) {
  const card = document.querySelector(`.question-card[data-qid="${q.id}"]`);
  if (!card) return;

  // Field bindings
  card.querySelector('[data-field="type"]')?.addEventListener('change', e => {
    const newType = e.target.value;
    q.type = newType;
    q.options = defaultOptions(newType);
    // If condition referenced this question, the parent value type may now be invalid;
    // we leave the parent's show_if alone — they'll see invalid options and can re-pick.
    saveQuestion(q);
    paintQuestions();
  });

  const requiredEl = card.querySelector('[data-field="required"]');
  requiredEl?.addEventListener('change', e => {
    q.required = e.target.checked;
    card.querySelector('.toggle-label').textContent = q.required ? 'Required' : 'Optional';
    saveQuestion(q);
  });

  card.querySelector('[data-field="text"]')?.addEventListener('input', e => {
    q.text = e.target.value;
    scheduleSaveQuestion(q);
  });

  // Reorder
  card.querySelector('[data-action="up"]')?.addEventListener('click', () => moveQuestion(idx, -1));
  card.querySelector('[data-action="down"]')?.addEventListener('click', () => moveQuestion(idx, 1));
  card.querySelector('[data-action="delete"]')?.addEventListener('click', () => deleteQuestion(q));

  // Options editing for choice/ranking
  if (OPTIONS_TYPES.has(q.type)) {
    card.querySelectorAll('[data-opt-index]').forEach(input => {
      input.addEventListener('input', e => {
        const i = Number(input.dataset.optIndex);
        q.options[i] = e.target.value;
        scheduleSaveQuestion(q);
      });
    });
    card.querySelectorAll('[data-opt-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.optRemove);
        q.options.splice(i, 1);
        if (q.options.length === 0) q.options = [''];
        saveQuestion(q);
        paintQuestions();
      });
    });
    card.querySelector('[data-opt-add]')?.addEventListener('click', () => {
      q.options.push('');
      saveQuestion(q);
      paintQuestions();
    });
  }

  // Rating
  if (q.type === 'rating') {
    card.querySelectorAll('[data-rating]').forEach(input => {
      input.addEventListener('input', e => {
        const k = input.dataset.rating;
        if (!q.options || typeof q.options !== 'object' || Array.isArray(q.options)) q.options = { ...RATING_DEFAULT };
        if (k === 'min' || k === 'max') q.options[k] = parseInt(e.target.value || '0', 10) || 0;
        else q.options[k] = e.target.value;
        scheduleSaveQuestion(q);
      });
    });
  }

  // Conditional logic
  card.querySelector('[data-action="add-condition"]')?.addEventListener('click', () => {
    const earlier = state.questions.slice(0, idx);
    if (earlier.length === 0) return;
    q.show_if = { question_id: earlier[0].id, operator: 'equals', value: '' };
    saveQuestion(q);
    paintQuestions();
  });
  card.querySelector('[data-action="remove-condition"]')?.addEventListener('click', () => {
    q.show_if = null;
    saveQuestion(q);
    paintQuestions();
  });
  card.querySelectorAll('[data-cond]').forEach(el => {
    el.addEventListener('change', () => {
      const ci = card.querySelector('[data-cond="question_id"]')?.value;
      const op = card.querySelector('[data-cond="operator"]')?.value;
      const val = card.querySelector('[data-cond="value"]')?.value;
      q.show_if = { question_id: ci, operator: op, value: val ?? '' };
      saveQuestion(q);
      // If question_id changed, the value picker may need to repaint
      if (el.dataset.cond === 'question_id') paintQuestions();
    });
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

async function addQuestion() {
  const order = state.questions.length;
  const draft = {
    questionnaire_id: state.questionnaire.id,
    order_index: order,
    type: 'single_choice',
    text: '',
    required: false,
    options: defaultOptions('single_choice'),
    show_if: null
  };
  const { data, error } = await sb.from('questions').insert(draft).select().single();
  if (error) { showToast('Failed to add: ' + error.message, 'error'); return; }
  state.questions.push(data);
  paintQuestions();
}

async function deleteQuestionnaire() {
  if (!confirm(`Delete "${state.questionnaire.title}"? This will also delete all questions, invitations, and any responses. Cannot be undone.`)) return;
  const { error } = await sb.from('questionnaires').delete().eq('id', state.questionnaire.id);
  if (error) { showToast('Delete failed: ' + error.message, 'error'); return; }
  showToast('Questionnaire deleted', 'success');
  navigate('/admin/questionnaires');
}

async function deleteQuestion(q) {
  if (!confirm('Delete this question?')) return;
  const { error } = await sb.from('questions').delete().eq('id', q.id);
  if (error) { showToast('Delete failed: ' + error.message, 'error'); return; }
  state.questions = state.questions.filter(x => x.id !== q.id);
  // Re-index remaining
  await reindex();
  paintQuestions();
}

async function moveQuestion(idx, delta) {
  const j = idx + delta;
  if (j < 0 || j >= state.questions.length) return;
  const a = state.questions[idx];
  const b = state.questions[j];
  state.questions[idx] = b;
  state.questions[j] = a;
  await reindex();
  paintQuestions();
}

// Persists current order_index for all questions
async function reindex() {
  setSave('saving');
  const updates = state.questions.map((q, i) => ({ id: q.id, order_index: i }));
  // Apply locally
  for (const u of updates) {
    const x = state.questions.find(q => q.id === u.id);
    if (x) x.order_index = u.order_index;
  }
  // Sequential to keep it simple. The unique (questionnaire_id, order_index) constraint
  // means we have to bump everything to negative space first to avoid collisions.
  const qid = state.questionnaire.id;
  // Step 1: shift all to negative
  for (const q of state.questions) {
    await sb.from('questions').update({ order_index: -1 - q.order_index }).eq('id', q.id);
  }
  // Step 2: write final values
  for (const q of state.questions) {
    await sb.from('questions').update({ order_index: q.order_index }).eq('id', q.id);
  }
  setSave('saved');
}

// Save individual question (debounced for text edits)
function scheduleSaveQuestion(q) {
  setSave('saving');
  clearTimeout(qSaveTimer);
  qSaveTimer = setTimeout(() => saveQuestion(q), 500);
}

async function saveQuestion(q) {
  setSave('saving');
  clearTimeout(qSaveTimer);
  const { error } = await sb.from('questions').update({
    type: q.type,
    text: q.text,
    required: q.required,
    options: q.options,
    show_if: q.show_if
  }).eq('id', q.id);
  if (error) { setSave('error'); showToast('Save failed: ' + error.message, 'error'); return; }
  setSave('saved');
}

// Save questionnaire (title, description) — debounced
function scheduleSave() {
  setSave('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveQuestionnaire, 500);
}

async function saveQuestionnaire() {
  setSave('saving');
  clearTimeout(saveTimer);
  const { error } = await sb.from('questionnaires').update({
    title: state.questionnaire.title,
    description: state.questionnaire.description
  }).eq('id', state.questionnaire.id);
  if (error) { setSave('error'); showToast('Save failed: ' + error.message, 'error'); return; }
  setSave('saved');
}

// Clients & tags
async function addClient(clientId) {
  const { error } = await sb.from('questionnaire_clients').insert({
    questionnaire_id: state.questionnaire.id,
    client_id: clientId
  });
  if (error) { showToast('Failed: ' + error.message, 'error'); return; }
  state.clientIds.push(clientId);
  paintClientChips();
}

async function removeClient(clientId) {
  const { error } = await sb.from('questionnaire_clients')
    .delete()
    .eq('questionnaire_id', state.questionnaire.id)
    .eq('client_id', clientId);
  if (error) { showToast('Failed: ' + error.message, 'error'); return; }
  state.clientIds = state.clientIds.filter(id => id !== clientId);
  paintClientChips();
}

async function addTagById(tagId) {
  const { error } = await sb.from('questionnaire_tags').insert({
    questionnaire_id: state.questionnaire.id,
    tag_id: tagId
  });
  if (error) { showToast('Failed: ' + error.message, 'error'); return; }
  state.tagIds.push(tagId);
  paintTagChips();
}

async function removeTag(tagId) {
  const { error } = await sb.from('questionnaire_tags')
    .delete()
    .eq('questionnaire_id', state.questionnaire.id)
    .eq('tag_id', tagId);
  if (error) { showToast('Failed: ' + error.message, 'error'); return; }
  state.tagIds = state.tagIds.filter(id => id !== tagId);
  paintTagChips();
}

async function createAndAddTag(name) {
  const { data, error } = await sb.rpc('upsert_tag', { p_name: name });
  if (error) { showToast('Failed: ' + error.message, 'error'); return; }
  // Refresh tag list (in case other pages added tags too)
  const { data: tags } = await sb.from('tags').select('id, name').order('name');
  state.allTags = tags || [];
  await addTagById(data);
}

// ─── UI helpers ─────────────────────────────────────────────────────────────

function setSave(status) {
  saveStatus = status;
  const ind = document.getElementById('saveIndicator');
  const txt = document.getElementById('saveText');
  if (!ind || !txt) return;
  ind.classList.remove('saving', 'saved', 'error');
  if (status === 'saving') { ind.classList.add('saving'); txt.textContent = 'Saving…'; }
  else if (status === 'saved') { ind.classList.add('saved'); txt.textContent = 'All changes saved'; }
  else if (status === 'error') { ind.classList.add('error'); txt.textContent = 'Save failed'; }
}

function openCombo(wrapId, items, onPick, opts = {}) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;

  // Close any other open combos
  document.querySelectorAll('.combo-options').forEach(d => d.remove());
  document.querySelectorAll('.combo-input').forEach(i => i.remove());

  const trigger = wrap.querySelector('button');
  if (trigger) trigger.style.display = 'none';

  const input = document.createElement('input');
  input.className = 'combo-input';
  input.placeholder = opts.allowCreate ? 'Type to filter or create…' : 'Type to filter…';
  wrap.appendChild(input);

  const options = document.createElement('div');
  options.className = 'combo-options';
  wrap.appendChild(options);

  function renderList(query) {
    const q = (query || '').toLowerCase().trim();
    let filtered = items.filter(it => it.label.toLowerCase().includes(q));
    options.innerHTML = filtered.map(it => `
      <div class="combo-option" data-id="${it.id}">${escapeHtml(it.label)}</div>
    `).join('');

    if (filtered.length === 0 && !opts.allowCreate) {
      options.innerHTML = `<div class="combo-option" style="color: var(--ink-mute);">No matches</div>`;
    }

    if (opts.allowCreate && q && !items.some(it => it.label.toLowerCase() === q)) {
      const div = document.createElement('div');
      div.className = 'combo-option create-new';
      div.textContent = `+ Create "${query}"`;
      div.addEventListener('click', () => { close(); onPick({ create: query }); });
      options.appendChild(div);
    }

    options.querySelectorAll('[data-id]').forEach(o => {
      o.addEventListener('click', () => {
        close();
        onPick({ id: o.dataset.id });
      });
    });
  }

  function close() {
    options.remove();
    input.remove();
    if (trigger) trigger.style.display = '';
    document.removeEventListener('click', outsideClick, true);
  }

  function outsideClick(e) {
    if (!wrap.contains(e.target)) close();
  }

  input.addEventListener('input', () => renderList(input.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
    else if (e.key === 'Enter' && opts.allowCreate && input.value.trim()) {
      e.preventDefault();
      const exact = items.find(it => it.label.toLowerCase() === input.value.toLowerCase().trim());
      if (exact) { close(); onPick({ id: exact.id }); }
      else { close(); onPick({ create: input.value.trim() }); }
    }
  });

  renderList('');
  setTimeout(() => {
    input.focus();
    document.addEventListener('click', outsideClick, true);
  }, 0);
}
