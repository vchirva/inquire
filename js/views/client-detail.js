import { sb } from '../supabase.js';
import { navigate } from '../router.js';
import { getSession } from '../auth.js';
import { escapeHtml, showToast } from '../utils.js';
import { renderAdminTopbar, attachAdminTopbarHandlers } from './_topbar.js';

export async function renderClientDetail(root, params) {
  const clientId = params.id;

  root.innerHTML = `
    ${renderAdminTopbar('/admin/clients')}
    <div class="container fade-in" id="detailContainer">
      <div style="padding: 64px 0; text-align: center; color: var(--ink-mute);">
        <span class="spinner spinner-dark"></span> Loading client…
      </div>
    </div>
  `;

  attachAdminTopbarHandlers(root);

  // Load the client and existing invites in parallel
  const [clientQ, invitesQ] = await Promise.all([
    sb.from('clients').select('*').eq('id', clientId).single(),
    sb.from('client_registration_invites').select('*').eq('client_id', clientId).order('created_at', { ascending: false })
  ]);

  if (clientQ.error || !clientQ.data) {
    root.querySelector('#detailContainer').innerHTML = `
      <div class="empty">
        <div class="empty-title">Client not found</div>
        <div class="empty-text">The client you're looking for doesn't exist or you don't have access to it.</div>
        <button class="btn btn-outline" data-back>Back to clients</button>
      </div>
    `;
    root.querySelector('[data-back]').addEventListener('click', () => navigate('/admin/clients'));
    return;
  }

  const client = clientQ.data;
  const invites = invitesQ.data || [];

  renderDetail(root, client, invites);
}

function renderDetail(root, client, invites) {
  const container = root.querySelector('#detailContainer');

  container.innerHTML = `
    <button class="back-link" data-back>← Back to clients</button>

    <section class="hero">
      <div>
        <div class="breadcrumb">Clients <span class="red">/</span> ${escapeHtml(client.name)}</div>
        <h1 class="page-title">${escapeHtml(client.name)}</h1>
        <p class="page-subtitle">${escapeHtml(client.contact_email ?? 'No contact email set')}</p>
      </div>
      <div style="display:flex; gap:12px;">
        <button class="btn btn-outline" id="editClientBtn">Edit</button>
      </div>
    </section>

    <div class="detail-grid">
      <div>
        <section class="detail-section">
          <div class="section-eyebrow">Profile</div>
          <h2 class="section-title" style="font-size:24px;">Client information</h2>
          <div class="info-list">
            <div class="info-label">Organization</div>
            <div class="info-value">${escapeHtml(client.name)}</div>

            <div class="info-label">Contact email</div>
            <div class="info-value">${escapeHtml(client.contact_email ?? '—')}</div>

            <div class="info-label">Notes</div>
            <div class="info-value" style="white-space:pre-wrap;">${escapeHtml(client.notes ?? '—')}</div>

            <div class="info-label">Created</div>
            <div class="info-value">${new Date(client.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</div>
          </div>
        </section>

        <section class="detail-section">
          <div class="section-eyebrow">Onboarding</div>
          <h2 class="section-title" style="font-size:24px;">Registration invites</h2>
          <p class="page-subtitle" style="margin-top:12px; max-width:600px;">
            Generate a one-time link the client uses to set up their account.
            The link is valid for 30 days. Share it via email, Slack, or any other channel.
          </p>

          <div id="inviteList">
            ${renderInviteList(invites)}
          </div>
        </section>
      </div>

      <aside>
        <div class="sidebar-card">
          <h3>Generate invite link</h3>
          <p>Create a registration link for this client's main contact. They'll use it to set their password and access their cabinet.</p>
          <button class="btn btn-red" id="generateInviteBtn" style="width:100%;">
            Generate <span class="arrow">→</span>
          </button>
          <div id="inviteOutput"></div>
        </div>
      </aside>
    </div>
  `;

  container.querySelector('[data-back]').addEventListener('click', () => navigate('/admin/clients'));
  container.querySelector('#editClientBtn').addEventListener('click', () => openEditModal(root, client));
  container.querySelector('#generateInviteBtn').addEventListener('click', () => generateInvite(root, client));
}

function renderInviteList(invites) {
  if (invites.length === 0) {
    return `
      <div style="padding: 32px 0; color: var(--ink-mute); font-size: 14px;">
        No invites yet. Generate one with the button on the right.
      </div>
    `;
  }

  return `
    <div class="invite-list">
      ${invites.map(inv => {
        const status = getInviteStatus(inv);
        const url = buildInviteUrl(inv.token);
        return `
          <div class="invite-row">
            <div>
              <div class="invite-email">${escapeHtml(inv.email)}</div>
              <div class="client-meta" style="margin-top:4px;">Created ${formatDate(inv.created_at)}</div>
            </div>
            <span class="invite-status-badge ${status}">${status}</span>
            <span class="client-meta">${status === 'used' ? 'Consumed' : 'Expires ' + formatDate(inv.expires_at)}</span>
            <button class="btn btn-outline btn-sm" data-copy="${escapeHtml(url)}" ${status !== 'pending' ? 'disabled' : ''}>
              ${status === 'pending' ? 'Copy link' : '—'}
            </button>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function getInviteStatus(invite) {
  if (invite.used_at) return 'used';
  if (new Date(invite.expires_at) < new Date()) return 'expired';
  return 'pending';
}

function buildInviteUrl(token) {
  const base = location.origin + location.pathname;
  return `${base}#/register/${token}`;
}

async function generateInvite(root, client) {
  const session = getSession();
  const email = client.contact_email;

  if (!email) {
    showToast('Add a contact email to the client first', 'error');
    return;
  }

  const btn = root.querySelector('#generateInviteBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Generating';

  try {
    const { data, error } = await sb
      .from('client_registration_invites')
      .insert({
        client_id: client.id,
        email,
        created_by: session.user.id
      })
      .select()
      .single();

    if (error) throw error;

    const url = buildInviteUrl(data.token);
    const output = root.querySelector('#inviteOutput');
    output.innerHTML = `
      <div class="invite-output" style="background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.15);">
        <div class="invite-output-label" style="color: rgba(255,255,255,0.7);">Registration link</div>
        <div class="invite-url" style="background: rgba(0,0,0,0.3); border-color: rgba(255,255,255,0.15); color: white;">${escapeHtml(url)}</div>
        <div class="invite-meta" style="color: rgba(255,255,255,0.5);">For ${escapeHtml(email)} · expires in 30 days</div>
        <button class="btn btn-red btn-sm" id="copyInviteBtn" style="width:100%;">Copy to clipboard</button>
      </div>
    `;
    output.querySelector('#copyInviteBtn').addEventListener('click', async () => {
      await copyToClipboard(url);
      showToast('Link copied to clipboard', 'success');
    });

    showToast('Invite created', 'success');

    // Reload the invite list
    const { data: updated } = await sb
      .from('client_registration_invites')
      .select('*')
      .eq('client_id', client.id)
      .order('created_at', { ascending: false });
    root.querySelector('#inviteList').innerHTML = renderInviteList(updated || []);
    attachCopyHandlers(root);
  } catch (err) {
    console.error(err);
    showToast(err?.message ?? 'Failed to generate invite', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

function attachCopyHandlers(root) {
  root.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await copyToClipboard(btn.dataset.copy);
      const original = btn.textContent;
      btn.textContent = '✓ Copied';
      setTimeout(() => { btn.textContent = original; }, 1400);
    });
  });
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

function openEditModal(root, client) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <button class="modal-close" aria-label="Close">×</button>
      <div class="modal-eyebrow">Edit client</div>
      <h2 class="modal-title">${escapeHtml(client.name)}</h2>
      <p class="modal-subtitle">Update the organization details.</p>

      <form id="editClientForm" novalidate>
        <div class="modal-fields">
          <div class="field">
            <label class="field-label">Organization name</label>
            <input class="input" type="text" name="name" value="${escapeHtml(client.name)}" required />
          </div>
          <div class="field">
            <label class="field-label">Contact email</label>
            <input class="input" type="email" name="contact_email" value="${escapeHtml(client.contact_email ?? '')}" />
          </div>
          <div class="field">
            <label class="field-label">Notes</label>
            <textarea class="textarea" name="notes" rows="3">${escapeHtml(client.notes ?? '')}</textarea>
          </div>
          <div class="field-error" id="editError" style="display:none;"></div>
        </div>

        <div class="modal-actions">
          <button class="btn btn-outline" type="button" id="editCancel">Cancel</button>
          <button class="btn" type="submit" id="editSubmit">
            <span id="editSubmitText">Save</span>
            <span class="arrow">→</span>
          </button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.querySelector('.modal-close').addEventListener('click', close);
  backdrop.querySelector('#editCancel').addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });

  const form = backdrop.querySelector('#editClientForm');
  const errorEl = backdrop.querySelector('#editError');
  const submitBtn = backdrop.querySelector('#editSubmit');
  const submitText = backdrop.querySelector('#editSubmitText');

  form.addEventListener('submit', async e => {
    e.preventDefault();
    errorEl.style.display = 'none';

    const name = form.name.value.trim();
    if (!name) {
      errorEl.textContent = 'Organization name is required.';
      errorEl.style.display = 'block';
      return;
    }

    submitBtn.disabled = true;
    submitText.innerHTML = '<span class="spinner"></span> Saving';

    try {
      const { error } = await sb
        .from('clients')
        .update({
          name,
          contact_email: form.contact_email.value.trim() || null,
          notes: form.notes.value.trim() || null
        })
        .eq('id', client.id);
      if (error) throw error;

      showToast('Client updated', 'success');
      close();
      // Reload the page
      renderClientDetail(root, { id: client.id });
    } catch (err) {
      console.error(err);
      errorEl.textContent = err?.message ?? 'Update failed.';
      errorEl.style.display = 'block';
      submitBtn.disabled = false;
      submitText.textContent = 'Save';
    }
  });
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
