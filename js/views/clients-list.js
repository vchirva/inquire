import { sb } from '../supabase.js';
import { navigate } from '../router.js';
import { getSession } from '../auth.js';
import { escapeHtml, showToast } from '../utils.js';
import { renderAdminTopbar, attachAdminTopbarHandlers } from './_topbar.js';

let allClients = [];

export async function renderClientsList(root) {
  root.innerHTML = `
    ${renderAdminTopbar('/admin/clients')}

    <div class="container fade-in">
      <section class="hero">
        <div>
          <div class="breadcrumb">Workspace <span class="red">/</span> Clients</div>
          <h1 class="page-title">Your <span class="red">clients</span>.</h1>
          <p class="page-subtitle" id="clientsSubtitle">Loading…</p>
        </div>
        <button class="btn" id="newClientBtn">
          New client <span class="arrow">→</span>
        </button>
      </section>

      <div class="search-bar">
        <input class="search-input" type="text" id="clientSearch" placeholder="Search by name or email…" />
      </div>

      <div class="clients-list" id="clientsList">
        <div style="padding: 64px 0; text-align: center; color: var(--ink-mute);">
          <span class="spinner spinner-dark"></span> Loading clients…
        </div>
      </div>
    </div>
  `;

  attachAdminTopbarHandlers(root);
  root.querySelector('#newClientBtn').addEventListener('click', () => openCreateClientModal(root));
  root.querySelector('#clientSearch').addEventListener('input', e => filterClients(e.target.value));

  await loadClients(root);
}

async function loadClients(root) {
  const { data, error } = await sb
    .from('clients')
    .select('id, name, contact_email, notes, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    showToast('Failed to load clients: ' + error.message, 'error');
    return;
  }

  allClients = data || [];

  const subtitle = root.querySelector('#clientsSubtitle');
  if (allClients.length === 0) {
    subtitle.textContent = 'No clients yet — create your first one.';
  } else {
    subtitle.textContent = `${allClients.length} client${allClients.length === 1 ? '' : 's'} registered`;
  }

  renderClientsList_(allClients);
}

function filterClients(query) {
  const q = query.toLowerCase().trim();
  if (!q) {
    renderClientsList_(allClients);
    return;
  }
  const filtered = allClients.filter(c =>
    c.name.toLowerCase().includes(q) ||
    (c.contact_email ?? '').toLowerCase().includes(q)
  );
  renderClientsList_(filtered);
}

function renderClientsList_(clients) {
  const list = document.getElementById('clientsList');
  if (!list) return;

  if (clients.length === 0) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-title">No clients found</div>
        <div class="empty-text">Try a different search, or add a new client.</div>
      </div>
    `;
    return;
  }

  list.innerHTML = clients.map((c, i) => `
    <button class="client-row" data-id="${c.id}">
      <div class="client-num">${String(i + 1).padStart(2, '0')}</div>
      <div>
        <div class="client-name">${escapeHtml(c.name)}</div>
        <div class="client-email">${escapeHtml(c.contact_email ?? '—')}</div>
      </div>
      <div class="client-meta">${escapeHtml(c.contact_email ?? '')}</div>
      <div class="client-meta">${formatDate(c.created_at)}</div>
      <div class="client-meta"></div>
      <div class="icon-btn">→</div>
    </button>
  `).join('');

  list.querySelectorAll('.client-row').forEach(row => {
    row.addEventListener('click', () => navigate(`/admin/clients/${row.dataset.id}`));
  });
}

function openCreateClientModal(root) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <button class="modal-close" aria-label="Close">×</button>
      <div class="modal-eyebrow">New client</div>
      <h2 class="modal-title">Add a client</h2>
      <p class="modal-subtitle">Once created, you'll be able to generate a registration invite link to share with them.</p>

      <form id="newClientForm" novalidate>
        <div class="modal-fields">
          <div class="field">
            <label class="field-label" for="clientName">Organization name</label>
            <input class="input" type="text" id="clientName" name="name" required autofocus />
          </div>
          <div class="field">
            <label class="field-label" for="clientEmail">Contact email <span style="text-transform:none;color:var(--ink-mute);font-weight:500;">(optional)</span></label>
            <input class="input" type="email" id="clientEmail" name="contact_email" />
            <span class="field-hint">Used as a default for registration invites.</span>
          </div>
          <div class="field">
            <label class="field-label" for="clientNotes">Notes <span style="text-transform:none;color:var(--ink-mute);font-weight:500;">(optional)</span></label>
            <textarea class="textarea" id="clientNotes" name="notes" rows="3"></textarea>
          </div>
          <div class="field-error" id="modalError" style="display:none;"></div>
        </div>

        <div class="modal-actions">
          <button class="btn btn-outline" type="button" id="modalCancel">Cancel</button>
          <button class="btn" type="submit" id="modalSubmit">
            <span id="modalSubmitText">Create client</span>
            <span class="arrow">→</span>
          </button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.querySelector('.modal-close').addEventListener('click', close);
  backdrop.querySelector('#modalCancel').addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  });

  const form = backdrop.querySelector('#newClientForm');
  const errorEl = backdrop.querySelector('#modalError');
  const submitBtn = backdrop.querySelector('#modalSubmit');
  const submitText = backdrop.querySelector('#modalSubmitText');

  form.addEventListener('submit', async e => {
    e.preventDefault();
    errorEl.style.display = 'none';

    const name = form.name.value.trim();
    const contact_email = form.contact_email.value.trim() || null;
    const notes = form.notes.value.trim() || null;

    if (!name) {
      errorEl.textContent = 'Organization name is required.';
      errorEl.style.display = 'block';
      return;
    }

    submitBtn.disabled = true;
    submitText.innerHTML = '<span class="spinner"></span> Creating';

    try {
      const session = getSession();
      const { data, error } = await sb
        .from('clients')
        .insert({ name, contact_email, notes, created_by: session.user.id })
        .select()
        .single();
      if (error) throw error;

      showToast('Client created', 'success');
      close();
      navigate(`/admin/clients/${data.id}`);
    } catch (err) {
      console.error(err);
      errorEl.textContent = err?.message ?? 'Failed to create client.';
      errorEl.style.display = 'block';
      submitBtn.disabled = false;
      submitText.textContent = 'Create client';
    }
  });
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
