import { sb } from '../supabase.js';
import { navigate } from '../router.js';
import { getSession } from '../auth.js';
import { escapeHtml, showToast } from '../utils.js';
import { renderAdminTopbar, attachAdminTopbarHandlers } from './_topbar.js';

// Per-render context. Created fresh on each renderQuestionnairesList call.
function makeCtx() {
  return {
    allRows: [],
    allClients: [],
    allTags: [],
    filters: { search: '', clientId: '', tagId: '' }
  };
}

export async function renderQuestionnairesList(root) {
  const ctx = makeCtx();

  root.innerHTML = `
    ${renderAdminTopbar('/admin/questionnaires')}

    <div class="container fade-in">
      <section class="hero">
        <div>
          <div class="breadcrumb">Workspace <span class="red">/</span> Questionnaires</div>
          <h1 class="page-title">Your <span class="red">questionnaires</span>.</h1>
          <p class="page-subtitle" id="qSubtitle">Loading…</p>
        </div>
        <button class="btn" id="newQuestionnaireBtn">
          New questionnaire <span class="arrow">→</span>
        </button>
      </section>

      <div class="filter-bar">
        <input class="search-input" type="text" id="qSearch" placeholder="Search by title…" />
        <select class="filter-select" id="qClientFilter">
          <option value="">All clients</option>
        </select>
        <select class="filter-select" id="qTagFilter">
          <option value="">All tags</option>
        </select>
      </div>

      <div class="q-list" id="qList">
        <div style="padding: 64px 0; text-align: center; color: var(--ink-mute);">
          <span class="spinner spinner-dark"></span> Loading…
        </div>
      </div>
    </div>
  `;

  attachAdminTopbarHandlers(root);

  root.querySelector('#newQuestionnaireBtn').addEventListener('click', () => createNewQuestionnaire());
  root.querySelector('#qSearch').addEventListener('input', e => { ctx.filters.search = e.target.value; applyFilters(ctx); });
  root.querySelector('#qClientFilter').addEventListener('change', e => { ctx.filters.clientId = e.target.value; applyFilters(ctx); });
  root.querySelector('#qTagFilter').addEventListener('change', e => { ctx.filters.tagId = e.target.value; applyFilters(ctx); });

  // Single document-level listener for closing open row menus.
  // Use AbortController so we cleanly remove it whenever the page changes.
  const abort = new AbortController();
  document.addEventListener('click', closeOpenRowMenus, { signal: abort.signal });

  // Stop listening when the user navigates away (the route handler will swap #app's content)
  window.addEventListener('hashchange', () => abort.abort(), { once: true });

  try {
    await loadAll(root, ctx);
  } catch (err) {
    console.error('loadAll crashed:', err);
    showToast('Load failed: ' + (err?.message ?? 'unknown'), 'error');
    root.querySelector('#qList').innerHTML = `
      <div class="empty">
        <div class="empty-title">Couldn't load questionnaires</div>
        <div class="empty-text">${escapeHtml(err?.message ?? 'Unknown error')}</div>
        <button class="btn btn-outline" onclick="location.reload()">Retry</button>
      </div>
    `;
  }
}

async function loadAll(root, ctx) {
  const [qsRes, clientsRes, tagsRes, qcRes, qtRes] = await Promise.all([
    sb.from('questionnaires').select('id, title, description, status, created_at, parent_id').order('created_at', { ascending: false }),
    sb.from('clients').select('id, name').order('name'),
    sb.from('tags').select('id, name').order('name'),
    sb.from('questionnaire_clients').select('questionnaire_id, client_id'),
    sb.from('questionnaire_tags').select('questionnaire_id, tag_id')
  ]);

  if (qsRes.error) throw qsRes.error;
  if (clientsRes.error) throw clientsRes.error;
  if (tagsRes.error) throw tagsRes.error;

  ctx.allClients = clientsRes.data || [];
  ctx.allTags = tagsRes.data || [];

  const clientByQ = new Map();
  for (const r of qcRes.data || []) {
    if (!clientByQ.has(r.questionnaire_id)) clientByQ.set(r.questionnaire_id, []);
    clientByQ.get(r.questionnaire_id).push(r.client_id);
  }
  const tagByQ = new Map();
  for (const r of qtRes.data || []) {
    if (!tagByQ.has(r.questionnaire_id)) tagByQ.set(r.questionnaire_id, []);
    tagByQ.get(r.questionnaire_id).push(r.tag_id);
  }

  ctx.allRows = (qsRes.data || []).map(q => ({
    ...q,
    client_ids: clientByQ.get(q.id) || [],
    tag_ids: tagByQ.get(q.id) || []
  }));

  // Populate filter selects (only if we're still on the page)
  const clientSelect = root.querySelector('#qClientFilter');
  const tagSelect = root.querySelector('#qTagFilter');
  if (!clientSelect || !tagSelect) return;

  // Reset existing options (in case of re-load)
  clientSelect.innerHTML = '<option value="">All clients</option>';
  for (const c of ctx.allClients) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    clientSelect.appendChild(opt);
  }
  tagSelect.innerHTML = '<option value="">All tags</option>';
  for (const t of ctx.allTags) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    tagSelect.appendChild(opt);
  }

  const subtitle = root.querySelector('#qSubtitle');
  if (subtitle) {
    subtitle.textContent = ctx.allRows.length === 0
      ? 'No questionnaires yet — create your first one.'
      : `${ctx.allRows.length} questionnaire${ctx.allRows.length === 1 ? '' : 's'}`;
  }

  applyFilters(ctx);
}

function applyFilters(ctx) {
  let rows = ctx.allRows;
  if (ctx.filters.search) {
    const q = ctx.filters.search.toLowerCase();
    rows = rows.filter(r => r.title.toLowerCase().includes(q));
  }
  if (ctx.filters.clientId) rows = rows.filter(r => r.client_ids.includes(ctx.filters.clientId));
  if (ctx.filters.tagId) rows = rows.filter(r => r.tag_ids.includes(ctx.filters.tagId));
  renderRows(ctx, rows);
}

function renderRows(ctx, rows) {
  const list = document.getElementById('qList');
  if (!list) return;

  if (rows.length === 0) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-title">${ctx.allRows.length === 0 ? 'No questionnaires yet' : 'No matches'}</div>
        <div class="empty-text">${ctx.allRows.length === 0 ? 'Create your first questionnaire to get started.' : 'Try clearing your filters.'}</div>
      </div>
    `;
    return;
  }

  const tagById = Object.fromEntries(ctx.allTags.map(t => [t.id, t.name]));
  const clientById = Object.fromEntries(ctx.allClients.map(c => [c.id, c.name]));

  list.innerHTML = rows.map((r, i) => {
    const clientNames = r.client_ids.map(id => clientById[id]).filter(Boolean);
    const tagNames = r.tag_ids.map(id => tagById[id]).filter(Boolean);
    return `
      <div class="q-row" data-id="${r.id}" role="button" tabindex="0">
        <div class="q-num">${String(i + 1).padStart(2, '0')}</div>
        <div>
          <div class="q-row-title">${escapeHtml(r.title)}</div>
          <div class="q-row-meta">
            ${clientNames.length > 0 ? escapeHtml(clientNames.join(', ')) : 'No clients assigned'}
            · created ${formatDate(r.created_at)}
          </div>
          ${tagNames.length > 0 ? `<div class="q-tags">${tagNames.map(t => `<span class="q-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        </div>
        <span class="badge ${r.status}">${r.status === 'live' ? '<span class="dot"></span>' : ''}${r.status}</span>
        <div class="q-row-meta">${r.parent_id ? 'Cloned' : 'Original'}</div>
        <div class="q-row-meta"></div>
        <div class="row-menu-wrap">
          <button class="row-menu-trigger" data-menu="${r.id}" title="Actions">⋯</button>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.q-row').forEach(row => {
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (e.target.closest('.row-menu-trigger') || e.target.closest('.row-menu')) return;
        navigate(`/admin/questionnaires/${row.dataset.id}`);
      }
    });
  });

  // Delegated click on the list — handles row click, menu trigger, and menu actions.
  // We attach this once per render but it's idempotent; the only risk would be
  // accumulation across renders, which we mitigate by always replacing list.innerHTML.
  list.onclick = async (e) => {
    // 1. Menu trigger ⋯
    const trigger = e.target.closest('.row-menu-trigger');
    if (trigger) {
      e.stopPropagation();
      const wrap = trigger.parentElement;
      const existing = wrap.querySelector('.row-menu');
      closeOpenRowMenus();
      if (existing) return;
      const id = trigger.getAttribute('data-menu');
      const menu = document.createElement('div');
      menu.className = 'row-menu';
      menu.innerHTML = `
        <button type="button" data-action="open" data-id="${id}">Open</button>
        <button type="button" data-action="clone" data-id="${id}">Clone</button>
        <button type="button" data-action="delete" data-id="${id}" class="danger">Delete</button>
      `;
      wrap.appendChild(menu);
      return;
    }

    // 2. Action button inside an open menu
    const action = e.target.closest('.row-menu button[data-action]');
    if (action) {
      e.stopPropagation();
      const id = action.getAttribute('data-id');
      const kind = action.getAttribute('data-action');
      closeOpenRowMenus();
      if (kind === 'open') navigate(`/admin/questionnaires/${id}`);
      else if (kind === 'clone') await cloneOne(id);
      else if (kind === 'delete') await deleteOne(ctx, id);
      return;
    }

    // 3. Plain row click (open builder)
    const row = e.target.closest('.q-row');
    if (row) {
      navigate(`/admin/questionnaires/${row.dataset.id}`);
    }
  };
}

function closeOpenRowMenus() {
  document.querySelectorAll('.row-menu').forEach(m => m.remove());
}

async function cloneOne(id) {
  const { data, error } = await sb.rpc('clone_questionnaire', { p_source_id: id });
  if (error) {
    showToast('Clone failed: ' + error.message, 'error');
    return;
  }
  showToast('Cloned — opening editor', 'success');
  navigate(`/admin/questionnaires/${data}`);
}

async function deleteOne(ctx, id) {
  if (!confirm('Delete this questionnaire? This cannot be undone.')) return;
  const { error } = await sb.from('questionnaires').delete().eq('id', id);
  if (error) {
    showToast('Delete failed: ' + error.message, 'error');
    return;
  }
  showToast('Deleted', 'success');
  ctx.allRows = ctx.allRows.filter(r => r.id !== id);
  applyFilters(ctx);
}

async function createNewQuestionnaire() {
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
    showToast('Create failed: ' + error.message, 'error');
    return;
  }
  navigate(`/admin/questionnaires/${data.id}`);
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
