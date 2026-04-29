import { sb } from '../supabase.js';
import { navigate } from '../router.js';
import { getSession } from '../auth.js';
import { escapeHtml, showToast } from '../utils.js';
import { renderAdminTopbar, attachAdminTopbarHandlers } from './_topbar.js';

let allRows = [];
let allClients = [];
let allTags = [];
let filters = { search: '', clientId: '', tagId: '' };

export async function renderQuestionnairesList(root) {
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

  root.querySelector('#newQuestionnaireBtn').addEventListener('click', createNewQuestionnaire);
  root.querySelector('#qSearch').addEventListener('input', e => { filters.search = e.target.value; applyFilters(); });
  root.querySelector('#qClientFilter').addEventListener('change', e => { filters.clientId = e.target.value; applyFilters(); });
  root.querySelector('#qTagFilter').addEventListener('change', e => { filters.tagId = e.target.value; applyFilters(); });

  await loadAll(root);

  // Close any open row menus when clicking elsewhere
  document.addEventListener('click', closeOpenRowMenus);
}

async function loadAll(root) {
  const [qsRes, clientsRes, tagsRes, qcRes, qtRes] = await Promise.all([
    sb.from('questionnaires').select('id, title, description, status, created_at, parent_id').order('created_at', { ascending: false }),
    sb.from('clients').select('id, name').order('name'),
    sb.from('tags').select('id, name').order('name'),
    sb.from('questionnaire_clients').select('questionnaire_id, client_id'),
    sb.from('questionnaire_tags').select('questionnaire_id, tag_id')
  ]);

  if (qsRes.error) {
    showToast('Failed to load: ' + qsRes.error.message, 'error');
    return;
  }

  allClients = clientsRes.data || [];
  allTags = tagsRes.data || [];

  // Index assignments
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

  // Decorate
  allRows = (qsRes.data || []).map(q => ({
    ...q,
    client_ids: clientByQ.get(q.id) || [],
    tag_ids: tagByQ.get(q.id) || []
  }));

  // Populate filter selects
  const clientSelect = root.querySelector('#qClientFilter');
  for (const c of allClients) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    clientSelect.appendChild(opt);
  }
  const tagSelect = root.querySelector('#qTagFilter');
  for (const t of allTags) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    tagSelect.appendChild(opt);
  }

  // Subtitle
  root.querySelector('#qSubtitle').textContent =
    allRows.length === 0
      ? 'No questionnaires yet — create your first one.'
      : `${allRows.length} questionnaire${allRows.length === 1 ? '' : 's'}`;

  applyFilters();
}

function applyFilters() {
  let rows = allRows;
  if (filters.search) {
    const q = filters.search.toLowerCase();
    rows = rows.filter(r => r.title.toLowerCase().includes(q));
  }
  if (filters.clientId) rows = rows.filter(r => r.client_ids.includes(filters.clientId));
  if (filters.tagId) rows = rows.filter(r => r.tag_ids.includes(filters.tagId));
  renderRows(rows);
}

function renderRows(rows) {
  const list = document.getElementById('qList');
  if (!list) return;

  if (rows.length === 0) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-title">${allRows.length === 0 ? 'No questionnaires yet' : 'No matches'}</div>
        <div class="empty-text">${allRows.length === 0 ? 'Create your first questionnaire to get started.' : 'Try clearing your filters.'}</div>
      </div>
    `;
    return;
  }

  const tagById = Object.fromEntries(allTags.map(t => [t.id, t.name]));
  const clientById = Object.fromEntries(allClients.map(c => [c.id, c.name]));

  list.innerHTML = rows.map((r, i) => {
    const clientNames = r.client_ids.map(id => clientById[id]).filter(Boolean);
    const tagNames = r.tag_ids.map(id => tagById[id]).filter(Boolean);
    return `
      <button class="q-row" data-id="${r.id}">
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
      </button>
    `;
  }).join('');

  list.querySelectorAll('.q-row').forEach(row => {
    row.addEventListener('click', e => {
      // Menu trigger handled separately
      if (e.target.closest('.row-menu-trigger') || e.target.closest('.row-menu')) return;
      navigate(`/admin/questionnaires/${row.dataset.id}`);
    });
  });

  list.querySelectorAll('.row-menu-trigger').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const wrap = btn.parentElement;
      const existing = wrap.querySelector('.row-menu');
      closeOpenRowMenus();
      if (existing) return;
      const id = btn.dataset.menu;
      const menu = document.createElement('div');
      menu.className = 'row-menu';
      menu.innerHTML = `
        <button data-action="open" data-id="${id}">Open</button>
        <button data-action="clone" data-id="${id}">Clone</button>
        <button data-action="delete" data-id="${id}" class="danger">Delete</button>
      `;
      wrap.appendChild(menu);

      menu.querySelectorAll('button').forEach(mb => {
        mb.addEventListener('click', async ev => {
          ev.stopPropagation();
          closeOpenRowMenus();
          if (mb.dataset.action === 'open') navigate(`/admin/questionnaires/${id}`);
          else if (mb.dataset.action === 'clone') await cloneOne(id);
          else if (mb.dataset.action === 'delete') await deleteOne(id);
        });
      });
    });
  });
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

async function deleteOne(id) {
  if (!confirm('Delete this questionnaire? This cannot be undone.')) return;
  const { error } = await sb.from('questionnaires').delete().eq('id', id);
  if (error) {
    showToast('Delete failed: ' + error.message, 'error');
    return;
  }
  showToast('Deleted', 'success');
  // Remove from local state
  allRows = allRows.filter(r => r.id !== id);
  applyFilters();
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
