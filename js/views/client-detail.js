// Client detail view — info, edit, registration invite generation.
// Uses delegated click handling for resilience across re-renders (Safari-safe).

import { sb } from '../supabase.js';
import { navigate } from '../router.js';
import { getSession } from '../auth.js';
import { escapeHtml, showToast } from '../utils.js';
import { renderAdminTopbar, attachAdminTopbarHandlers } from './_topbar.js';

const LOAD_TIMEOUT_MS = 8000;

function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out`)), ms))
  ]);
}

export async function renderClientDetail(root, params) {
  const ctx = { id: params.id };

  root.innerHTML = `
    ${renderAdminTopbar('/admin/clients')}
    <div class="container fade-in" id="detailContainer">
      <div style="padding: 64px 0; text-align: center; color: var(--ink-mute);">
        <span class="spinner spinner-dark"></span> Loading client…
      </div>
    </div>
  `;
  attachAdminTopbarHandlers(root);

  const container = root.querySelector('#detailContainer');

  // Single delegated click handler on the container — survives re-renders
  container.addEventListener('click', async (e) => {
    if (e.target.closest('[data-back]')) {
      e.preventDefault();
      navigate('/admin/clients');
      return;
    }
    if (e.target.closest('#editClientBtn')) {
      e.preventDefault();
      openEditModal(ctx, container);
      return;
    }
    if (e.target.closest('#generateInviteBtn')) {
      e.preventDefault();
      await generateInvite(ctx, container);
      return;
    }
    const copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) {
      e.preventDefault();
      await copyToClipboard(copyBtn.getAttribute('data-copy'));
      const original = copyBtn.textContent;
      copyBtn.textContent = '✓ Copied';
      setTimeout(() => { copyBtn.textContent = original; }, 1400);
      return;
    }
  });

  try {
    await loadAndPaint(ctx, container);
  } catch (err) {
    console.error('Client detail load failed:', err);
    container.innerHTML = `
      <div class="empty">
        <div class="empty-title">Couldn't load client</div>
        <div class="empty-text">${escapeHtml(err?.message ?? '')}</div>
        <button class="btn btn-outline" data-back>Back to clients</button>
      </div>
    `;
  }
}

async function loadAndPaint(ctx, container) {
  const [clientQ, invitesQ] = await withTimeout(Promise.all([
    sb.from('clients').select('*').eq('id', ctx.id).single(),
    sb.from('client_registration_invites').select('*').eq('client_id', ctx.id).order('created_at', { ascending: false })
  ]), LOAD_TIMEOUT_MS, 'load client');

  if (clientQ.error || !clientQ.data) {
    container.innerHTML = `
      <div class="empty">
        <div class="empty-title">Client not found</div>
        <div class="empty-text">The client you're looking for doesn't exist or you don't have access to it.</div>
        <button class="btn btn-outline" data-back>Back to clients</button>
      </div>
    `;
    return;
  }

  ctx.client = clientQ.data;
  ctx.invites = invitesQ.data || [];
  paint(ctx, container);
}

function paint(ctx, container) {
  const client = ctx.client;

  container.innerHTML = `
    <button class="back-link" data-back>← Back to clients</button>

    <section class="hero">
      <div>
        <div class="breadcrumb">Clients <span class="red">/</span> ${escapeHtml(client.name)}</div>
        <h1 class="page-title">${escapeHtml(client.name)}</h1>
        <p class="page-subtitle">${escapeHtml(client.contact_email ?? 'No contact email set')}</p>
      </div>
      <div style="display:flex; gap:12px;">
        <button type="button" class="btn btn-outline" id="editClientBtn">Edit</button>
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
            ${renderInviteList(ctx.invites)}
          </div>
        </section>
      </div>

      <aside>
        <div class="sidebar-card">
          <h3>Generate invite link</h3>
          <p>Create a registration link for this client's main contact. They'll use it to set their password and access their cabinet.</p>
          <button type="button" class="btn btn-red" id="generateInviteBtn" style="width:100%;">
            Generate <span class="arrow">→</span>
          </button>
          <div id="inviteOutput"></div>
        </div>
      </aside>
    </div>
  `;
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
            <button type="button" class="btn btn-outline btn-sm" data-copy="${escapeHtml(url)}" ${status !== 'pending' ? 'disabled' : ''}>
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

async function generateInvite(ctx, container) {
  const session = getSession();
  const email = ctx.client.contact_email;

  if (!email) {
    showToast('Add a contact email to the client first', 'error');
    return;
  }

  const btn = container.querySelector('#generateInviteBtn');
  if (!btn) return;
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Generating';

  try {
    const { data, error } = await withTimeout(
      sb.from('client_registration_invites')
        .insert({ client_id: ctx.client.id, email, created_by: session.user.id })
        .select()
        .single(),
      LOAD_TIMEOUT_MS,
      'create invite'
    );

    if (error) throw error;

    const url = buildInviteUrl(data.token);
    const output = container.querySelector('#inviteOutput');
    if (output) {
      output.innerHTML = `
        <div class="invite-output" style="background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.15); margin-top: 24px;">
          <div class="invite-output-label" style="color: rgba(255,255,255,0.7);">Registration link</div>
          <div class="invite-url" style="background: rgba(0,0,0,0.3); border-color: rgba(255,255,255,0.15); color: white;">${escapeHtml(url)}</div>
          <div class="invite-meta" style="color: rgba(255,255,255,0.5);">For ${escapeHtml(email)} · expires in 30 days</div>
          <button type="button" class="btn btn-red btn-sm" data-copy="${escapeHtml(url)}" style="width:100%;">Copy to clipboard</button>
        </div>
      `;
    }

    showToast('Invite created', 'success');

    // Refresh the invite list (fetch fresh data, repaint just that section)
    const { data: updated } = await sb
      .from('client_registration_invites')
      .select('*')
      .eq('client_id', ctx.client.id)
      .order('created_at', { ascending: false });
    ctx.invites = updated || [];
    const list = container.querySelector('#inviteList');
    if (list) list.innerHTML = renderInviteList(ctx.invites);
    // No re-attaching handlers — delegation on the container takes care of it
  } catch (err) {
    console.error(err);
    showToast(err?.message ?? 'Failed to generate invite', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback (older Safari, non-secure contexts)
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch {}
    ta.remove();
  }
}

function openEditModal(ctx, container) {
  const client = ctx.client;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <button type="button" class="modal-close" aria-label="Close">×</button>
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
          <button type="button" class="btn btn-outline" id="editCancel">Cancel</button>
          <button type="submit" class="btn" id="editSubmit">
            <span id="editSubmitText">Save</span>
            <span class="arrow">→</span>
          </button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  // Modal-scoped delegated click
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) return close();
    if (e.target.closest('.modal-close')) return close();
    if (e.target.closest('#editCancel')) return close();
  });

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
      // Refresh ctx + repaint just the container (not the whole route)
      ctx.client = { ...client, name, contact_email: form.contact_email.value.trim() || null, notes: form.notes.value.trim() || null };
      paint(ctx, container);
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
